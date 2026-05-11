import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { parseJson5 } from "@shared/json5";
import { withOptionalValue } from "@shared/object-utils";
import { normalizeTopologyEdgeTrigger } from "@shared/types";
import { parseDecision } from "./decision-parser";
import { buildSubmitMessageBody } from "./opencode-request-body";
import { toOpenCodeAgentId } from "./opencode-agent-id";
import { appendAppLog } from "./app-log";
import { extractOpenCodeServeBaseUrl } from "./opencode-serve-launch";
import { resolveOpenCodeRequestTimeoutMs } from "./opencode-request-timeout";
import { resolveWindowsCmdPath } from "./windows-shell";
import type { OpenCodeInjectedConfig } from "./project-agent-source";
import { toUtcIsoTimestamp, type UtcIsoTimestamp } from "@shared/types";

interface ServeHandle {
  process: ChildProcessWithoutNullStreams | null;
  port: number;
}

interface OpenCodeEvent {
  directory?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SubmitMessagePayload {
  content: string;
  agent: string;
}

export interface OpenCodeNormalizedMessage {
  id: string;
  content: string;
  sender: string;
  timestamp: UtcIsoTimestamp;
  error: string | null;
  raw: unknown;
}

export interface OpenCodeExecutionResult {
  status: "completed" | "error";
  finalMessage: string;
  messageId: string;
  timestamp: UtcIsoTimestamp;
  rawMessage: OpenCodeNormalizedMessage;
}

export interface OpenCodeRuntimeActivity {
  id: string;
  kind: "tool" | "message" | "thinking" | "step";
  label: string;
  detail: string;
  detailState: "complete" | "missing" | "not_applicable";
  detailPayloadKeyCount: number;
  detailHasPlaceholderValue: boolean;
  detailParseMode: "structured" | "plain_text" | "missing" | "not_applicable";
  timestamp: UtcIsoTimestamp;
}

export interface OpenCodeSessionRuntime {
  sessionId: string;
  messageCount: number;
  updatedAt: string | null;
  headline: string | null;
  activeToolNames: string[];
  activities: OpenCodeRuntimeActivity[];
}

const MAX_RUNTIME_MESSAGES = 100;
const SERVE_BASE_URL_TIMEOUT_MS = 10_000;
const CONFIG_UPDATE_TIMEOUT_MS = 12_000;
const TRANSPORT_ERROR_RECOVERY_TIMEOUT_MS = 180_000;
const RETRYABLE_CLIENT_INTERVAL_MS = 60_000;
interface SessionWaiter {
  sessionId: string;
  after: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface WorkspaceServerState {
  cwd: string;
  serverHandle: Promise<ServeHandle> | null;
  eventPump: Promise<void> | null;
  injectedConfigContent: OpenCodeInjectedConfig;
  eventSubscribers: Set<(event: OpenCodeEvent) => void>;
}

interface RelatedTransportReplySnapshot {
  messageId: string;
  timestamp: UtcIsoTimestamp;
  finish: string;
  parentMessageId: string;
}

type TransportRecoveryInspection =
  | {
    kind: "empty";
    messageCount: 0;
  }
  | {
    kind: "submitted-message-missing";
    messageCount: number;
  }
  | {
    kind: "waiting-without-related-reply";
    messageCount: number;
  }
  | {
    kind: "waiting-with-related-reply";
    messageCount: number;
    relatedReplyCount: number;
    latestRelatedReply: RelatedTransportReplySnapshot;
  }
  | {
    kind: "recovered";
    messageCount: number;
    result: OpenCodeExecutionResult;
  };

type ConfiguredDecisionMode =
  | {
    kind: "plain";
  }
  | {
    kind: "decision";
    triggers: string[];
  };

class RetryableSubmitMessageError extends Error {}

class RetryableExecutionResultError extends Error {}
export interface OpenCodeShutdownReport {
  killedPids: number[];
}

export class OpenCodeClient {
  readonly servers = new Map<string, WorkspaceServerState>();
  readonly host = "127.0.0.1";
  readonly sessionIdleAt = new Map<string, number>();
  readonly sessionErrors = new Map<string, string>();
  readonly sessionWaiters = new Map<string, SessionWaiter[]>();
  readonly sessionCwdBySessionId = new Map<string, string>();

  constructor() {}

  protected getWorkspaceServerState(cwd: string): WorkspaceServerState {
    const key = path.resolve(cwd);
    const existing = this.servers.get(key);
    if (existing) {
      return existing;
    }

    const created: WorkspaceServerState = {
      cwd: key,
      serverHandle: null,
      eventPump: null,
      injectedConfigContent: {
        agent: {},
      },
      eventSubscribers: new Set(),
    };
    this.servers.set(key, created);
    return created;
  }

  async ensureServer(cwd: string): Promise<ServeHandle> {
    const state = this.getWorkspaceServerState(cwd);
    if (state.serverHandle) {
      const cached = await state.serverHandle;
      if (this.canReuseCachedServerHandle(cached)) {
        return cached;
      }
      await this.terminateServeHandle(cached).catch(() => undefined);
      state.serverHandle = null;
      state.eventPump = null;
    }

    state.serverHandle = this.startServer(state.cwd).catch((error) => {
      if (state.serverHandle) {
        state.serverHandle = null;
      }
      throw error;
    });
    return state.serverHandle;
  }

  protected canReuseCachedServerHandle(cached: ServeHandle): boolean {
    return Number.isInteger(cached.port) && cached.port > 0;
  }

  async setInjectedConfigContent(cwd: string, config: OpenCodeInjectedConfig): Promise<void> {
    const state = this.getWorkspaceServerState(cwd);
    const baseServerHandle = state.serverHandle ?? this.ensureServer(cwd);
    const update = baseServerHandle.then(async (server) => {
      if (JSON.stringify(config) === JSON.stringify(state.injectedConfigContent)) {
        return server;
      }
      const response = await this.fetchWithTimeout(
        `${this.buildBaseUrl(server.port)}/global/config`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ config }),
        },
        CONFIG_UPDATE_TIMEOUT_MS,
      );
      if (!response.ok) {
        throw new Error(`OpenCode 配置更新失败: ${response.status}`);
      }
      state.injectedConfigContent = config;
      return server;
    });
    state.serverHandle = update.catch(() => baseServerHandle);
    await update;
  }

  async createSession(
    cwd: string,
    title: string,
  ): Promise<string> {
    const normalized = path.resolve(cwd);
    const response = await this.request("/session", {
      method: "POST",
      cwd: normalized,
      body: JSON.stringify({ title }),
    });

    if (!response.ok) {
      appendAppLog("error", "opencode.create_session_failed", {
        cwd: normalized,
        title,
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`OpenCode 创建 session 失败: ${response.status}`);
    }

    const data = (await this.readJsonResponse(response)) as { id?: string } | null;
    if (typeof data?.id === "string" && data.id.trim()) {
      this.sessionCwdBySessionId.set(data.id, normalized);
      return data.id;
    }

    appendAppLog("error", "opencode.create_session_invalid_response", {
      cwd: normalized,
      title,
      status: response.status,
    });
    throw new Error("OpenCode 创建 session 响应缺少有效的 session id");
  }

  async connectEvents(cwd: string, onEvent: (event: OpenCodeEvent) => void): Promise<void> {
    const normalized = path.resolve(cwd);
    const state = this.getWorkspaceServerState(normalized);
    state.eventSubscribers.add(onEvent);
    const server = await this.ensureServer(normalized);
    if (state.eventPump) {
      return state.eventPump;
    }

    state.eventPump = this.startEventPump((event) => {
      for (const subscriber of state.eventSubscribers) {
        subscriber(event);
      }
    }, server, state.cwd).finally(() => {
      if (state.eventPump) {
        state.eventPump = null;
      }
    });
    await state.eventPump;
  }

  disconnectEvents(cwd: string, onEvent: (event: OpenCodeEvent) => void): void {
    const state = this.servers.get(path.resolve(cwd));
    state?.eventSubscribers.delete(onEvent);
  }

  async submitMessage(
    cwd: string,
    sessionId: string,
    payload: SubmitMessagePayload,
  ): Promise<OpenCodeNormalizedMessage> {
    const normalized = path.resolve(cwd);
    const opencodeAgent = toOpenCodeAgentId(payload.agent);
    let immediateRetryUsed = false;
    while (true) {
      try {
        const body = buildSubmitMessageBody({
          agent: opencodeAgent,
          content: payload.content,
        });

        const response = await this.request(`/session/${sessionId}/message`, {
          method: "POST",
          cwd: normalized,
          body: JSON.stringify(body),
        }).catch((error) => {
          throw new RetryableSubmitMessageError(String(error));
        });

        if (!response.ok) {
          throw new RetryableSubmitMessageError(`OpenCode 请求失败: ${response.status}`);
        }

        const raw = await this.readJsonResponse(response);
        if (!raw || typeof raw !== "object") {
          appendAppLog("error", "opencode.submit_message_invalid_response", {
            cwd: normalized,
            sessionId,
            agent: opencodeAgent,
            status: response.status,
          });
          throw new RetryableSubmitMessageError("OpenCode 提交消息响应缺少有效的消息实体");
        }
        const envelope = this.asRecord(raw);
        const info = this.asRecord(envelope["info"] ?? raw);
        if (typeof info["id"] !== "string" && typeof envelope["id"] !== "string") {
          appendAppLog("error", "opencode.submit_message_invalid_response", {
            cwd: normalized,
            sessionId,
            agent: opencodeAgent,
            status: response.status,
          });
          throw new RetryableSubmitMessageError("OpenCode 提交消息响应缺少有效的消息实体");
        }
        return this.normalizeMessageEnvelope(raw as Record<string, unknown>, opencodeAgent);
      } catch (error) {
        if (!(error instanceof RetryableSubmitMessageError)) {
          throw error;
        }
        if (immediateRetryUsed) {
          await new Promise((resolve) => setTimeout(resolve, RETRYABLE_CLIENT_INTERVAL_MS));
        }
        immediateRetryUsed = true;
      }
    }
  }

  async resolveExecutionResult(
    cwd: string,
    sessionId: string,
    submitted: OpenCodeNormalizedMessage,
    agentId: string,
  ): Promise<OpenCodeExecutionResult> {
    const normalized = path.resolve(cwd);
    const decisionMode = this.resolveConfiguredDecisionMode(normalized, agentId);
    let currentSubmitted = submitted;
    let immediateRetryUsed = false;
    while (true) {
      try {
        const submittedAt = Date.parse(currentSubmitted.timestamp) || Date.now();
        const messageCompletionPromise = this.waitForMessageCompletion(
          normalized,
          sessionId,
          currentSubmitted.id,
          currentSubmitted.timestamp,
          8000,
        );
        let latest = await Promise.race([
          messageCompletionPromise,
          this.waitForSessionSettled(sessionId, submittedAt, 8000)
            .then(async () => {
              const current = await this.getSessionMessage(normalized, sessionId, currentSubmitted.id);
              return current && this.isTerminalMessage(current) ? current : null;
            })
            .catch(() => null),
        ]);

        if (!latest) {
          latest =
            (await messageCompletionPromise) ??
            (await this.getLatestAssistantMessage(normalized, sessionId));
        }

        if (!latest) {
          throw new RetryableExecutionResultError(`OpenCode session ${sessionId} 未返回任何有效的 assistant 消息`);
        }

        const finalMessage = latest.content || latest.error || "";
        if (!finalMessage.trim()) {
          throw new RetryableExecutionResultError(this.buildEmptyAssistantResultError(sessionId, latest));
        }

        const result: OpenCodeExecutionResult = {
          status: latest.error ? "error" : "completed",
          finalMessage,
          messageId: latest.id,
          timestamp: latest.timestamp,
          rawMessage: latest,
        };
        if (result.status === "error" || decisionMode.kind === "plain") {
          return result;
        }

        if (
          parseDecision(
            result.finalMessage,
            true,
            decisionMode.triggers.map((trigger) => ({ trigger })),
          ).kind === "valid"
        ) {
          return result;
        }

        if (immediateRetryUsed) {
          await new Promise((resolve) => setTimeout(resolve, RETRYABLE_CLIENT_INTERVAL_MS));
        }
        immediateRetryUsed = true;
        currentSubmitted = await this.submitMessage(
          normalized,
          sessionId,
          {
            agent: agentId,
            content: `需要返回：${decisionMode.triggers.join(" / ")}`,
          },
        );
      } catch (error) {
        if (!(error instanceof RetryableExecutionResultError)) {
          throw error;
        }
        if (immediateRetryUsed) {
          await new Promise((resolve) => setTimeout(resolve, RETRYABLE_CLIENT_INTERVAL_MS));
        }
        immediateRetryUsed = true;
      }
    }
  }

  async recoverExecutionResultAfterTransportError(
    cwd: string,
    sessionId: string,
    startedAt: string,
    errorMessage: string,
    timeoutMs = TRANSPORT_ERROR_RECOVERY_TIMEOUT_MS,
  ): Promise<OpenCodeExecutionResult | null> {
    const normalized = path.resolve(cwd);
    const startedAtMs = Date.parse(startedAt);
    const lowerBound = Number.isFinite(startedAtMs) ? startedAtMs - 2_000 : Date.now() - 2_000;
    const deadline = Date.now() + timeoutMs;
    appendAppLog("info", "opencode.transport_recovery_started", {
      cwd: normalized,
      sessionId,
      startedAt,
      errorMessage,
      timeoutMs,
    });

    while (Date.now() < deadline) {
      const inspection = await this.inspectTransportRecovery(normalized, sessionId, lowerBound);
      if (inspection.kind === "recovered") {
        appendAppLog("info", "opencode.transport_recovery_succeeded", {
          cwd: normalized,
          sessionId,
          recoveredMessageId: inspection.result.messageId,
          recoveredAt: inspection.result.timestamp,
        });
        return inspection.result;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const finalInspection = await this.inspectTransportRecovery(normalized, sessionId, lowerBound);
    if (finalInspection.kind === "recovered") {
      appendAppLog("info", "opencode.transport_recovery_succeeded", {
        cwd: normalized,
        sessionId,
        recoveredMessageId: finalInspection.result.messageId,
        recoveredAt: finalInspection.result.timestamp,
      });
      return finalInspection.result;
    }

    appendAppLog("error", "opencode.transport_recovery_timed_out", {
      cwd: normalized,
      sessionId,
      startedAt,
      errorMessage,
      timeoutMs,
      ...this.buildTransportRecoveryTimeoutDetails(finalInspection),
    });
    return null;
  }

  async getSessionRuntime(
    cwd: string,
    sessionId: string,
  ): Promise<OpenCodeSessionRuntime> {
    const list = await this.listSessionMessages(cwd, sessionId, MAX_RUNTIME_MESSAGES);
    if (list.length === 0) {
      return {
        sessionId,
        messageCount: 0,
        updatedAt: null,
        headline: null,
        activeToolNames: [],
        activities: [],
      };
    }
    return this.buildRuntimeSnapshot(sessionId, list);
  }

  async shutdown(cwd: string): Promise<OpenCodeShutdownReport> {
    const normalizedCwd = path.resolve(cwd);
    const state = this.servers.get(normalizedCwd);
    if (!state?.serverHandle) {
      this.clearSessionStateForCwd(normalizedCwd);
      state?.eventSubscribers.clear();
      return {
        killedPids: [],
      };
    }

    let report: OpenCodeShutdownReport = {
      killedPids: [],
    };
    let server: ServeHandle | null = null;
    try {
      server = await state.serverHandle;
      report = await this.terminateServeHandle(server);
    } catch {
      // ignore shutdown errors
    } finally {
      state.serverHandle = null;
      state.eventPump = null;
      state.eventSubscribers.clear();
      this.clearSessionStateForCwd(normalizedCwd);
    }
    return report;
  }

  private resolveConfiguredDecisionMode(
    cwd: string,
    agentId: string,
  ): ConfiguredDecisionMode {
    const configured = this.getWorkspaceServerState(cwd).injectedConfigContent;
    const rawAgent = configured.agent[toOpenCodeAgentId(agentId)];
    if (!rawAgent || typeof rawAgent !== "object" || Array.isArray(rawAgent)) {
      return {
        kind: "plain",
      };
    }
    const prompt = (rawAgent as Record<string, unknown>)["prompt"];
    if (typeof prompt !== "string" || !prompt.trim()) {
      return {
        kind: "plain",
      };
    }

    const contiguousMatches = [
      ...prompt.matchAll(/(?:<([^\s<>/]+)>)(?:\s*(?:\/|、|,|，|or\b|and\b|或)?\s*<([^\s<>/]+)>)+/giu),
    ].flatMap((match) => match[0].match(/<([^\s<>/]+)>/gu) ?? []);
    if (contiguousMatches.length > 0) {
      return {
        kind: "decision",
        triggers: [...new Set(contiguousMatches.map((value) => normalizeTopologyEdgeTrigger(value)))],
      };
    }
    return {
      kind: "plain",
    };
  }

  async shutdownAll(): Promise<OpenCodeShutdownReport> {
    const reports = await Promise.all(
      [...this.servers.keys()].map((cwd) => this.shutdown(cwd)),
    );
    return {
      killedPids: [...new Set(reports.flatMap((report) => report.killedPids))],
    };
  }

  async deleteProject(cwd: string): Promise<void> {
    const key = path.resolve(cwd);
    await this.shutdown(key);
    const state = this.servers.get(key);
    if (!state) {
      return;
    }

    this.servers.delete(key);
  }

  private clearSessionStateForCwd(cwd: string) {
    for (const [sessionId, sessionCwd] of this.sessionCwdBySessionId.entries()) {
      if (sessionCwd !== cwd) {
        continue;
      }
      this.sessionIdleAt.delete(sessionId);
      this.sessionErrors.delete(sessionId);
      this.sessionWaiters.delete(sessionId);
      this.sessionCwdBySessionId.delete(sessionId);
    }
  }

  private async terminateServeHandle(server: ServeHandle): Promise<OpenCodeShutdownReport> {
    const killedPids = this.findListeningPids(server.port)
      .filter((pid) => this.isOpenCodeServeProcess(pid));

    if (server.process) {
      await this.killChildProcessTree(server.process);
    }

    for (const pid of this.findListeningPids(server.port)) {
      if (!this.isOpenCodeServeProcess(pid)) {
        continue;
      }
      this.killProcess(pid);
      killedPids.push(pid);
    }

    return {
      killedPids: [...new Set(killedPids)],
    };
  }

  private async killChildProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
    const pid = child.pid;
    if (!pid) {
      if (!child.killed) {
        child.kill();
      }
      return;
    }

    if (process.platform === "win32") {
      this.killWindowsProcessTree(pid);
      const exited = await this.waitForChildExit(child, 1500);
      if (!exited && !child.killed) {
        child.kill("SIGKILL");
        await this.waitForChildExit(child, 1000);
      }
      return;
    }

    const processTree = this.collectUnixProcessTreePids(pid);
    this.killUnixPids(processTree, "SIGTERM");
    await this.waitForChildExit(child, 1500);
    if (this.findAlivePids(processTree).length === 0) {
      return;
    }

    this.killUnixPids(processTree, "SIGKILL");
    await this.waitForChildExit(child, 1000);
  }

  private waitForChildExit(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number,
  ): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const handleExit = () => {
        clearTimeout(timeout);
        child.off("exit", handleExit);
        resolve(true);
      };
      const timeout = setTimeout(() => {
        child.off("exit", handleExit);
        resolve(false);
      }, timeoutMs);
      child.on("exit", handleExit);
    });
  }

  private killWindowsProcessTree(pid: number) {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch {
      this.killProcess(pid);
    }
  }

  private killUnixPids(targets: number[], signal: NodeJS.Signals) {
    for (const targetPid of targets.reverse()) {
      try {
        process.kill(targetPid, signal);
      } catch {
        // ignore
      }
    }
  }

  private collectUnixProcessTreePids(rootPid: number): number[] {
    try {
      const output = execFileSync("ps", ["-axo", "pid=,ppid="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const childPidsByParent = new Map<number, number[]>();
      for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const [pidText, parentPidText] = trimmed.split(/\s+/);
        const pid = Number(pidText);
        const parentPid = Number(parentPidText);
        if (!Number.isInteger(pid) || !Number.isInteger(parentPid) || pid <= 0 || parentPid <= 0) {
          continue;
        }
        const current = childPidsByParent.get(parentPid) ?? [];
        current.push(pid);
        childPidsByParent.set(parentPid, current);
      }

      const ordered: number[] = [];
      const pending = [rootPid];
      while (pending.length > 0) {
        const currentPid = pending.pop();
        if (!currentPid || ordered.includes(currentPid)) {
          continue;
        }
        ordered.push(currentPid);
        for (const childPid of childPidsByParent.get(currentPid) ?? []) {
          pending.push(childPid);
        }
      }
      return ordered;
    } catch {
      return [rootPid];
    }
  }

  private findAlivePids(targets: number[]): number[] {
    return targets.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  }

  protected async startServer(cwd: string): Promise<ServeHandle> {
    const state = this.getWorkspaceServerState(cwd);

    const serverEnv = { ...process.env };
    // Isolate the embedded runtime from parent OpenCode config injection.
    delete serverEnv["OPENCODE_CONFIG"];
    delete serverEnv["OPENCODE_CONFIG_CONTENT"];
    delete serverEnv["OPENCODE_CONFIG_DIR"];
    delete serverEnv["OPENCODE_DB"];
    delete serverEnv["OPENCODE_CLIENT"];
    serverEnv["OPENCODE_CLIENT"] = "agent-team-orchestrator";
    serverEnv["OPENCODE_DISABLE_PROJECT_CONFIG"] = "true";
    appendAppLog("info", "opencode.serve_starting", {
      cwd: state.cwd,
    });
    const launchArgs = ["serve"];
    const spawnSpec = process.platform === "win32"
      ? {
          command: resolveWindowsCmdPath(serverEnv),
          args: [
            "/d",
            "/s",
            "/c",
            `cd /d ${state.cwd} && opencode ${launchArgs.join(" ")}`,
          ],
        }
      : {
          command: "opencode",
          args: launchArgs,
        };
    const childProcess = spawn(
      spawnSpec.command,
      spawnSpec.args,
      {
        env: serverEnv,
        stdio: "pipe",
      },
    );

    let spawnErrorMessage: string | null = null;
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    childProcess.on("error", (error) => {
      spawnErrorMessage = error instanceof Error ? error.message : String(error);
    });

    childProcess.stderr.on("data", (chunk) => {
      stderrChunks.push(this.normalizeProcessOutput(chunk));
    });
    childProcess.stdout.on("data", (chunk) => {
      stdoutChunks.push(this.normalizeProcessOutput(chunk));
    });

    const baseUrl = await this.waitForServeBaseUrl(childProcess, stdoutChunks, stderrChunks).catch(async (error) => {
      await this.killChildProcessTree(childProcess).catch(() => undefined);
      appendAppLog("error", "opencode.serve_start_failed", {
        cwd: state.cwd,
        command: spawnSpec.command,
        args: spawnSpec.args,
        message: error instanceof Error ? error.message : String(error),
        stdout: this.truncateLogPayload(stdoutChunks.join("")),
        stderr: this.truncateLogPayload(stderrChunks.join("")),
      });
      throw error;
    });
    const port = this.parsePortFromBaseUrl(baseUrl);
    const healthy = await this.waitForHealthy(baseUrl);
    if (spawnErrorMessage !== null || !healthy) {
      const message = spawnErrorMessage !== null
        ? `OpenCode serve 启动失败: ${spawnErrorMessage}`
          : `OpenCode serve 健康检查失败: ${baseUrl}/global/health 未在预期时间内返回成功`;
      await this.killChildProcessTree(childProcess).catch(() => undefined);
      appendAppLog("error", "opencode.serve_start_failed", {
        cwd: state.cwd,
        port,
        baseUrl,
        command: spawnSpec.command,
        args: spawnSpec.args,
        message,
        stdout: this.truncateLogPayload(stdoutChunks.join("")),
        stderr: this.truncateLogPayload(stderrChunks.join("")),
      });
      throw new Error(message);
    }

    appendAppLog("info", "opencode.serve_started", {
      cwd: state.cwd,
      port,
      baseUrl,
      command: spawnSpec.command,
      args: spawnSpec.args,
    });

    return {
      process: childProcess,
      port,
    };
  }

  async getAttachBaseUrl(cwd: string): Promise<string> {
    const server = await this.ensureServer(cwd);
    return this.buildBaseUrl(server.port);
  }

  private findListeningPids(port: number): number[] {
    try {
      if (process.platform === "win32") {
        const output = execFileSync("netstat", ["-ano", "-p", "tcp"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        return output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.includes("LISTENING"))
          .filter((line) => line.includes(`:${port}`))
          .map((line) => {
            const parts = line.split(/\s+/);
            return Number(parts.at(-1));
          })
          .filter((pid) => Number.isInteger(pid) && pid > 0);
      }

      const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return output
        .split(/\n/)
        .filter((line) => line.startsWith("p"))
        .map((line) => Number(line.slice(1)))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
    } catch {
      return [];
    }
  }

  private isOpenCodeServeProcess(pid: number): boolean {
    try {
      if (process.platform === "win32") {
        const output = execFileSync("tasklist", ["/FI", `PID eq ${pid}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        return output.toLowerCase().includes("opencode");
      }

      const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return command.includes("opencode") && command.includes("serve");
    } catch {
      return false;
    }
  }

  private killProcess(pid: number) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }

    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
    }

    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }

  private async startEventPump(
    onEvent: (event: OpenCodeEvent) => void,
    server: ServeHandle,
    cwd: string,
  ): Promise<void> {
    try {
      const response = await fetch(`${this.buildBaseUrl(server.port)}/global/event`);
      if (!response.ok || !response.body) {
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const dataLines = chunk
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());

          for (const dataLine of dataLines) {
            if (!dataLine) {
              continue;
            }

            try {
              const event = parseJson5<OpenCodeEvent>(dataLine);
              this.handleEvent(event);
              onEvent(event);
            } catch {
              onEvent({ payload: { raw: dataLine } });
            }
          }
        }
      }
    } finally {
      const state = this.servers.get(cwd);
      if (state) {
        state.eventPump = null;
      }
    }
  }

  private handleEvent(event: OpenCodeEvent) {
    const eventType = typeof event["type"] === "string" ? event["type"] : "";
    const properties = this.asRecord(event["properties"]);

    if (eventType === "session.idle") {
      const sessionId = typeof properties["sessionID"] === "string" ? properties["sessionID"] : null;
      if (!sessionId) {
        return;
      }
      this.sessionIdleAt.set(sessionId, Date.now());
      const waiters = this.sessionWaiters.get(sessionId) ?? [];
      const ready = waiters.filter((waiter) => waiter.after <= Date.now());
      this.sessionWaiters.set(
        sessionId,
        waiters.filter((waiter) => waiter.after > Date.now()),
      );
      for (const waiter of ready) {
        waiter.resolve();
      }
      return;
    }

    if (eventType === "session.error") {
      const sessionId = typeof properties["sessionID"] === "string" ? properties["sessionID"] : null;
      if (!sessionId) {
        return;
      }
      const error = this.extractEventError(properties["error"]) ?? "OpenCode session 发生未知错误";
      this.sessionErrors.set(sessionId, error);
      const waiters = this.sessionWaiters.get(sessionId) ?? [];
      this.sessionWaiters.delete(sessionId);
      for (const waiter of waiters) {
        waiter.reject(new Error(error));
      }
    }
  }

  protected async request(
    pathname: string,
    options: {
      method: "GET" | "POST";
      cwd: string;
      body?: string;
    },
  ): Promise<Response> {
    const normalized = path.resolve(options.cwd);
    const headers: Record<string, string> = {};
    if (options.body) {
      headers["content-type"] = "application/json";
    }
    headers["x-opencode-directory"] = normalized;

    const timeoutMs = resolveOpenCodeRequestTimeoutMs({
      pathname,
      method: options.method,
    });
    const requestWithServer = async (server: ServeHandle) => {
      const url = `${this.buildBaseUrl(server.port)}${pathname}`;
      return this.fetchWithTimeout(url, withOptionalValue({
        method: options.method,
        headers,
      }, "body", options.body), timeoutMs);
    };
    const server = await this.ensureServer(normalized);
    const url = `${this.buildBaseUrl(server.port)}${pathname}`;
    try {
      return await requestWithServer(server);
    } catch (error) {
      appendAppLog("error", "opencode.request_failed", {
        cwd: normalized,
        method: options.method,
        url,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number | null): Promise<Response> {
    if (timeoutMs === null) {
      return fetch(url, init);
    }
    const controller = new AbortController();
    const timeoutMessage = `OpenCode 请求超时: ${(init.method ?? "GET").toUpperCase()} ${url} 超过 ${timeoutMs}ms`;
    const timeout = setTimeout(() => {
      controller.abort(new Error(timeoutMessage));
    }, timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(timeoutMessage);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async waitForSessionSettled(sessionId: string, after: number, timeoutMs: number): Promise<void> {
    const idleAt = this.sessionIdleAt.get(sessionId);
    if (typeof idleAt === "number" && idleAt >= after) {
      return;
    }

    const error = this.sessionErrors.get(sessionId);
    if (error) {
      throw new Error(error);
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: SessionWaiter = {
        sessionId,
        after,
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (reason) => {
          clearTimeout(timeout);
          reject(reason);
        },
      };
      const timeout = setTimeout(() => {
        const waiters = this.sessionWaiters.get(sessionId) ?? [];
        this.sessionWaiters.set(
          sessionId,
          waiters.filter((item) => item !== waiter),
        );
        resolve();
      }, timeoutMs);

      this.sessionWaiters.set(sessionId, [...(this.sessionWaiters.get(sessionId) ?? []), waiter]);
    });
  }

  async waitForMessageCompletion(
    cwd: string,
    sessionId: string,
    messageId: string,
    fallbackTimestamp: string,
    timeoutMs: number,
  ): Promise<OpenCodeNormalizedMessage | null> {
    const startedAt = Date.now();
    let latestNonEmptyMessage: OpenCodeNormalizedMessage | null = null;
    while (Date.now() - startedAt < timeoutMs) {
      const message = await this.getSessionMessage(cwd, sessionId, messageId);
      if (message?.content.trim()) {
        latestNonEmptyMessage = message;
      }
      if (message && this.isTerminalMessage(message)) {
        return message;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    return this.getSessionMessage(cwd, sessionId, messageId).then(
      (message) =>
        message ??
        latestNonEmptyMessage ?? {
          id: messageId,
          content: "",
          sender: "assistant",
          timestamp: toUtcIsoTimestamp(fallbackTimestamp),
          error: null,
          raw: null,
        },
    );
  }

  async getLatestAssistantMessage(
    cwd: string,
    sessionId: string,
  ): Promise<OpenCodeNormalizedMessage | null> {
    const list = await this.listSessionMessages(cwd, sessionId);
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const message = this.normalizeMessageEnvelope(list[index], "assistant");
      if (message.sender === "assistant" || message.sender === "system" || message.sender === "unknown") {
        return message;
      }
    }
    return null;
  }

  private async inspectTransportRecovery(
    cwd: string,
    sessionId: string,
    lowerBoundMs: number,
  ): Promise<TransportRecoveryInspection> {
    const messages = await this.listSessionMessages(cwd, sessionId, MAX_RUNTIME_MESSAGES);
    if (messages.length === 0) {
      return {
        kind: "empty",
        messageCount: 0,
      };
    }

    const normalizedRecords = messages.map((raw) => {
      const envelope = this.asRecord(raw);
      const info = this.asRecord(envelope["info"] ?? raw);
      const normalized = this.normalizeMessageEnvelope(raw, "assistant");
      return {
        raw,
        info,
        normalized,
        createdAtMs: Date.parse(normalized.timestamp),
      };
    });

    const submittedMessage = normalizedRecords
      .filter((record) =>
        record.normalized.sender === "user"
        && Number.isFinite(record.createdAtMs)
        && record.createdAtMs >= lowerBoundMs)
      .sort((left, right) => left.createdAtMs - right.createdAtMs)[0];
    if (!submittedMessage) {
      return {
        kind: "submitted-message-missing",
        messageCount: messages.length,
      };
    }

    const relatedReplies = this.collectRelatedTransportReplies(normalizedRecords, submittedMessage.normalized.id)
      .sort((left, right) => {
        const leftTimestamp = Date.parse(left.normalized.timestamp) || 0;
        const rightTimestamp = Date.parse(right.normalized.timestamp) || 0;
        return rightTimestamp - leftTimestamp;
      });

    const latestRelatedReply = relatedReplies[0];
    const finalReply = relatedReplies
      .filter((record) =>
        this.isRecoverableReplyCandidate(record.info, record.normalized))[0];
    if (!finalReply) {
      if (!latestRelatedReply) {
        return {
          kind: "waiting-without-related-reply",
          messageCount: messages.length,
        };
      }

      return {
        kind: "waiting-with-related-reply",
        messageCount: messages.length,
        relatedReplyCount: relatedReplies.length,
        latestRelatedReply: this.buildRelatedTransportReplySnapshot(latestRelatedReply),
      };
    }

    const message = finalReply.normalized;
    return {
      kind: "recovered",
      result: {
        status: message.error ? "error" : "completed",
        finalMessage: message.content || message.error || "",
        messageId: message.id,
        timestamp: message.timestamp,
        rawMessage: message,
      },
      messageCount: messages.length,
    };
  }

  private buildTransportRecoveryTimeoutDetails(inspection: Exclude<TransportRecoveryInspection, { kind: "recovered" }>) {
    const baseDetails = {
      observedMessageCount: inspection.messageCount,
      recoveryState: inspection.kind,
    };
    if (inspection.kind === "waiting-with-related-reply") {
      return {
        ...baseDetails,
        relatedReplyCount: inspection.relatedReplyCount,
        latestRelatedMessageId: inspection.latestRelatedReply.messageId,
        latestRelatedParentMessageId: inspection.latestRelatedReply.parentMessageId,
        latestRelatedTimestamp: inspection.latestRelatedReply.timestamp,
        latestRelatedFinish: inspection.latestRelatedReply.finish,
      };
    }

    return baseDetails;
  }

  private buildRelatedTransportReplySnapshot(record: {
    info: Record<string, unknown>;
    normalized: OpenCodeNormalizedMessage;
  }): RelatedTransportReplySnapshot {
    const parentMessageId = this.extractParentMessageId(record.info);
    if (!parentMessageId) {
      throw new Error(`Transport recovery related reply 缺少 parentID: messageId=${record.normalized.id}`);
    }

    return {
      messageId: record.normalized.id,
      timestamp: record.normalized.timestamp,
      finish: this.resolveTransportReplyFinish(record.info),
      parentMessageId,
    };
  }

  private collectRelatedTransportReplies(
    records: Array<{
      raw: unknown;
      info: Record<string, unknown>;
      normalized: OpenCodeNormalizedMessage;
      createdAtMs: number;
    }>,
    rootMessageId: string,
  ) {
    const childrenByParent = new Map<string, typeof records>();
    for (const record of records) {
      const parentMessageId = this.extractParentMessageId(record.info);
      if (!parentMessageId) {
        continue;
      }
      const siblings = childrenByParent.get(parentMessageId) ?? [];
      siblings.push(record);
      childrenByParent.set(parentMessageId, siblings);
    }

    const relatedReplies: typeof records = [];
    const pending = [...(childrenByParent.get(rootMessageId) ?? [])];
    const seenMessageIds = new Set<string>();

    while (pending.length > 0) {
      const current = pending.shift();
      if (!current) {
        continue;
      }
      const currentMessageId = current.normalized.id;
      if (seenMessageIds.has(currentMessageId)) {
        continue;
      }
      seenMessageIds.add(currentMessageId);
      if (
        current.normalized.sender !== "assistant"
        && current.normalized.sender !== "system"
        && current.normalized.sender !== "unknown"
      ) {
        continue;
      }
      relatedReplies.push(current);
      pending.push(...(childrenByParent.get(currentMessageId) ?? []));
    }

    return relatedReplies;
  }

  private resolveTransportReplyFinish(info: Record<string, unknown>): string {
    if (typeof info["finish"] !== "string") {
      return "unknown";
    }

    const finish = info["finish"].trim();
    return finish || "unknown";
  }

  async getSessionMessage(
    cwd: string,
    sessionId: string,
    messageId: string,
  ): Promise<OpenCodeNormalizedMessage | null> {
    const response = await this.request(`/session/${sessionId}/message/${messageId}`, {
      method: "GET",
      cwd,
    });
    if (!response.ok) {
      return null;
    }
    const raw = await this.readJsonResponse(response);
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return this.normalizeMessageEnvelope(raw as Record<string, unknown>, "assistant");
  }

  async listSessionMessages(
    cwd: string,
    sessionId: string,
    limit?: number,
  ): Promise<unknown[]> {
    const pathname = limit
      ? `/session/${sessionId}/message?limit=${limit}`
      : `/session/${sessionId}/message`;
    const response = await this.request(pathname, {
      method: "GET",
      cwd,
    });
    if (!response.ok) {
      return [];
    }

    const raw = await this.readJsonResponse(response);
    return Array.isArray(raw) ? raw : [];
  }

  private async readJsonResponse(response: Response): Promise<unknown | null> {
    const raw = await response.text();
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return parseJson5(trimmed);
    } catch {
      return null;
    }
  }

  private normalizeMessageEnvelope(
    raw: unknown,
    fallbackSender: string,
  ): OpenCodeNormalizedMessage {
    const envelope = this.asRecord(raw);
    const info = this.asRecord(envelope["info"] ?? raw);
    const parts = Array.isArray(envelope["parts"]) ? (envelope["parts"] as Array<Record<string, unknown>>) : [];
    const time = this.asRecord(info["time"]);
    const created =
      this.toIsoString(time["created"]) ??
      this.toIsoString(info["createdAt"]) ??
      new Date().toISOString();
    const completed =
      this.toIsoString(time["completed"]) ??
      this.toIsoString(info["completedAt"]) ??
      null;
    const sender =
      typeof info["role"] === "string"
        ? info["role"]
        : typeof envelope["sender"] === "string"
          ? envelope["sender"]
          : fallbackSender;
    const content =
      parts.length > 0
        ? this.extractVisibleMessageText(parts)
        : typeof envelope["content"] === "string"
          ? envelope["content"]
          : typeof envelope["text"] === "string"
            ? envelope["text"]
            : "";

    return {
      id:
        (typeof info["id"] === "string" ? info["id"] : null) ??
        (typeof envelope["id"] === "string" ? envelope["id"] : null) ??
        randomUUID(),
      content,
      sender,
      timestamp: toUtcIsoTimestamp(completed ?? created),
      error: this.extractEventError(info["error"] ?? envelope["error"]),
      raw,
    };
  }

  private isTerminalMessage(message: OpenCodeNormalizedMessage): boolean {
    return this.hasCompletedTimestamp(message.raw) || message.error !== null;
  }

  private hasCompletedTimestamp(raw: unknown): boolean {
    const envelope = this.asRecord(raw);
    const info = this.asRecord(envelope["info"] ?? raw);
    const time = this.asRecord(info["time"]);
    return (
      this.toIsoString(time["completed"]) !== null ||
      this.toIsoString(info["completedAt"]) !== null
    );
  }

  private buildEmptyAssistantResultError(
    sessionId: string,
    message: OpenCodeNormalizedMessage,
  ): string {
    const record = this.asRecord(message.raw);
    const info = this.asRecord(record["info"] ?? message.raw);
    const parts = Array.isArray(record["parts"]) ? (record["parts"] as Array<Record<string, unknown>>) : [];
    const finish = typeof info["finish"] === "string" && info["finish"].trim()
      ? info["finish"].trim()
      : "unknown";
    const partTypes = parts
      .map((part) => (typeof part["type"] === "string" ? part["type"].trim() : ""))
      .filter(Boolean);
    const partSummary = partTypes.length > 0 ? partTypes.join(",") : "none";
    return `OpenCode session ${sessionId} 返回了空的 assistant 结果: messageId=${message.id}, finish=${finish}, partTypes=${partSummary}`;
  }

  private extractParentMessageId(info: Record<string, unknown>): string | null {
    return typeof info["parentID"] === "string" && info["parentID"].trim()
      ? info["parentID"]
      : null;
  }

  private isRecoverableReplyCandidate(
    info: Record<string, unknown>,
    message: OpenCodeNormalizedMessage,
  ): boolean {
    if (message.sender !== "assistant" && message.sender !== "system" && message.sender !== "unknown") {
      return false;
    }

    if (message.error) {
      return true;
    }

    return this.isTerminalRecoverableFinish(info) && message.content.trim().length > 0;
  }

  private isTerminalRecoverableFinish(info: Record<string, unknown>): boolean {
    if (typeof info["finish"] !== "string") {
      return false;
    }

    const finish = info["finish"].trim();
    return finish.length > 0 && finish !== "tool-calls";
  }

  buildRuntimeSnapshot(sessionId: string, messages: unknown[]): OpenCodeSessionRuntime {
    const activities: OpenCodeRuntimeActivity[] = [];
    const toolNames: string[] = [];
    const seen = new Set<string>();

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
      const raw = messages[messageIndex];
      const normalized = this.normalizeMessageEnvelope(raw, "assistant");
      if (normalized.sender === "user") {
        continue;
      }

      const record = this.asRecord(raw);
      const parts = Array.isArray(record["parts"]) ? (record["parts"] as Array<Record<string, unknown>>) : [];
      const extracted = this.extractRuntimeActivities(parts, normalized, messageIndex);

      if (extracted.length === 0 && normalized.content.trim()) {
        extracted.push({
          id: `${normalized.id}:message`,
          kind: "message",
          label: this.shortenText(normalized.content, 48),
          detail: normalized.content.trim(),
          detailState: "not_applicable",
          detailPayloadKeyCount: 0,
          detailHasPlaceholderValue: false,
          detailParseMode: "not_applicable",
          timestamp: normalized.timestamp,
        });
      }

      for (const activity of extracted) {
        const signature = `${activity.kind}:${activity.label}:${activity.detail}:${activity.timestamp}`;
        if (seen.has(signature)) {
          continue;
        }
        seen.add(signature);
        activities.push(activity);
        if (activity.kind === "tool") {
          const toolName = activity.label.replace(/^tool:\s*/i, "").trim();
          if (toolName && !toolNames.includes(toolName)) {
            toolNames.push(toolName);
          }
        }
      }
    }

    const latestActivity = activities.at(-1) ?? null;
    const recentToolNames = activities
      .filter((activity) => activity.kind === "tool")
      .map((activity) => activity.label.replace(/^tool:\s*/i, "").trim())
      .filter((toolName, index, all) => Boolean(toolName) && all.indexOf(toolName) === index)
      .slice(-2)
      .reverse();

    return {
      sessionId,
      messageCount: messages.length,
      updatedAt: latestActivity?.timestamp ?? null,
      headline: latestActivity?.detail ?? null,
      activeToolNames: recentToolNames.length > 0 ? recentToolNames : toolNames.slice(-2).reverse(),
      activities,
    };
  }

  private extractRuntimeActivities(
    parts: Array<Record<string, unknown>>,
    message: OpenCodeNormalizedMessage,
    messageIndex: number,
  ): OpenCodeRuntimeActivity[] {
    const activities: OpenCodeRuntimeActivity[] = [];

    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex];
      if (!part) {
        continue;
      }
      const activity = this.partToRuntimeActivity(part, message, messageIndex, partIndex);
      if (activity) {
        activities.push(activity);
      }
    }

    return activities;
  }

  private partToRuntimeActivity(
    part: Record<string, unknown>,
    message: OpenCodeNormalizedMessage,
    messageIndex: number,
    partIndex: number,
  ): OpenCodeRuntimeActivity | null {
    const type = typeof part["type"] === "string" ? part["type"] : "";
    const timestamp = message.timestamp;
    const toolName = this.extractToolName(part);

    if (toolName) {
      const toolDetail = this.extractToolCallDetail(part);
      return {
        id: `${message.id}:${messageIndex}:${partIndex}:tool`,
        kind: "tool",
        label: toolName,
        detail: toolDetail.detail || "未获取到调用参数",
        detailState: toolDetail.detail ? "complete" : "missing",
        detailPayloadKeyCount: toolDetail.payloadKeyCount,
        detailHasPlaceholderValue: toolDetail.hasPlaceholderValue,
        detailParseMode: toolDetail.parseMode,
        timestamp,
      };
    }

    const reasoningDetail = this.extractReasoningDetail(part);
    if (reasoningDetail) {
      return {
        id: `${message.id}:${messageIndex}:${partIndex}:thinking`,
        kind: "thinking",
        label: this.shortenText(reasoningDetail, 48),
        detail: reasoningDetail,
        detailState: "not_applicable",
        detailPayloadKeyCount: 0,
        detailHasPlaceholderValue: false,
        detailParseMode: "not_applicable",
        timestamp,
      };
    }

    if (type === "step-start" && typeof part["name"] === "string" && part["name"].trim()) {
      const detail = this.extractPartDetail(part);
      return {
        id: `${message.id}:${messageIndex}:${partIndex}:step`,
        kind: "step",
        label: part["name"].trim(),
        detail: detail || `执行步骤：${part["name"].trim()}`,
        detailState: "not_applicable",
        detailPayloadKeyCount: 0,
        detailHasPlaceholderValue: false,
        detailParseMode: "not_applicable",
        timestamp,
      };
    }

    const detail = this.extractPartDetail(part);
    if (!detail) {
      return null;
    }

    return {
      id: `${message.id}:${messageIndex}:${partIndex}:message`,
      kind: "message",
      label: this.shortenText(detail, 48),
      detail,
      detailState: "not_applicable",
      detailPayloadKeyCount: 0,
      detailHasPlaceholderValue: false,
      detailParseMode: "not_applicable",
      timestamp,
    };
  }

  private extractToolName(part: Record<string, unknown>): string | null {
    const type = typeof part["type"] === "string" ? part["type"].toLowerCase() : "";
    const directTool =
      (typeof part["toolName"] === "string" && part["toolName"].trim()) ||
      (typeof part["tool"] === "string" && part["tool"].trim()) ||
      (typeof part["name"] === "string" && part["name"].trim()) ||
      null;

    if (directTool && type.includes("tool")) {
      return directTool;
    }

    const toolRecord = this.asRecord(part["tool"]);
    if (typeof toolRecord["name"] === "string" && toolRecord["name"].trim()) {
      return toolRecord["name"].trim();
    }
    if (typeof toolRecord["id"] === "string" && toolRecord["id"].trim()) {
      return toolRecord["id"].trim();
    }

    const callRecord = this.asRecord(part["call"]);
    if (typeof callRecord["tool"] === "string" && callRecord["tool"].trim()) {
      return callRecord["tool"].trim();
    }
    if (typeof callRecord["name"] === "string" && callRecord["name"].trim()) {
      return callRecord["name"].trim();
    }
    if (typeof callRecord["id"] === "string" && callRecord["id"].trim()) {
      return callRecord["id"].trim();
    }

    return null;
  }

  private extractPartDetail(part: Record<string, unknown>): string {
    const textCandidates = [
      typeof part["summary"] === "string" ? part["summary"] : "",
      typeof part["text"] === "string" ? part["text"] : "",
      typeof part["title"] === "string" ? part["title"] : "",
      typeof part["description"] === "string" ? part["description"] : "",
      this.extractStructuredDetail(part["input"]),
      this.extractStructuredDetail(part["args"]),
      this.extractStructuredDetail(part["arguments"]),
      this.extractStructuredDetail(part["payload"]),
      this.extractStructuredDetail(part["output"]),
    ]
      .map((value) => value.trim())
      .filter(Boolean);

    return textCandidates[0] ?? "";
  }

  private extractReasoningDetail(part: Record<string, unknown>): string {
    const type = typeof part["type"] === "string" ? part["type"].toLowerCase() : "";
    if (type === "reasoning" && typeof part["text"] === "string") {
      return part["text"].trim();
    }
    if (typeof part["reasoning"] === "string") {
      return part["reasoning"].trim();
    }

    return "";
  }

  private extractToolCallDetail(part: Record<string, unknown>): {
    detail: string;
    payloadKeyCount: number;
    hasPlaceholderValue: boolean;
    parseMode: OpenCodeRuntimeActivity["detailParseMode"];
  } {
    const callRecord = this.asRecord(part["call"]);
    const toolRecord = this.asRecord(part["tool"]);
    const metadataRecord = this.asRecord(part["metadata"]);
    const stateRecord = this.asRecord(part["state"]);
    const candidates: unknown[] = [
      stateRecord["input"],
      stateRecord["args"],
      stateRecord["arguments"],
      stateRecord["payload"],
      stateRecord["options"],
      stateRecord["params"],
      stateRecord["data"],
      stateRecord["body"],
      part["input"],
      part["args"],
      part["arguments"],
      part["payload"],
      part["options"],
      part["params"],
      part["data"],
      part["body"],
      callRecord["input"],
      callRecord["args"],
      callRecord["arguments"],
      callRecord["payload"],
      callRecord["options"],
      callRecord["params"],
      callRecord["data"],
      callRecord["body"],
      toolRecord["input"],
      toolRecord["args"],
      toolRecord["arguments"],
      toolRecord["payload"],
      toolRecord["options"],
      toolRecord["params"],
      toolRecord["data"],
      toolRecord["body"],
      metadataRecord["input"],
      metadataRecord["args"],
      metadataRecord["arguments"],
      metadataRecord["payload"],
      metadataRecord["options"],
      metadataRecord["params"],
      metadataRecord["data"],
      metadataRecord["body"],
    ];
    for (const candidate of candidates) {
      const summary = this.extractStructuredToolCallDetail(candidate);
      if (!summary.detail) {
        continue;
      }
      return {
        detail: `参数: ${summary.detail}`,
        payloadKeyCount: summary.payloadKeyCount,
        hasPlaceholderValue: summary.hasPlaceholderValue,
        parseMode: summary.parseMode,
      };
    }
    return {
      detail: "",
      payloadKeyCount: 0,
      hasPlaceholderValue: false,
      parseMode: "missing",
    };
  }

  private extractStructuredToolCallDetail(value: unknown, depth = 0): {
    detail: string;
    payloadKeyCount: number;
    hasPlaceholderValue: boolean;
    parseMode: OpenCodeRuntimeActivity["detailParseMode"];
  } {
    if (value == null || depth > 4) {
      return {
        detail: "",
        payloadKeyCount: 0,
        hasPlaceholderValue: false,
        parseMode: "missing",
      };
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return {
          detail: "",
          payloadKeyCount: 0,
          hasPlaceholderValue: false,
          parseMode: "missing",
        };
      }
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          return this.extractStructuredToolCallDetail(
            parseJson5(trimmed),
            depth + 1,
          );
        } catch {
          return {
            detail: this.shortenText(trimmed, 160),
            payloadKeyCount: 0,
            hasPlaceholderValue: this.isPlaceholderLikeValue(trimmed),
            parseMode: "plain_text",
          };
        }
      }
      return {
        detail: this.shortenText(trimmed, 160),
        payloadKeyCount: 0,
        hasPlaceholderValue: this.isPlaceholderLikeValue(trimmed),
        parseMode: "plain_text",
      };
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return {
        detail: String(value),
        payloadKeyCount: 0,
        hasPlaceholderValue: false,
        parseMode: "plain_text",
      };
    }

    if (Array.isArray(value)) {
      const items = value
        .map((item) => this.extractStructuredToolCallDetail(item, depth + 1))
        .filter((item) => item.detail)
        .slice(0, 6);
      const detail = items.length > 0
        ? this.shortenText(
            `[${items.map((item) => item.detail).join(", ")}]`,
            180,
          )
        : "";
      return {
        detail,
        payloadKeyCount: items.reduce(
          (sum, item) => sum + item.payloadKeyCount,
          value.length,
        ),
        hasPlaceholderValue: items.some((item) => item.hasPlaceholderValue),
        parseMode: detail ? "structured" : "missing",
      };
    }

    const record = this.asRecord(value);
    const preferredEntries = Object.entries(record)
      .filter(([key, item]) => {
        if (item == null || item === "") {
          return false;
        }
        return !["output", "result", "response", "summary", "reasoning"].includes(key);
      })
      .slice(0, 6)
      .map(([key, item]) => {
        const summarized = this.extractStructuredToolCallDetail(item, depth + 1);
        return summarized.detail
          ? {
              detail: `${key}=${summarized.detail}`,
              payloadKeyCount: summarized.payloadKeyCount,
              hasPlaceholderValue: summarized.hasPlaceholderValue,
            }
          : null;
      })
      .filter((item): item is {
        detail: string;
        payloadKeyCount: number;
        hasPlaceholderValue: boolean;
      } => item !== null);

    if (preferredEntries.length > 0) {
      return {
        detail: this.shortenText(
          preferredEntries.map((item) => item.detail).join(", "),
          220,
        ),
        payloadKeyCount: preferredEntries.reduce(
          (sum, item) => sum + item.payloadKeyCount,
          preferredEntries.length,
        ),
        hasPlaceholderValue: preferredEntries.some(
          (item) => item.hasPlaceholderValue,
        ),
        parseMode: "structured",
      };
    }

    for (const key of [
      "input",
      "args",
      "arguments",
      "payload",
      "options",
      "params",
      "data",
      "body",
    ]) {
      if (!(key in record)) {
        continue;
      }
      const nested = this.extractStructuredToolCallDetail(
        record[key],
        depth + 1,
      );
      if (nested.detail) {
        return nested;
      }
    }

    return {
      detail: "",
      payloadKeyCount: 0,
      hasPlaceholderValue: false,
      parseMode: "missing",
    };
  }

  private isPlaceholderLikeValue(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === "placeholder"
      || normalized === "<placeholder>"
      || normalized === "todo"
      || normalized === "tbd"
      || normalized === "unknown";
  }

  private extractStructuredArgsDetail(value: unknown, depth = 0): string {
    if (value == null || depth > 4) {
      return "";
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return "";
      }
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          return this.extractStructuredArgsDetail(parseJson5(trimmed), depth + 1);
        } catch {
          return this.shortenText(trimmed, 160);
        }
      }
      return this.shortenText(trimmed, 160);
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (Array.isArray(value)) {
      const items = value
        .map((item) => this.extractStructuredArgsDetail(item, depth + 1))
        .filter(Boolean)
        .slice(0, 6);
      return items.length > 0 ? this.shortenText(`[${items.join(", ")}]`, 180) : "";
    }

    const record = this.asRecord(value);
    const preferredEntries = Object.entries(record)
      .filter(([key, item]) => {
        if (item == null || item === "") {
          return false;
        }
        return !["output", "result", "response", "summary", "reasoning"].includes(key);
      })
      .slice(0, 6)
      .map(([key, item]) => {
        const summarized = this.extractStructuredArgsDetail(item, depth + 1);
        return summarized ? `${key}=${summarized}` : "";
      })
      .filter(Boolean);

    if (preferredEntries.length > 0) {
      return this.shortenText(preferredEntries.join(", "), 220);
    }

    for (const key of ["input", "args", "arguments", "payload", "options", "params", "data", "body"]) {
      if (key in record) {
        const nested = this.extractStructuredArgsDetail(record[key], depth + 1);
        if (nested) {
          return nested;
        }
      }
    }

    return "";
  }

  private extractStructuredDetail(value: unknown, depth = 0): string {
    if (value == null || depth > 3) {
      return "";
    }

    if (typeof value === "string") {
      return this.shortenText(value, 120);
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (Array.isArray(value)) {
      const items = value
        .map((item) => this.extractStructuredDetail(item, depth + 1))
        .filter(Boolean)
        .slice(0, 4);
      return items.length > 0 ? this.shortenText(`[${items.join(", ")}]`, 140) : "";
    }

    const record = this.asRecord(value);
    const direct = [
      typeof record["command"] === "string" ? record["command"] : "",
      typeof record["cmd"] === "string" ? record["cmd"] : "",
      typeof record["path"] === "string" ? record["path"] : "",
      typeof record["file"] === "string" ? record["file"] : "",
      typeof record["pattern"] === "string" ? record["pattern"] : "",
      typeof record["query"] === "string" ? record["query"] : "",
      typeof record["message"] === "string" ? record["message"] : "",
      typeof record["text"] === "string" ? record["text"] : "",
      typeof record["url"] === "string" ? record["url"] : "",
      typeof record["location"] === "string" ? record["location"] : "",
      typeof record["agent"] === "string" ? record["agent"] : "",
      typeof record["name"] === "string" ? record["name"] : "",
    ]
      .map((item) => item.trim())
      .filter(Boolean);

    if (direct[0]) {
      return this.shortenText(direct[0], 120);
    }

    for (const key of ["input", "args", "arguments", "payload", "options", "params", "data"]) {
      if (key in record) {
        const nested = this.extractStructuredDetail(record[key], depth + 1);
        if (nested) {
          return nested;
        }
      }
    }

    const entries = Object.entries(record)
      .filter(([, item]) => item != null && item !== "")
      .slice(0, 4)
      .map(([key, item]) => {
        const summarized = this.extractStructuredDetail(item, depth + 1) || this.shortenText(String(item), 40);
        return summarized ? `${key}=${summarized}` : "";
      })
      .filter(Boolean);

    return entries.length > 0 ? this.shortenText(entries.join(", "), 160) : "";
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  private extractEventError(value: unknown): string | null {
    const record = this.asRecord(value);
    if (typeof record["message"] === "string") {
      return record["message"];
    }
    const data = this.asRecord(record["data"]);
    if (typeof data["message"] === "string") {
      return data["message"];
    }
    return null;
  }

  private toIsoString(value: unknown): string | null {
    if (typeof value === "string") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
    }
    if (typeof value === "number") {
      return new Date(value).toISOString();
    }
    return null;
  }

  private async waitForHealthy(baseUrl: string): Promise<boolean> {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}/global/health`);
        if (response.ok) {
          return true;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }

    return false;
  }

  private async waitForServeBaseUrl(
    child: ChildProcessWithoutNullStreams,
    stdoutChunks: string[],
    stderrChunks: string[],
  ): Promise<string> {
    const readCurrent = () => extractOpenCodeServeBaseUrl(`${stdoutChunks.join("")}\n${stderrChunks.join("")}`);
    const existing = readCurrent();
    if (existing) {
      return existing;
    }

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        child.off("error", handleError);
        child.off("exit", handleExit);
        child.stdout.off("data", handleOutput);
        child.stderr.off("data", handleOutput);
      };
      const settle = (next: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        next();
      };
      const tryResolve = () => {
        const baseUrl = readCurrent();
        if (baseUrl) {
          settle(() => resolve(baseUrl));
        }
      };
      const handleOutput = () => {
        tryResolve();
      };
      const handleError = (error: Error) => {
        settle(() => reject(new Error(`OpenCode serve 启动失败: ${error.message}`)));
      };
      const handleExit = () => {
        const baseUrl = readCurrent();
        if (baseUrl) {
          settle(() => resolve(baseUrl));
          return;
        }
        settle(() => reject(new Error("OpenCode serve 启动失败: 未输出可解析的监听地址")));
      };
      const timeout = setTimeout(() => {
        settle(() => reject(new Error("OpenCode serve 启动失败: 等待监听地址输出超时")));
      }, SERVE_BASE_URL_TIMEOUT_MS);

      child.on("error", handleError);
      child.on("exit", handleExit);
      child.stdout.on("data", handleOutput);
      child.stderr.on("data", handleOutput);
      tryResolve();
    });
  }

  private buildBaseUrl(port: number): string {
    return `http://${this.host}:${port}`;
  }

  private parsePortFromBaseUrl(baseUrl: string): number {
    const parsed = new URL(baseUrl);
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`无效的 OpenCode attach 地址：${baseUrl}`);
    }
    return port;
  }

  private truncateLogPayload(value: string, maxLength = 4000): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}...(truncated)`;
  }

  private normalizeProcessOutput(value: string | Buffer): string {
    return typeof value === "string" ? value : value.toString("utf8");
  }

  private extractVisibleMessageText(parts: Array<Record<string, unknown>>): string {
    const text = parts
      .map((part) => {
        if (part["type"] === "text" && typeof part["text"] === "string") {
          return part["text"];
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");

    return text;
  }

  private shortenText(value: string, limit: number): string {
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (trimmed.length <= limit) {
      return trimmed;
    }
    return `${trimmed.slice(0, limit - 1)}…`;
  }
}
