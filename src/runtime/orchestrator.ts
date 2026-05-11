import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { withOptionalString, withOptionalValue } from "@shared/object-utils";
import { resolveTaskSubmissionTarget } from "@shared/task-submission";
import { buildCliOpencodeAttachCommand } from "@shared/terminal-commands";
import {
  type AgentTeamEvent,
  type AgentProgressActivityKind,
  type AgentProgressMessageRecord,
  type AgentRoutingKind,
  type AgentRuntimeSnapshot,
  type AgentRecord,
  assertNoAmbiguousTopologyTriggerRoutes,
  buildTopologyNodeRecords,
  createDefaultTopology,
  DEFAULT_TOPOLOGY_TRIGGER,
  DEFAULT_ACTION_REQUIRED_MAX_ROUNDS,
  type InitialMessageRouting,
  isActionRequiredTopologyTrigger,
  LANGGRAPH_END_NODE_ID,
  normalizeActionRequiredMaxRounds,
  collectTopologyTriggerShapes,
  createTopologyLangGraphRecord,
  getTopologyEdgeId,
  getTopologyNodeRecords,
  normalizeSpawnRule,
  normalizeTopologyEdgeTrigger,
  resolveTriggerRoutingKindForSource,
  type DeleteTaskPayload,
  type GetTaskRuntimePayload,
  type InitializeTaskPayload,
  getWorkspaceNameFromPath,
  type MessageRecord,
  type OpenAgentTerminalPayload,
  resolvePrimaryTopologyStartTarget,
  resolveTopologyAgentOrder,
  type SpawnRule,
  type SubmitTaskPayload,
  type TaskAgentRecord,
  type TaskRecord,
  type TaskSnapshot,
  type TopologyNodeRecord,
  type TopologyRecord,
  type WorkspaceSnapshot, toUtcIsoTimestamp,
} from "@shared/types";
import {
  formatAgentDispatchContent,
  formatActionRequiredRequestContent,
  parseTargetAgentIds,
} from "@shared/chat-message-format";
import { stripDecisionResponseMarkup } from "@shared/decision-response";
import {
  parseDecision as parseDecisionPure,
  stripStructuredSignals as stripStructuredSignalsPure,
  type AllowedDecisionTrigger,
  type ParsedDecision,
} from "./decision-parser";
import {
  OpenCodeClient,
  type OpenCodeExecutionResult,
  type OpenCodeRuntimeActivity,
  type OpenCodeShutdownReport,
} from "./opencode-client";
import { OpenCodeRunner } from "./opencode-runner";
import { StoreService } from "./store";
import {
  buildRuntimeActivityFreshness,
  isRuntimeActivityFreshnessNewer,
  type RuntimeActivityFreshness,
} from "./runtime-activity-freshness";
import { resolveAgentStatusFromRouting } from "./gating-rules";
import {
  buildDownstreamForwardedContextFromMessages,
  NONE_MODE_PLACEHOLDER_MESSAGE,
  buildSourceAgentMessageSectionLabel,
  buildUserHistoryContent as buildUserHistoryContentPure,
  stripTargetMention as stripTargetMentionPure,
} from "./message-forwarding";
import {
  reconcileTaskSnapshotFromMessages as reconcileTaskSnapshotFromMessagesPure,
  resolveStandaloneTaskStatusAfterAgentRun,
  shouldFinishTaskFromPersistedState as shouldFinishTaskFromPersistedStatePure,
} from "./task-lifecycle-rules";
import { LangGraphRuntime } from "./langgraph-runtime";
import type { LangGraphTaskLoopHost } from "./langgraph-host";
import type { GraphDispatchBatch, GraphAgentResult } from "./gating-router";
import type { GraphTaskState } from "./gating-state";
import {
  buildTaskCompletionMessageContent,
  buildTaskRoundFinishedMessageContent,
} from "./task-completion-message";
import {
  buildEffectiveTopology,
  getRuntimeTemplateName,
} from "./runtime-topology-graph";
import type { CompiledTeamDsl } from "./team-dsl";
import { shouldScheduleEventStreamReconnect } from "./event-stream-lifecycle";
import { isExecutionDecisionAgent } from "./decision-agent-context";
import { resolveTaskAgentIdsToPrewarm } from "./task-session-prewarm";
import { appendAppLog } from "./app-log";
import {
  buildInjectedConfigFromAgents,
  extractDslAgentsFromTopology,
  resolveProjectAgents,
  validateProjectAgents,
} from "./project-agent-source";
import { launchTerminalCommand } from "./terminal-launcher";
import { runWithTaskLogScope } from "./app-log";

const RUNTIME_PROGRESS_SYNC_INTERVAL_MS = 200;

type SpawnRuleInputBase = Omit<SpawnRule, "report">;

type SpawnRuleInput =
  | (SpawnRuleInputBase & {
      report: SpawnRule["report"];
    })
  | (SpawnRuleInputBase & {
      reportToTemplateName: string;
    })
  | (SpawnRuleInputBase & {
      reportToTemplateName: string;
      reportToTrigger: string;
      reportToMessageMode: "none" | "last";
      reportToMaxTriggerRounds: number | false;
    })
  | SpawnRuleInputBase;

type TopologyInputRecord = Omit<TopologyRecord, "spawnRules"> & {
  spawnRules?: SpawnRuleInput[];
};

type UpdateTopologyInputPayload = {
  topology: TopologyInputRecord;
};

function coerceSpawnRuleInput(
  rule: SpawnRuleInput,
): SpawnRule {
  if ("report" in rule) {
    return rule;
  }
  if (!("reportToTemplateName" in rule)) {
    return {
      ...rule,
      report: false,
    };
  }
  if (!("reportToTrigger" in rule)) {
    throw new Error(
      `spawn rule ${rule.id} 存在 report target 时，必须显式声明 reportToTrigger。`,
    );
  }
  return {
    ...rule,
    report: {
      templateName: rule.reportToTemplateName,
      trigger: rule.reportToTrigger,
      messageMode: rule.reportToMessageMode,
      maxTriggerRounds: rule.reportToMaxTriggerRounds,
    },
  };
}

interface OrchestratorOptions {
  cwd: string;
  userDataPath: string;
  autoOpenTaskSession?: boolean;
  enableEventStream?: boolean;
  runtimeRefreshDebounceMs?: number;
  terminalLauncher?: (input: { cwd: string; command: string }) => Promise<void>;
}

interface DisposeOrchestratorOptions {
  awaitPendingTaskRuns?: boolean;
}

interface ParsedSignal {
  done: boolean;
}

interface EdgeForwardingConfig {
  messageMode: "none" | "last";
  initialMessageRouting: InitialMessageRouting;
}

type InitialMessageAliasScope =
  | {
      kind: "group";
      groupId: string;
    }
  | {
      kind: "static-only";
    };

interface WorkspaceRecord {
  cwd: string;
  id: string;
}

interface TaskRuntimeOverlay {
  taskId: string;
  cwd: string;
  attachBaseUrl: string;
  agentSessions: Map<string, string>;
  persistedActivityIdsByAgent: Map<string, Set<string>>;
  activityFreshnessByMessageId: Map<string, RuntimeActivityFreshness>;
}

type AgentExecutionPrompt =
  | {
      mode: "raw";
      content: string;
      from?: string;
    }
  | {
      mode: "control";
      content: string;
    }
  | {
      mode: "structured";
      from: string;
      agentMessage: string;
      omitSourceAgentSectionLabel: boolean;
    };

interface AgentRunBehaviorOptions {
  followTopology?: boolean;
  updateTaskStatusOnStart?: boolean;
  completeTaskOnFinish?: boolean;
}

const idleProcessWorkspace = { cwd: "", refCount: 0 };
let activeProcessWorkspace = idleProcessWorkspace;

function acquireProcessWorkspaceCwd(cwd: string) {
  if (activeProcessWorkspace.refCount === 0) {
    activeProcessWorkspace = {
      cwd,
      refCount: 1,
    };
    return;
  }
  if (activeProcessWorkspace.cwd !== cwd) {
    throw new Error(`当前进程只允许一个 cwd。已有 cwd: ${activeProcessWorkspace.cwd}，拒绝访问: ${cwd}`);
  }
  activeProcessWorkspace = {
    cwd,
    refCount: activeProcessWorkspace.refCount + 1,
  };
}

function releaseProcessWorkspaceCwd(cwd: string) {
  if (activeProcessWorkspace.refCount === 0 || activeProcessWorkspace.cwd !== cwd) {
    return;
  }
  if (activeProcessWorkspace.refCount <= 1) {
    activeProcessWorkspace = idleProcessWorkspace;
    return;
  }
  activeProcessWorkspace = {
    cwd,
    refCount: activeProcessWorkspace.refCount - 1,
  };
}

export function isTerminalTaskStatus(status: TaskRecord["status"]) {
  return status === "finished" || status === "failed";
}

export class Orchestrator {
  readonly store: StoreService;
  readonly opencodeClient: OpenCodeClient;
  readonly opencodeRunner: OpenCodeRunner;
  readonly cwd: string;
  private readonly events = new EventEmitter();
  private readonly langGraphRuntimes = new Map<string, LangGraphRuntime>();
  private readonly enableEventStream: boolean;
  private readonly taskRuntimeOverlays = new Map<string, TaskRuntimeOverlay>();
  private readonly runtimeEventCallbacks = new Map<string, (event: unknown) => void>();
  private readonly pendingRuntimeSyncTasks = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  readonly pendingEventReconnects = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  readonly pendingTaskRuns = new Set<Promise<void>>();
  private readonly runtimeRefreshDebounceMs: number;
  private readonly terminalLauncher: (input: {
    cwd: string;
    command: string;
  }) => Promise<void>;
  private isDisposing = false;

  constructor(options: OrchestratorOptions) {
    this.cwd = path.resolve(options.cwd);
    acquireProcessWorkspaceCwd(this.cwd);
    this.store = new StoreService();
    this.opencodeClient = new OpenCodeClient();
    this.opencodeRunner = new OpenCodeRunner(this.opencodeClient);
    this.enableEventStream = options.enableEventStream ?? true;
    this.runtimeRefreshDebounceMs = options.runtimeRefreshDebounceMs ?? 120;
    this.terminalLauncher = options.terminalLauncher ?? launchTerminalCommand;
  }

  async initialize() {
    this.ensureWorkspaceRecord();
  }

  async dispose(
    options: DisposeOrchestratorOptions = {},
  ): Promise<OpenCodeShutdownReport> {
    if (this.isDisposing) {
      return {
        killedPids: [],
      };
    }
    this.isDisposing = true;
    this.pendingRuntimeSyncTasks.forEach((timer) => clearTimeout(timer));
    this.pendingRuntimeSyncTasks.clear();
    this.pendingEventReconnects.forEach((timer) => clearTimeout(timer));
    this.pendingEventReconnects.clear();
    const awaitPendingTaskRuns = options.awaitPendingTaskRuns ?? true;
    if (awaitPendingTaskRuns && this.pendingTaskRuns.size > 0) {
      await Promise.allSettled([...this.pendingTaskRuns]);
    } else if (!awaitPendingTaskRuns) {
      this.pendingTaskRuns.clear();
    }
    this.langGraphRuntimes.clear();
    this.taskRuntimeOverlays.clear();
    this.runtimeEventCallbacks.clear();
    try {
      return await this.opencodeClient.shutdownAll();
    } finally {
      releaseProcessWorkspaceCwd(this.cwd);
    }
  }

  subscribe(listener: (event: AgentTeamEvent) => void): () => void {
    this.events.on("agent-team-event", listener);
    return () => {
      this.events.off("agent-team-event", listener);
    };
  }

  async getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
    await this.reconcilePersistedWorkspaceTasks();
    return this.hydrateWorkspace();
  }

  async getTaskSnapshot(taskId: string): Promise<TaskSnapshot> {
    await this.reconcilePersistedTaskStatus(taskId);
    return this.hydrateTask(taskId);
  }

  private ensureWorkspaceRecord(): WorkspaceRecord {
    this.store.getTopology();
    return {
      cwd: this.cwd,
      id: getWorkspaceNameFromPath(this.cwd),
    };
  }

  async readAgent(agentId: string): Promise<AgentRecord> {
    const matched = this.listWorkspaceAgents().find(
      (agent) => agent.id === agentId,
    );
    if (!matched) {
      throw new Error(`Agent 配置不存在：${agentId}`);
    }
    return matched;
  }

  private listWorkspaceAgents(): AgentRecord[] {
    return resolveProjectAgents({
      dslAgents: extractDslAgentsFromTopology(this.store.getTopology()),
    });
  }

  async saveTopology(
    payload: UpdateTopologyInputPayload,
  ): Promise<WorkspaceSnapshot> {
    const agents = this.listWorkspaceAgents();
    const normalized = this.normalizeTopology(agents, payload.topology);
    this.store.upsertTopology(normalized);
    return this.hydrateWorkspace();
  }

  async applyTeamDsl(payload: { compiled: CompiledTeamDsl }): Promise<WorkspaceSnapshot> {
    const normalized = this.normalizeTopology(
      payload.compiled.agents.map((agent) => ({
        id: agent.id,
        prompt: agent.prompt,
        isWritable: agent.isWritable,
      })),
      payload.compiled.topology,
    );
    this.store.upsertTopology(normalized);
    return this.hydrateWorkspace();
  }

  async deleteTask(payload: DeleteTaskPayload): Promise<WorkspaceSnapshot> {
    const normalizedCwd = this.cwd;
    const task = this.store.getTask(payload.taskId);
    await this.deleteTaskGraphRuntime(task);
    this.taskRuntimeOverlays.delete(task.id);
    const runtimeSyncTimer = this.pendingRuntimeSyncTasks.get(task.id);
    if (runtimeSyncTimer) {
      clearTimeout(runtimeSyncTimer);
      this.pendingRuntimeSyncTasks.delete(task.id);
    }
    const hasRemainingOverlayOnCwd = [...this.taskRuntimeOverlays.values()]
      .some((overlay) => path.resolve(overlay.cwd) === normalizedCwd);
    const runtimeEventCallback = this.runtimeEventCallbacks.get(normalizedCwd);
    if (!hasRemainingOverlayOnCwd && runtimeEventCallback) {
      this.opencodeClient.disconnectEvents(normalizedCwd, runtimeEventCallback);
      this.runtimeEventCallbacks.delete(normalizedCwd);
    }
    const reconnectTimer = this.pendingEventReconnects.get(normalizedCwd);
    if (!hasRemainingOverlayOnCwd && reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.pendingEventReconnects.delete(normalizedCwd);
    }
    this.store.deleteTask(task.id);
    return this.hydrateWorkspace();
  }

  async submitTask(payload: SubmitTaskPayload): Promise<TaskSnapshot> {
    const normalizedCwd = this.cwd;
    const agents = this.listWorkspaceAgents();
    validateProjectAgents();
    this.syncTopology(agents);
    const topology = this.store.getTopology();
    const resolution = resolveTaskSubmissionTarget({
      content: payload.content,
      availableAgents: agents.map((agent) => agent.id),
      ...withOptionalString({}, "mentionAgentId", payload.mentionAgentId),
      ...withOptionalString(
        {},
        "defaultTargetAgentId",
        resolvePrimaryTopologyStartTarget(topology) ?? undefined,
      ),
    });
    if (!resolution.ok) {
      throw new Error(resolution.message);
    }
    const mentionAgentId = resolution.targetAgentId;

    if (payload.taskId) {
      return this.continueTask(
        normalizedCwd,
        payload.taskId,
        payload.content,
        mentionAgentId,
        agents,
      );
    }

    const initialized = await this.createTask(normalizedCwd, agents, {
      taskId: payload.newTaskId ?? null,
      title: this.createTaskTitle(payload.content),
      source: "submit",
    });

    return this.continueTask(
      normalizedCwd,
      initialized.task.id,
      payload.content,
      mentionAgentId,
      agents,
    );
  }

  async initializeTask(payload: InitializeTaskPayload): Promise<TaskSnapshot> {
    const normalizedCwd = this.cwd;
    const agents = this.listWorkspaceAgents();
    validateProjectAgents();
    this.syncTopology(agents);

    return this.createTask(normalizedCwd, agents, {
      taskId: payload.taskId ?? null,
      title: (payload.title ?? "").trim() || "未命名任务",
      source: "initialize",
    });
  }

  async openAgentTerminal(payload: OpenAgentTerminalPayload) {
    const normalizedCwd = this.cwd;
    const task = this.store.getTask(payload.taskId);
    const snapshot = await this.ensureTaskInitialized(
      task,
      this.listWorkspaceAgents(),
    );
    this.emit({
      type: "task-updated",
      cwd: normalizedCwd,
      payload: snapshot,
    });

    const taskAgent = snapshot.agents.find(
      (item) => item.id === payload.agentId,
    );
    if (!taskAgent) {
      throw new Error(`未找到 Agent ${payload.agentId} 对应的运行信息。`);
    }
    if (!taskAgent.opencodeSessionId) {
      throw new Error(
        `Agent ${payload.agentId} 当前还没有可 attach 的 OpenCode session。`,
      );
    }
    await this.launchAgentTerminal(
      normalizedCwd,
      taskAgent.opencodeSessionId,
      taskAgent.opencodeAttachBaseUrl,
    );
  }

  async getTaskRuntime(
    payload: GetTaskRuntimePayload,
  ): Promise<AgentRuntimeSnapshot[]> {
    const task = this.store.getTask(payload.taskId);
    const overlayAgents = this.overlayTaskAgents(
      task,
      this.store.listTaskAgents(task.id),
    );
    return Promise.all(
      overlayAgents.map(async (agent) => {
        const baseSnapshot: AgentRuntimeSnapshot = {
          taskId: task.id,
          agentId: agent.id,
          sessionId: agent.opencodeSessionId,
          status: agent.status,
          runtimeStatus: agent.status,
          messageCount: 0,
          updatedAt: "",
          headline: "",
          activeToolNames: [],
          activities: [],
        };

        if (!agent.opencodeSessionId) {
          return baseSnapshot;
        }

        try {
          const runtime = await runWithTaskLogScope(task.id, () =>
            this.opencodeClient.getSessionRuntime(
              task.cwd,
              agent.opencodeSessionId,
            ));
          return {
            ...baseSnapshot,
            messageCount: runtime.messageCount,
            updatedAt: runtime.updatedAt,
            headline: runtime.headline,
            activeToolNames: runtime.activeToolNames,
            activities: runtime.activities,
          };
        } catch {
          return {
            ...baseSnapshot,
            headline:
              agent.status === "running"
                ? "运行中，正在等待 OpenCode 返回实时消息"
                : "",
          };
        }
      }),
    );
  }

  private async createTask(
    cwd: string,
    agents: AgentRecord[],
    options: {
      taskId?: string | null;
      title: string;
      source: "initialize" | "submit";
    },
  ): Promise<TaskSnapshot> {
    if (agents.length === 0) {
      throw new Error("当前工作区没有可用的 Agent");
    }

    const taskId = options.taskId?.trim() || randomUUID();
    const normalizedCwd = path.resolve(cwd);
    const createdAt = new Date().toISOString();

    const task: TaskRecord = {
      id: taskId,
      title: options.title,
      status: "pending",
      cwd: normalizedCwd,
      agentCount: agents.length,
      createdAt,
      completedAt: "",
      initializedAt: "",
    };

    this.store.insertTask(task);
    for (const agent of agents) {
      this.store.insertTaskAgent({
        taskId,
        id: agent.id,
        opencodeSessionId: "",
        opencodeAttachBaseUrl: "",
        status: "idle",
        runCount: 0,
      });
    }

    await this.ensureTaskInitialized(task, agents);

    const taskCreatedMessage: MessageRecord = {
      id: randomUUID(),
      taskId,
      content:
        options.source === "initialize"
          ? "Task 已初始化"
          : "Task 已创建并完成初始化",
      sender: "system",
      timestamp: toUtcIsoTimestamp(new Date().toISOString()),
      kind: "task-created",
    };
    this.store.insertMessage(taskCreatedMessage);

    const snapshot = this.hydrateTask(taskId);
    this.emit({
      type: "task-created",
      cwd: normalizedCwd,
      payload: snapshot,
    });

    return snapshot;
  }

  private async continueTask(
    cwd: string,
    taskId: string,
    content: string,
    mentionAgentId: string,
    agents: AgentRecord[],
  ): Promise<TaskSnapshot> {
    const normalizedCwd = path.resolve(cwd);
    const task = this.store.getTask(taskId);
    if (isTerminalTaskStatus(task.status)) {
      this.store.updateTaskStatus(task.id, "running");
    }

    this.syncTaskAgents(task, agents);
    const targetAgentRecord = this.findAgent(agents, mentionAgentId);

    if (!targetAgentRecord) {
      throw new Error(`未找到被 @ 的 Agent：${mentionAgentId}`);
    }

    await this.ensureTaskInitialized(task, agents);

    const targetRunCount =
      (this.store
        .listTaskAgents(task.id)
        .find((item) => item.id === targetAgentRecord.id)?.runCount ?? 0) + 1;
    const message = this.createUserMessage(
      task.id,
      task.title,
      content,
      targetAgentRecord.id,
      targetRunCount,
    );
    this.store.insertMessage(message);
    this.emit({
      type: "message-created",
      cwd: normalizedCwd,
      payload: message,
    });

    const forwardedContent = stripTargetMentionPure(
      content,
      targetAgentRecord.id,
    );
    const topology = this.store.getTopology();
    const runtime = this.getLangGraphRuntime(normalizedCwd);
    this.trackBackgroundTask(
      runtime
        .resumeTask({
          taskId: task.id,
          topology,
          event: {
            type: "user_message",
            targetAgentId: targetAgentRecord.id,
            content: forwardedContent,
          },
        })
        .then(() => undefined),
      {
        taskId: task.id,
        agentId: targetAgentRecord.id,
      },
    );
    return this.hydrateTask(task.id);
  }

  protected trackBackgroundTask(
    promise: Promise<void>,
    context: {
      taskId: string;
      agentId: string;
    },
  ) {
    const tracked = promise
      .catch((error) => {
        console.error("[orchestrator] 后台发送任务失败", {
          taskId: context.taskId,
          agentId: context.agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.pendingTaskRuns.delete(tracked);
      });
    this.pendingTaskRuns.add(tracked);
  }

  private createUserMessage(
    taskId: string,
    taskTitle: string,
    content: string,
    targetAgentId: string,
    targetRunCount: number,
  ): MessageRecord {
    const normalizedContent = buildUserHistoryContentPure(
      content,
      targetAgentId,
    );
    return {
      id: randomUUID(),
      taskId,
      content: normalizedContent,
      sender: "user",
      timestamp: toUtcIsoTimestamp(new Date().toISOString()),
      kind: "user",
      scope: "task",
      taskTitle,
      targetAgentIds: [targetAgentId],
      targetRunCounts: [targetRunCount],
    };
  }

  private syncTaskAgents(task: TaskRecord, agents: AgentRecord[]) {
    const orderedAgents = this.orderAgents(agents);
    const existingByName = new Set(
      this.store.listTaskAgents(task.id).map((item) => item.id),
    );
    for (const agent of orderedAgents) {
      if (existingByName.has(agent.id)) {
        continue;
      }
      this.store.insertTaskAgent({
        taskId: task.id,
        id: agent.id,
        opencodeSessionId: "",
        opencodeAttachBaseUrl: "",
        status: "idle",
        runCount: 0,
      });
    }

    this.store.updateTaskAgentCount(task.id, agents.length);
  }

  private ensureRuntimeTaskAgent(
    task: TaskRecord,
    runtimeAgentId: string,
  ): void {
    const existing = this.store
      .listTaskAgents(task.id)
      .find((item) => item.id === runtimeAgentId);
    if (existing) {
      return;
    }
    this.store.insertTaskAgent({
      taskId: task.id,
      id: runtimeAgentId,
      opencodeSessionId: "",
      opencodeAttachBaseUrl: "",
      status: "idle",
      runCount: 0,
    });
    this.store.updateTaskAgentCount(
      task.id,
      this.store.listTaskAgents(task.id).length,
    );
  }

  protected async runAgent(
    cwd: string,
    task: TaskRecord,
    agentId: string,
    prompt: AgentExecutionPrompt,
    behavior: AgentRunBehaviorOptions = {},
  ) {
    if (behavior.followTopology) {
      throw new Error(
        "runAgent 已不再负责拓扑调度；请通过 submitTask/continueTask 走 LangGraph runtime。",
      );
    }

    const result = await this.executeLangGraphAgentOnce(
      cwd,
      task,
      null,
      agentId,
      agentId,
      prompt,
      1,
      "",
    );
    if (!(behavior.completeTaskOnFinish ?? true)) {
      return;
    }

    const latestTask = this.store.getTask(task.id);
    if (isTerminalTaskStatus(latestTask.status)) {
      if (latestTask.status === "failed" && latestTask.completedAt.length === 0) {
        await this.completeTask(task.cwd, task.id, "failed");
      }
      return;
    }

    if (latestTask.status === "action_required") {
      return;
    }

    const nextTaskStatus = resolveStandaloneTaskStatusAfterAgentRun({
      latestAgentStatus: result.agentStatus,
      agentStatuses: this.store.listTaskAgents(task.id),
    });

    if (nextTaskStatus === "finished") {
      await this.completeTask(
        task.cwd,
        task.id,
        "finished",
        "standalone_round_finished",
      );
      return;
    }

    if (nextTaskStatus === "failed") {
      await this.completeTask(task.cwd, task.id, "failed");
      return;
    }
  }

  private shouldSuppressDuplicateDispatchMessage(
    taskId: string,
    sourceAgentId: string,
    targetAgentIds: string[],
  ): boolean {
    const now = Date.now();
    const incomingTargets = [...targetAgentIds].sort().join(",");
    const messages = this.store.listMessages(taskId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) {
        continue;
      }
      const timestamp = Date.parse(message.timestamp);
      if (!Number.isFinite(timestamp)) {
        continue;
      }
      if (now - timestamp > 1500) {
        break;
      }
      if (message.sender === sourceAgentId && message.kind === "agent-final") {
        return false;
      }
      if (
        message.sender !== sourceAgentId ||
        message.kind !== "agent-dispatch"
      ) {
        continue;
      }

      const historicalTargets = parseTargetAgentIds(message.targetAgentIds)
        .sort()
        .join(",");
      if (historicalTargets === incomingTargets) {
        return true;
      }
    }
    return false;
  }

  private updateTaskStatusIfActive(
    taskId: string,
    status: TaskRecord["status"],
    completedAt = "",
  ): boolean {
    const task = this.store.getTask(taskId);
    if (isTerminalTaskStatus(task.status)) {
      return false;
    }
    this.store.updateTaskStatus(taskId, status, completedAt);
    return true;
  }

  private async reconcilePersistedTaskStatus(taskId: string) {
    const task = this.store.getTask(taskId);
    if (
      !shouldFinishTaskFromPersistedStatePure({
        taskStatus: task.status,
        topology: this.store.getTopology(),
        agents: this.store.listTaskAgents(taskId),
        messages: this.store.listMessages(taskId),
      })
    ) {
      return;
    }

    await this.completeTask(
      task.cwd,
      taskId,
      "finished",
      "persisted_round_finished",
    );
  }

  private async reconcilePersistedWorkspaceTasks() {
    for (const task of this.store.listTasks()) {
      await this.reconcilePersistedTaskStatus(task.id);
    }
  }

  private parseSignal(content: string): ParsedSignal {
    return {
      done: /\bTASK_DONE\b/i.test(content),
    };
  }

  protected buildAgentExecutionPrompt(prompt: AgentExecutionPrompt): string {
    if (prompt.mode === "raw") {
      const content = prompt.content.trim();
      const from = this.getAgentDisplayName(prompt.from?.trim() || "System");
      return `[${from}] ${content || "（无）"}`.trim();
    }

    if (prompt.mode === "control") {
      return prompt.content.trim() || "（无）";
    }

    const content = prompt.agentMessage.trim();
    if (!content) {
      throw new Error(`${prompt.from} 的 structured prompt 缺少正文`);
    }
    return prompt.omitSourceAgentSectionLabel
      ? content
      : `${buildSourceAgentMessageSectionLabel(prompt.from)}\n${content}`;
  }

  private resolveAgentContextContent(
    parsedDecision: ParsedDecision,
    rawFinalMessage: string,
    allowedTriggers?: readonly string[],
  ): string {
    const candidates = [
      parsedDecision.cleanContent.trim(),
      parsedDecision.opinion.trim(),
      stripStructuredSignalsPure(
        stripDecisionResponseMarkup(rawFinalMessage, allowedTriggers),
      ).trim(),
    ];

    return candidates.find((item) => item.length > 0) ?? "";
  }

  private resolveAllowedDecisionTriggers(input: {
    state: GraphTaskState | null;
    topology: Pick<TopologyRecord, "edges"> &
      Partial<Pick<TopologyRecord, "langgraph">>;
    runtimeAgentId: string;
    executableAgentId: string;
  }): AllowedDecisionTrigger[] {
    const effectiveTopology = input.state
      ? buildEffectiveTopology(input.state)
      : input.topology;
    const sourceAgentIds = [
      ...new Set([input.runtimeAgentId, input.executableAgentId]),
    ];
    const allowed: AllowedDecisionTrigger[] = [];
    const push = (trigger: AllowedDecisionTrigger) => {
      if (allowed.some((item) => item.trigger === trigger.trigger)) {
        return;
      }
      allowed.push(trigger);
    };

    for (const trigger of collectTopologyTriggerShapes({
      edges: effectiveTopology.edges,
      endIncoming: effectiveTopology.langgraph?.end?.incoming ?? [],
    })) {
      if (!sourceAgentIds.includes(trigger.source)) {
        continue;
      }
      push({
        trigger: trigger.trigger,
      });
    }

    return allowed;
  }

  private buildDispatchMessageContent(
    targetAgentIds: string[],
    content: string,
  ): string {
    return formatAgentDispatchContent(content, targetAgentIds);
  }

  private extractAgentDisplayContent(
    content: string,
    options?: { preferTrailingDeliverySection?: boolean },
  ): string {
    const trimmed = content.trim();
    if (!trimmed) {
      return "";
    }

    const trailingSection = options?.preferTrailingDeliverySection
      ? this.extractTrailingTopLevelSection(trimmed)
      : trimmed;
    return trailingSection.replace(/\n(?:---|\*\*\*)(?:\s*\n?)*$/u, "").trim();
  }

  private extractTrailingTopLevelSection(content: string): string {
    const headingPattern = /(^|\n)(#{1,2}\s+[^\n]+)\n/g;
    let lastHeadingIndex = -1;
    let match: RegExpExecArray | null = headingPattern.exec(content);
    while (match) {
      const prefix = match[1] ?? "";
      lastHeadingIndex = match.index + prefix.length;
      match = headingPattern.exec(content);
    }

    if (lastHeadingIndex < 0) {
      return content;
    }

    const trailingSection = content.slice(lastHeadingIndex).trim();
    return trailingSection || content;
  }

  protected createDisplayContent(parsedDecision: ParsedDecision): string {
    const preferTrailingDeliverySection = parsedDecision.kind === "invalid";
    const cleanContent = this.extractAgentDisplayContent(
      parsedDecision.cleanContent,
      {
        preferTrailingDeliverySection,
      },
    );
    if (parsedDecision.kind === "invalid") {
      return [cleanContent, parsedDecision.validationError]
        .filter(Boolean)
        .join("\n\n");
    }
    if (cleanContent) {
      return cleanContent;
    }

    const opinion = parsedDecision.opinion.trim();
    if (opinion) {
      return opinion;
    }

    return "";
  }

  private resolveParsedDecisionValue(input: {
    parsedDecision: ParsedDecision;
    decisionAgent: boolean;
    topology: Pick<TopologyRecord, "edges"> &
      Partial<Pick<TopologyRecord, "langgraph">>;
    sourceAgentIds: string[];
  }): AgentRoutingKind {
    if (input.parsedDecision.kind === "invalid") {
      return "invalid";
    }
    if (!input.decisionAgent) {
      return "default";
    }

    for (const sourceAgentId of input.sourceAgentIds) {
      const resolved = resolveTriggerRoutingKindForSource(
        input.topology,
        sourceAgentId,
        input.parsedDecision.trigger,
      );
      if (resolved) {
        return "labeled";
      }
    }

    return "invalid";
  }

  private ensureTaskRuntimeOverlay(
    task: Pick<TaskRecord, "id" | "cwd">,
  ): TaskRuntimeOverlay {
    const existing = this.taskRuntimeOverlays.get(task.id);
    if (existing) {
      existing.cwd = task.cwd;
      return existing;
    }

    const created: TaskRuntimeOverlay = {
      taskId: task.id,
      cwd: task.cwd,
      attachBaseUrl: "",
      agentSessions: new Map(),
      persistedActivityIdsByAgent: new Map(),
      activityFreshnessByMessageId: new Map(),
    };
    this.taskRuntimeOverlays.set(task.id, created);
    return created;
  }

  private listTaskAgentSessionEntries(
    task: Pick<TaskRecord, "id" | "cwd">,
    agentSessions: ReadonlyMap<string, string>,
  ) {
    return this.store.listTaskAgents(task.id).map((agent) => {
      const sessionId = agentSessions.get(agent.id);
      return {
        agentId: agent.id,
        sessionId: sessionId === undefined ? "" : sessionId,
      };
    });
  }

  private appendTaskAgentSessionsLog(
    task: Pick<TaskRecord, "id" | "cwd">,
    reason: "initialized" | "session-created",
    agentSessions: ReadonlyMap<string, string>,
  ) {
    runWithTaskLogScope(task.id, () => {
      appendAppLog(
        "info",
        "task.opencode_sessions_snapshot",
        {
          cwd: task.cwd,
          reason,
          agentSessions: this.listTaskAgentSessionEntries(task, agentSessions),
        },
      );
    });
  }

  private overlayTaskAgents(
    task: TaskRecord,
    agents: TaskAgentRecord[],
  ): TaskAgentRecord[] {
    const overlay = this.taskRuntimeOverlays.get(task.id);
    return agents.map((agent) => ({
      ...agent,
      opencodeSessionId: overlay?.agentSessions.get(agent.id) ?? "",
      opencodeAttachBaseUrl: overlay ? overlay.attachBaseUrl : "",
    }));
  }

  protected async ensureAgentSession(
    task: TaskRecord,
    agent: TaskAgentRecord,
  ): Promise<string> {
    const overlay = this.ensureTaskRuntimeOverlay(task);
    const existingSessionId = overlay.agentSessions.get(agent.id) ?? "";
    if (existingSessionId) {
      return existingSessionId;
    }
    const injectedConfig = buildInjectedConfigFromAgents(this.listWorkspaceAgents());
    const sessionId = await runWithTaskLogScope(task.id, async () => {
      const server = await this.opencodeClient.ensureServerStarted(task.cwd, injectedConfig);
      overlay.attachBaseUrl = `http://${this.opencodeClient.host}:${server.port}`;
      return this.opencodeClient.createSession(
        task.cwd,
        `${task.title}:${agent.id}`,
      );
    });
    overlay.agentSessions.set(agent.id, sessionId);
    this.appendTaskAgentSessionsLog(task, "session-created", overlay.agentSessions);
    return sessionId;
  }

  protected async ensureTaskPanels(task: TaskRecord) {
    await this.ensureTaskInitialized(task, this.listWorkspaceAgents());
  }

  private async ensureTaskAgentSessions(
    task: TaskRecord,
  ): Promise<void> {
    const topology = this.store.getTopology();
    const prewarmAgentIds = new Set(
      resolveTaskAgentIdsToPrewarm(
        topology,
        this.store.listTaskAgents(task.id),
      ),
    );
    await Promise.all(
      this.store
        .listTaskAgents(task.id)
        .filter((agent) => prewarmAgentIds.has(agent.id))
        .map(
          async (agent) => this.ensureAgentSession(task, agent),
        ),
    );
  }

  private async ensureTaskInitialized(
    task: TaskRecord,
    agents: AgentRecord[],
  ): Promise<TaskSnapshot> {
    this.syncTaskAgents(task, agents);
    const currentTask = this.store.getTask(task.id);
    await this.ensureTaskAgentSessions(currentTask);
    if (this.hasTaskRuntimeSessions(currentTask.id)) {
      await this.ensureTaskRuntimeEventStream(currentTask);
    }

    const refreshedTask = this.store.getTask(task.id);
    if (!refreshedTask.initializedAt) {
      const overlay = this.ensureTaskRuntimeOverlay(currentTask);
      this.appendTaskAgentSessionsLog(currentTask, "initialized", overlay.agentSessions);
      this.store.updateTaskInitialized(
        task.id,
        new Date().toISOString(),
      );
    }

    return this.hydrateTask(task.id);
  }

  private getOrderedAgentIds(
    agents: Array<Pick<AgentRecord, "id">>,
    topologyOverride?: TopologyRecord,
  ): string[] {
    const topology = topologyOverride ?? this.store.getTopology();
    return resolveTopologyAgentOrder(agents, topology.nodes);
  }

  private orderAgents(
    agents: AgentRecord[],
    topologyOverride?: TopologyRecord,
  ): AgentRecord[] {
    const orderedNames = this.getOrderedAgentIds(agents, topologyOverride);
    const agentByName = new Map(agents.map((agent) => [agent.id, agent]));
    return orderedNames
      .map((name) => agentByName.get(name))
      .filter((agent): agent is AgentRecord => Boolean(agent));
  }

  private async launchAgentTerminal(
    cwd: string,
    opencodeSessionId: string,
    sessionAttachBaseUrl: string,
  ) {
    if (!sessionAttachBaseUrl) {
      throw new Error("当前 Agent 还没有可 attach 的 OpenCode 地址。");
    }
    const attachCommand = buildCliOpencodeAttachCommand(
      sessionAttachBaseUrl,
      opencodeSessionId,
    );
    await this.terminalLauncher({
      cwd,
      command: attachCommand,
    });
  }

  private createTaskTitle(content: string): string {
    const firstLine = content
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean);
    return (firstLine ?? "未命名任务").slice(0, 80);
  }

  private hasTaskRuntimeSessions(taskId: string): boolean {
    const overlay = this.taskRuntimeOverlays.get(taskId);
    return overlay !== undefined && [...overlay.agentSessions.values()].some((sessionId) => sessionId.trim().length > 0);
  }

  private findAgent(
    agents: AgentRecord[],
    id: string | undefined,
  ): AgentRecord | undefined {
    if (!id) {
      return undefined;
    }
    return agents.find((agent) => agent.id === id);
  }

  private resolveExecutableAgentId(
    state: GraphTaskState | null,
    runtimeAgentId: string,
  ): string {
    const availableAgents = this.listWorkspaceAgents();
    if (availableAgents.some((agent) => agent.id === runtimeAgentId)) {
      return runtimeAgentId;
    }

    const templateName = state
      ? getRuntimeTemplateName(state, runtimeAgentId)
      : null;
    if (
      templateName &&
      availableAgents.some((agent) => agent.id === templateName)
    ) {
      return templateName;
    }

    return runtimeAgentId;
  }

  private resolveMessageSenderDisplayName(
    state: GraphTaskState | null,
    runtimeAgentId: string,
  ): string {
    if (!state) {
      return runtimeAgentId;
    }
    return (
      state.runtimeNodes.find((node) => node.id === runtimeAgentId)
        ?.displayName ?? runtimeAgentId
    );
  }

  private hydrateWorkspace(forceSyncTopology = false): WorkspaceSnapshot {
    const workspace = this.ensureWorkspaceRecord();
    const agents = this.listWorkspaceAgents();
    const topology = forceSyncTopology
      ? this.syncTopology(agents)
      : this.ensureTopologyExists(agents);
    const tasks = this.store.listTasks();
    for (const task of tasks) {
      this.syncTaskAgents(task, agents);
    }

    return {
      cwd: workspace.cwd,
      name: workspace.id,
      agents,
      topology,
      messages: this.store.listMessages(),
      tasks: tasks.map((task) => this.hydrateTask(task.id)),
    };
  }

  private hydrateTask(taskId: string): TaskSnapshot {
    const task = this.store.getTask(taskId);
    const agents = this.listWorkspaceAgents();
    this.syncTaskAgents(task, agents);
    const persistedAgents = this.store.listTaskAgents(taskId);
    const messages = this.store.listMessages(taskId);
    const reconciled = reconcileTaskSnapshotFromMessagesPure({
      task: this.store.getTask(taskId),
      agents: this.overlayTaskAgents(task, persistedAgents),
      messages,
    });
    return {
      task: reconciled.task,
      agents: reconciled.agents,
      messages,
      topology: this.store.getTopology(),
    };
  }

  private ensureTopologyExists(
    agents: AgentRecord[],
  ): TopologyRecord {
    const current = this.store.getTopology();
    if (current.nodes.length === 0 && current.edges.length === 0) {
      return createDefaultTopology(agents);
    }
    return this.normalizeTopology(agents, current);
  }

  private syncTopology(agents: AgentRecord[]): TopologyRecord {
    const current = this.store.getTopology();
    const next =
      current.nodes.length === 0 && current.edges.length === 0
        ? createDefaultTopology(agents)
        : this.normalizeTopology(agents, current);

    this.store.upsertTopology(next);
    return next;
  }

  private normalizeTopology(
    agents: AgentRecord[],
    topology: TopologyInputRecord,
  ): TopologyRecord {
    const validNames = new Set(agents.map((item) => item.id));
    const agentByName = new Map(agents.map((agent) => [agent.id, agent]));
    if (!topology.nodeRecords || topology.nodeRecords.length === 0) {
      throw new Error("拓扑缺少 nodeRecords，无法继续运行。");
    }
    const rawNodeRecords: TopologyNodeRecord[] = topology.nodeRecords;
    const spawnNodeIds = new Set(
      rawNodeRecords
        .filter((node) => node.kind === "spawn" && node.id)
        .map((node) => node.id),
    );
    const validTopologyNames = new Set([...validNames, ...spawnNodeIds]);
    const seenEdges = new Set<string>();
    const normalizedEdges = topology.edges
      .map((edge) => {
        const trigger = normalizeTopologyEdgeTrigger(edge.trigger);
        return {
          ...edge,
          trigger,
        };
      })
      .filter(
        (edge) =>
          validTopologyNames.has(edge.source) &&
          (validTopologyNames.has(edge.target) ||
            edge.target === LANGGRAPH_END_NODE_ID),
      )
      .filter((edge) => {
        const key = getTopologyEdgeId(edge);
        if (seenEdges.has(key)) {
          return false;
        }
        seenEdges.add(key);
        return true;
      });
    const endIncomingFromEdges = normalizedEdges
      .filter((edge) => edge.target === LANGGRAPH_END_NODE_ID)
      .map((edge) => ({
        source: edge.source,
        trigger: edge.trigger,
      }));
    const edges = normalizedEdges
      .filter((edge) => edge.target !== LANGGRAPH_END_NODE_ID)
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        trigger: edge.trigger,
        messageMode: edge.messageMode,
        ...(isActionRequiredTopologyTrigger(edge.trigger, edge.maxTriggerRounds)
          ? {
              maxTriggerRounds:
                edge.maxTriggerRounds === undefined
                  ? DEFAULT_ACTION_REQUIRED_MAX_ROUNDS
                  : normalizeActionRequiredMaxRounds(edge.maxTriggerRounds),
            }
          : {}),
      }));
    const orderedAgentNodes = resolveTopologyAgentOrder(
      agents.map((agent) => ({ id: agent.id })),
      topology.nodes.filter((item) => validNames.has(item)),
    );
    const nodes = [
      ...orderedAgentNodes,
      ...topology.nodes.filter((item) => spawnNodeIds.has(item)),
      ...spawnNodeIds,
    ].filter((value, index, list) => list.indexOf(value) === index);
    const normalizedNodeRecords = rawNodeRecords
      .filter(
        (node) =>
          node.id &&
          node.templateName &&
          (node.kind === "spawn" || validNames.has(node.templateName)),
      )
      .map((node) => {
        const prompt =
          node.kind === "agent"
            ? agentByName.get(node.templateName)?.prompt
            : typeof node.prompt === "string"
              ? node.prompt
              : undefined;
        const writable =
          node.kind === "agent"
            ? agentByName.get(node.templateName)?.isWritable === true
            : node.writable === true;

        return {
          id: node.id,
          kind: node.kind,
          templateName: node.templateName,
          initialMessageRouting: node.initialMessageRouting,
          ...(node.spawnRuleId ? { spawnRuleId: node.spawnRuleId } : {}),
          ...(node.spawnEnabled === true ? { spawnEnabled: true } : {}),
          ...(typeof prompt === "string" ? { prompt } : {}),
          ...(writable ? { writable: true } : {}),
        };
      });
    const normalizedSpawnRules = topology.spawnRules?.map((rule) => {
      const spawnNodeName =
        rule.spawnNodeName ||
        normalizedNodeRecords.find((node) => node.spawnRuleId === rule.id)?.id ||
        rule.id;
      return normalizeSpawnRule(
        coerceSpawnRuleInput(rule),
        spawnNodeName,
      );
    });
    const spawnRules: SpawnRule[] | undefined = normalizedSpawnRules?.filter((rule) =>
      rule.id
      && rule.spawnNodeName
      && rule.entryRole
      && validTopologyNames.has(rule.spawnNodeName)
      && (!rule.sourceTemplateName || validNames.has(rule.sourceTemplateName))
      && (rule.report === false || validNames.has(rule.report.templateName))
      && rule.spawnedAgents.every(
        (agent) => agent.role && validNames.has(agent.templateName),
      ),
    );
    const explicitEndIncoming = (
      topology.langgraph?.end?.incoming ?? []
    ).filter(
      (edge) =>
        validTopologyNames.has(edge.source) && typeof edge.trigger === "string",
    );
    const explicitStartTarget = resolvePrimaryTopologyStartTarget(topology);
    const endIncoming = [...explicitEndIncoming, ...endIncomingFromEdges];
    const langgraph = createTopologyLangGraphRecord({
      nodes,
      edges,
      startTargets:
        topology.langgraph?.start.targets ??
        (explicitStartTarget ? [explicitStartTarget] : []),
      endIncoming,
    });
    assertNoAmbiguousTopologyTriggerRoutes({
      edges,
      endIncoming: langgraph.end?.incoming ?? [],
    });
    const nodeRecords = buildTopologyNodeRecords({
      nodes,
      spawnNodeIds: new Set(
        normalizedNodeRecords
          .filter((node) => node.kind === "spawn")
          .map((node) => node.id),
      ),
      templateNameByNodeId: new Map(
        normalizedNodeRecords.map((node) => [node.id, node.templateName]),
      ),
      initialMessageRoutingByNodeId: new Map(
        normalizedNodeRecords.map((node) => [node.id, node.initialMessageRouting]),
      ),
      spawnRuleIdByNodeId: new Map(
        normalizedNodeRecords
          .filter((node) => typeof node.spawnRuleId === "string")
          .map((node) => [node.id, node.spawnRuleId as string]),
      ),
      spawnEnabledNodeIds: new Set(
        normalizedNodeRecords
          .filter((node) => node.spawnEnabled === true)
          .map((node) => node.id),
      ),
      promptByNodeId: new Map(
        normalizedNodeRecords
          .filter((node) => typeof node.prompt === "string")
          .map((node) => [node.id, node.prompt as string]),
      ),
      writableNodeIds: new Set(
        normalizedNodeRecords
          .filter((node) => node.writable === true)
          .map((node) => node.id),
      ),
    });

    return {
      nodes,
      edges,
      langgraph,
      nodeRecords,
      ...(spawnRules ? { spawnRules } : {}),
    } satisfies TopologyRecord;
  }

  private getLangGraphRuntime(cwd: string): LangGraphRuntime {
    let runtime = this.langGraphRuntimes.get(cwd);
    if (runtime) {
      return runtime;
    }

    const host: LangGraphTaskLoopHost = {
      createBatchRunners: async ({ taskId, state, batch }) =>
        this.createLangGraphBatchRunners(cwd, taskId, state, batch),
      completeTask: async ({ taskId, status, finishReason, failureReason }) =>
        this.completeTask(cwd, taskId, status, finishReason, failureReason),
    };
    runtime = new LangGraphRuntime({
      host,
    });
    this.langGraphRuntimes.set(cwd, runtime);
    return runtime;
  }

  private async deleteTaskGraphRuntime(task: Pick<TaskRecord, "id" | "cwd">) {
    await this.getLangGraphRuntime(task.cwd).deleteTask(task.id);
  }

  private resolveDispatchInitialMessageRouting(
    targetAgentRunCount: number,
    routing: InitialMessageRouting,
  ): InitialMessageRouting {
    if (routing.mode !== "list") {
      return routing;
    }
    if (targetAgentRunCount > 0) {
      return { mode: "none" };
    }
    return routing;
  }

  private resolveInitialMessageSourceAliases(
    state: GraphTaskState,
    sourceAgentId: string,
    targetAgentId: string,
    routing: InitialMessageRouting,
  ): Record<string, string[]> {
    if (routing.mode !== "list") {
      return {};
    }
    const targetRuntimeNode = state.runtimeNodes.find((node) => node.id === targetAgentId);
    const sourceRuntimeNode = state.runtimeNodes.find((node) => node.id === sourceAgentId);
    const scope: InitialMessageAliasScope =
      targetRuntimeNode?.groupId
        ? { kind: "group", groupId: targetRuntimeNode.groupId }
        : sourceRuntimeNode?.groupId
          ? { kind: "group", groupId: sourceRuntimeNode.groupId }
          : { kind: "static-only" };
    return Object.fromEntries(
      routing.agentIds.map((agentId) => [
        agentId,
        this.resolveInitialMessageAliasesForAgent(
          state,
          scope,
          agentId,
        ),
      ]),
    );
  }

  private resolveInitialMessageAliasesForAgent(
    state: GraphTaskState,
    scope: InitialMessageAliasScope,
    agentId: string,
  ): string[] {
    const runtimeNodes = scope.kind === "group"
      ? state.runtimeNodes.filter((node) => node.groupId === scope.groupId)
      : [];
    const aliases = new Set<string>([agentId.trim()]);
    for (const node of runtimeNodes) {
      if (
        node.id !== agentId &&
        node.templateName !== agentId &&
        node.displayName !== agentId
      ) {
        continue;
      }
      aliases.add(node.id.trim());
      aliases.add(node.templateName.trim());
      aliases.add(node.displayName.trim());
    }
    return [...aliases].filter(Boolean);
  }

  private resolveInitialMessageForwardedAgentMessages(
    state: GraphTaskState,
    routing: InitialMessageRouting,
    initialMessageSourceAliasesByAgentId: Record<string, string[]>,
  ): Record<string, string> {
    if (routing.mode !== "list") {
      return {};
    }
    return Object.fromEntries(
      routing.agentIds.map((agentId) => {
        const aliases = initialMessageSourceAliasesByAgentId[agentId] ?? [];
        const matchedAgentId = [agentId, ...aliases].find((candidate) =>
          Boolean(state.forwardedAgentMessageByName[candidate]),
        ) ?? "";
        return [agentId, matchedAgentId ? state.forwardedAgentMessageByName[matchedAgentId] ?? "" : ""];
      }),
    );
  }

  private resolveGlobalSourceOrder(state: GraphTaskState): string[] {
    return buildEffectiveTopology(state).nodes;
  }

  protected async createLangGraphBatchRunners(
    cwd: string,
    taskId: string,
    state: GraphTaskState,
    batch: GraphDispatchBatch,
  ) {
    const task = this.store.getTask(taskId);
    const batchSize = batch.jobs.length;
    const taskMessages = this.store.listMessages(taskId);

    if (
      batch.jobs.every(
        (job) => job.kind === "transfer" || job.kind === "dispatch",
      )
    ) {
      const sourceAgentId = batch.sourceAgentId ?? "System";
      if (
        !this.shouldSuppressDuplicateDispatchMessage(
          taskId,
          sourceAgentId,
          batch.triggerTargets,
        )
      ) {
        const targetRunCounts = batch.jobs.map(
          (job) =>
            (this.store
              .listTaskAgents(taskId)
              .find((item) => item.id === job.agentId)?.runCount ?? 0) + 1,
        );
        const triggerMessage: MessageRecord = {
          id: randomUUID(),
          taskId,
          sender: sourceAgentId,
          timestamp: toUtcIsoTimestamp(new Date().toISOString()),
          content: this.buildDispatchMessageContent(
            batch.triggerTargets,
            batch.displayContent,
          ),
          kind: "agent-dispatch",
          targetAgentIds: [...batch.triggerTargets],
          targetRunCounts,
          dispatchDisplayContent: batch.displayContent,
          senderDisplayName: this.resolveMessageSenderDisplayName(
            state,
            sourceAgentId,
          ),
        };
        this.store.insertMessage(triggerMessage);
        this.emit({
          type: "message-created",
          cwd,
          payload: triggerMessage,
        });
      }
    }

    return batch.jobs.map((job, index) => {
      this.ensureRuntimeTaskAgent(task, job.agentId);
      const executableAgentId = this.resolveExecutableAgentId(
        state,
        job.agentId,
      );
      let prompt: AgentExecutionPrompt;
      let forwardedAgentMessage = "";
      if (job.kind === "raw") {
        prompt = {
          mode: "raw",
          from: "User",
          content: batch.sourceContent,
        };
      } else if (job.kind === "action_required_request") {
        const followUpContent = job.sourceContent.trim();
        const remediationDisplayContent = job.displayContent.trim();
        if (!followUpContent || !remediationDisplayContent) {
          throw new Error(
            `${job.sourceAgentId} 的 action_required 派发缺少可转发正文`,
          );
        }
        const edgeForwardingConfig = this.getEdgeForwardingConfig(
          buildEffectiveTopology(state),
          job.sourceAgentId,
          job.agentId,
          batch.routingKind === "default"
            ? DEFAULT_TOPOLOGY_TRIGGER
            : batch.trigger,
        );
        const dispatchInitialMessageRouting =
          this.resolveDispatchInitialMessageRouting(
            this.getTaskAgentRunCount(taskId, job.agentId),
            edgeForwardingConfig.initialMessageRouting,
          );
        const initialMessageSourceAliasesByAgentId =
          this.resolveInitialMessageSourceAliases(
            state,
            job.sourceAgentId,
            job.agentId,
            dispatchInitialMessageRouting,
          );
        const forwardedContext = buildDownstreamForwardedContextFromMessages(
          taskMessages,
          followUpContent,
          {
            messageMode: edgeForwardingConfig.messageMode,
            initialMessageRouting: dispatchInitialMessageRouting,
            sourceAgentId: job.sourceAgentId,
            initialMessageSourceAliasesByAgentId,
            initialMessageForwardedAgentMessageByAgentId:
              this.resolveInitialMessageForwardedAgentMessages(
                state,
                dispatchInitialMessageRouting,
                initialMessageSourceAliasesByAgentId,
              ),
            globalSourceOrder: this.resolveGlobalSourceOrder(state),
          },
        );
        if (forwardedContext.kind === "empty") {
          throw new Error(
            `${job.sourceAgentId} 的 action_required 派发缺少可转发上下文`,
          );
        }
        prompt = {
          mode: "structured",
          from: job.sourceAgentId,
          agentMessage: forwardedContext.agentMessage,
          omitSourceAgentSectionLabel: true,
        };
        forwardedAgentMessage = forwardedContext.agentMessage;
        const remediationMessage: MessageRecord = {
          id: randomUUID(),
          taskId,
          sender: job.sourceAgentId,
          timestamp: toUtcIsoTimestamp(new Date().toISOString()),
          content: formatActionRequiredRequestContent(
            remediationDisplayContent,
            [job.agentId],
          ),
          kind: "action-required-request",
          followUpMessageId: job.sourceMessageId,
          targetAgentIds: [job.agentId],
          targetRunCounts: [
            (this.store
              .listTaskAgents(taskId)
              .find((item) => item.id === job.agentId)?.runCount ?? 0) + 1,
          ],
          ...withOptionalString(
            {},
            "senderDisplayName",
            this.resolveMessageSenderDisplayName(state, job.sourceAgentId),
          ),
        };
        this.store.insertMessage(remediationMessage);
        this.emit({
          type: "message-created",
          cwd,
          payload: remediationMessage,
        });
      } else {
        if (!batch.sourceAgentId) {
          throw new Error("拓扑自动派发缺少来源 Agent，无法构造转发消息。");
        }
        const edgeForwardingConfig = this.getEdgeForwardingConfig(
          buildEffectiveTopology(state),
          batch.sourceAgentId,
          job.agentId,
          batch.routingKind === "default"
            ? DEFAULT_TOPOLOGY_TRIGGER
            : batch.trigger,
        );
        const dispatchInitialMessageRouting =
          this.resolveDispatchInitialMessageRouting(
            this.getTaskAgentRunCount(taskId, job.agentId),
            edgeForwardingConfig.initialMessageRouting,
          );
        const initialMessageSourceAliasesByAgentId =
          this.resolveInitialMessageSourceAliases(
            state,
            batch.sourceAgentId,
            job.agentId,
            dispatchInitialMessageRouting,
          );
        const forwardedContext = buildDownstreamForwardedContextFromMessages(
          taskMessages,
          batch.sourceContent,
          {
            messageMode: edgeForwardingConfig.messageMode,
            initialMessageRouting: dispatchInitialMessageRouting,
            sourceAgentId: batch.sourceAgentId,
            initialMessageSourceAliasesByAgentId,
            initialMessageForwardedAgentMessageByAgentId:
              this.resolveInitialMessageForwardedAgentMessages(
                state,
                dispatchInitialMessageRouting,
                initialMessageSourceAliasesByAgentId,
              ),
            globalSourceOrder: this.resolveGlobalSourceOrder(state),
          },
        );
        prompt =
          forwardedContext.kind === "empty"
            ? {
                mode: "control",
                content: NONE_MODE_PLACEHOLDER_MESSAGE,
              }
            : {
                mode: "structured",
                from: batch.sourceAgentId ?? "System",
                agentMessage: forwardedContext.agentMessage,
                omitSourceAgentSectionLabel: true,
              };
        forwardedAgentMessage =
          forwardedContext.kind === "empty" ? "" : forwardedContext.agentMessage;
      }
      if (prompt.mode === "control") {
        return {
          id: `${batch.sourceAgentId ?? "user"}:${job.agentId}:${index}:${Date.now()}`,
          agentId: job.agentId,
          promise: this.executeLangGraphAgentOnce(
            cwd,
            task,
            state,
            job.agentId,
            executableAgentId,
            prompt,
            batchSize,
            forwardedAgentMessage,
          ),
        };
      }
      return {
        id: `${batch.sourceAgentId ?? "user"}:${job.agentId}:${index}:${Date.now()}`,
        agentId: job.agentId,
        promise: this.executeLangGraphAgentOnce(
          cwd,
          task,
          state,
          job.agentId,
          executableAgentId,
          prompt,
          batchSize,
          forwardedAgentMessage,
        ),
      };
    });
  }

  private async executeLangGraphAgentOnce(
    cwd: string,
    task: TaskRecord,
    state: GraphTaskState | null,
    runtimeAgentId: string,
    executableAgentId: string,
    prompt: AgentExecutionPrompt,
    concurrentBatchSize: number,
    forwardedAgentMessage: string,
  ): Promise<GraphAgentResult> {
    this.store.updateTaskAgentRun(task.id, runtimeAgentId, "running");
    this.updateTaskStatusIfActive(task.id, "running");
    const currentAgent = this.store
      .listTaskAgents(task.id)
      .find((item) => item.id === runtimeAgentId);
    if (!currentAgent) {
      const missingAgentMessage: MessageRecord = {
        id: randomUUID(),
        taskId: task.id,
        content: `[${runtimeAgentId}] 执行失败：Task ${task.id} 缺少 Agent ${runtimeAgentId}`,
        sender: "system",
        timestamp: toUtcIsoTimestamp(new Date().toISOString()),
        kind: "system-message",
      };
      this.store.insertMessage(missingAgentMessage);
      this.updateTaskStatusIfActive(task.id, "failed");
      this.emit({
        type: "message-created",
        cwd,
        payload: missingAgentMessage,
      });
      return {
        agentId: runtimeAgentId,
        messageId: missingAgentMessage.id,
        status: "failed",
        decisionAgent: false,
        routingKind: "invalid",
        agentStatus: "failed",
        agentContextContent: "",
        forwardedAgentMessage: "",
        opinion: "",
        signalDone: false,
        errorMessage: `Task ${task.id} 缺少 Agent ${runtimeAgentId}`,
      };
    }

    try {
      const currentTask = this.store.getTask(task.id);
      await this.ensureTaskPanels(currentTask);
      const agentSessionId = await this.ensureAgentSession(
        currentTask,
        currentAgent,
      );
      const latestAgent = this.findAgent(
        this.listWorkspaceAgents(),
        executableAgentId,
      );
      if (!latestAgent) {
        throw new Error(`当前工作区缺少 Agent ${executableAgentId}`);
      }

      this.emit({
        type: "agent-status-changed",
        cwd,
        payload: {
          taskId: task.id,
          agentId: runtimeAgentId,
          status: "running",
          runCount: currentAgent.runCount,
        },
      });
      this.emit({
        type: "task-updated",
        cwd,
        payload: this.hydrateTask(task.id),
      });

      const topology = this.store.getTopology();
      const dispatchedContent = this.buildAgentExecutionPrompt(prompt);
      const decisionAgent = isExecutionDecisionAgent({
        state,
        topology,
        runtimeAgentId,
        executableAgentId,
      });
      const allowedDecisionTriggers = decisionAgent
        ? this.resolveAllowedDecisionTriggers({
            state,
            topology,
            runtimeAgentId,
            executableAgentId,
          })
        : [];
      const responsePromise = this.opencodeRunner.run({
        cwd: currentTask.cwd,
        taskId: task.id,
        sessionId: agentSessionId,
        content: dispatchedContent,
        agent: executableAgentId,
        allowedDecisionTriggers: allowedDecisionTriggers.map((item) => item.trigger),
      });
      const response = await this.awaitExecutionWithProgressSync({
        execution: responsePromise,
        taskId: task.id,
        agentIds: [runtimeAgentId],
      });

      if (response.status === "error") {
        throw new Error(
          response.rawMessage.error ||
            response.finalMessage ||
            `${runtimeAgentId} 返回错误状态`,
        );
      }
      const parsedDecision = parseDecisionPure(
        response.finalMessage,
        decisionAgent,
        allowedDecisionTriggers,
      );
      const effectiveTopology = state
        ? buildEffectiveTopology(state)
        : topology;
      const resolvedDecision = this.resolveParsedDecisionValue({
        parsedDecision,
        decisionAgent,
        topology: effectiveTopology,
        sourceAgentIds: [runtimeAgentId, executableAgentId],
      });
      const agentContextContent = this.resolveAgentContextContent(
        parsedDecision,
        response.finalMessage,
        allowedDecisionTriggers.map((item) => item.trigger),
      );
      const displayContent = this.createDisplayContent(parsedDecision);
      if (!displayContent && !(decisionAgent && parsedDecision.kind === "valid")) {
        throw new Error(`${runtimeAgentId} 未返回可展示的结果正文`);
      }
      const baseTaskMessage = {
        id: response.messageId,
        taskId: task.id,
        content: displayContent,
        sender: runtimeAgentId,
        timestamp: toUtcIsoTimestamp(response.timestamp),
        kind: "agent-final" as const,
        runCount: currentAgent.runCount,
        status: response.status,
        responseNote: parsedDecision.opinion ?? "",
        rawResponse: response.finalMessage,
        senderDisplayName: this.resolveMessageSenderDisplayName(
          state,
          runtimeAgentId,
        ),
      };
      let taskMessage: MessageRecord;
      if (resolvedDecision === "labeled" && parsedDecision.kind === "valid") {
        taskMessage = {
          ...baseTaskMessage,
          routingKind: "labeled",
          trigger: parsedDecision.trigger,
        };
      } else if (resolvedDecision === "default") {
        taskMessage = {
          ...baseTaskMessage,
          routingKind: "default",
        };
      } else {
        taskMessage = {
          ...baseTaskMessage,
          routingKind: "invalid",
        };
      }
      this.store.insertMessage(taskMessage);

      const actionRequiredTargets =
        parsedDecision.kind === "valid" &&
        resolvedDecision === "labeled" &&
        resolveTriggerRoutingKindForSource(
          effectiveTopology,
          runtimeAgentId,
          parsedDecision.trigger,
        ) === "action_required"
          ? this.getOutgoingEdgesForTrigger(
              effectiveTopology,
              runtimeAgentId,
              parsedDecision.trigger,
            )
          : [];
      const agentStatus = resolveAgentStatusFromRouting({
        routingKind: resolvedDecision,
        decisionAgent,
        enteredActionRequired: actionRequiredTargets.length > 0,
      });
      this.store.updateTaskAgentStatus(
        task.id,
        runtimeAgentId,
        agentStatus,
      );
      if (actionRequiredTargets.length > 0) {
        this.updateTaskStatusIfActive(
          task.id,
          concurrentBatchSize > 1 ? "running" : "action_required",
        );
      } else if (agentStatus === "failed") {
        this.updateTaskStatusIfActive(task.id, "failed");
      } else {
        this.updateTaskStatusIfActive(task.id, "running");
      }

      this.emit({
        type: "message-created",
        cwd,
        payload: taskMessage,
      });
      this.emit({
        type: "agent-status-changed",
        cwd,
        payload: {
          taskId: task.id,
          agentId: runtimeAgentId,
          status: agentStatus,
          runCount:
            this.store
              .listTaskAgents(task.id)
              .find((item) => item.id === runtimeAgentId)?.runCount ??
            currentAgent.runCount,
        },
      });
      this.emit({
        type: "task-updated",
        cwd,
        payload: this.hydrateTask(task.id),
      });

      const signal = this.parseSignal(response.finalMessage);
      const baseGraphAgentResult = {
        agentId: runtimeAgentId,
        messageId: taskMessage.id,
        status: "completed" as const,
        decisionAgent,
        agentStatus,
        agentContextContent,
        forwardedAgentMessage,
        opinion: parsedDecision.opinion,
        signalDone: signal.done,
      };
      if (resolvedDecision === "labeled" && parsedDecision.kind === "valid") {
        const labeledResult: GraphAgentResult = {
          ...baseGraphAgentResult,
          routingKind: "labeled",
          trigger: parsedDecision.trigger,
        };
        return labeledResult;
      }
      if (resolvedDecision === "default") {
        const defaultResult: GraphAgentResult = {
          ...baseGraphAgentResult,
          routingKind: "default",
        };
        return defaultResult;
      }
      const invalidResult: GraphAgentResult = {
        ...baseGraphAgentResult,
        routingKind: "invalid",
      };
      return invalidResult;
    } catch (error) {
      const topology = this.store.getTopology();
      const decisionAgent = isExecutionDecisionAgent({
        state,
        topology,
        runtimeAgentId,
        executableAgentId,
      });
      this.store.updateTaskAgentStatus(
        task.id,
        runtimeAgentId,
        "failed",
      );
      const failedMessage: MessageRecord = {
        id: randomUUID(),
        taskId: task.id,
        content: `[${runtimeAgentId}] 执行失败：${error instanceof Error ? error.message : "未知错误"}`,
        sender: "system",
        timestamp: toUtcIsoTimestamp(new Date().toISOString()),
        kind: "system-message",
      };
      this.store.insertMessage(failedMessage);
      this.updateTaskStatusIfActive(task.id, "failed");
      this.emit({
        type: "message-created",
        cwd,
        payload: failedMessage,
      });
      this.emit({
        type: "agent-status-changed",
        cwd,
        payload: {
          taskId: task.id,
          agentId: runtimeAgentId,
          status: "failed",
          runCount:
            this.store
              .listTaskAgents(task.id)
              .find((item) => item.id === runtimeAgentId)?.runCount ?? 0,
        },
      });
      this.emit({
        type: "task-updated",
        cwd,
        payload: this.hydrateTask(task.id),
      });

      return {
        agentId: runtimeAgentId,
        messageId: failedMessage.id,
        status: "failed",
        decisionAgent,
        routingKind: "invalid",
        agentStatus: "failed",
        agentContextContent: "",
        forwardedAgentMessage: "",
        opinion: "",
        signalDone: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async completeTask(
    cwd: string,
    taskId: string,
    status: Extract<TaskRecord["status"], "finished" | "failed">,
    finishReason?: string | null,
    failureReason?: string | null,
  ) {
    const currentTask = this.store.getTask(taskId);
    if (currentTask.status === status && currentTask.completedAt) {
      return;
    }

    const completedAt = new Date().toISOString();
    this.store.updateTaskStatus(taskId, status, completedAt);
    const snapshot = this.hydrateTask(taskId);
    const completionTimestamp = this.createTrailingMessageTimestamp(
      taskId,
    );
    const completionMessage: MessageRecord =
      status === "finished"
        ? {
            id: randomUUID(),
            taskId,
            sender: "system",
            timestamp: toUtcIsoTimestamp(completionTimestamp),
            content: buildTaskRoundFinishedMessageContent(),
            kind: "task-round-finished",
            finishReason: finishReason ?? "round_finished",
          }
        : {
            id: randomUUID(),
            taskId,
            sender: "system",
            timestamp: toUtcIsoTimestamp(completionTimestamp),
            content: buildTaskCompletionMessageContent(
              withOptionalValue(
                {
                  status,
                  taskTitle: snapshot.task.title,
                },
                "failureReason",
                failureReason,
              ),
            ),
            kind: "task-completed",
            status: "failed",
          };
    this.store.insertMessage(completionMessage);
    this.emit({
      type: "message-created",
      cwd,
      payload: completionMessage,
    });
    this.emit({
      type: "task-updated",
      cwd,
      payload: snapshot,
    });
  }

  private createTrailingMessageTimestamp(taskId: string): string {
    const latestTimestamp =
      this.store.listMessages(taskId).at(-1)?.timestamp ?? null;
    const nowMs = Date.now();
    const latestMs = latestTimestamp ? Date.parse(latestTimestamp) : Number.NaN;
    const nextMs = Number.isFinite(latestMs)
      ? Math.max(nowMs, latestMs + 1)
      : nowMs;
    return new Date(nextMs).toISOString();
  }

  private getOutgoingEdgesForTrigger(
    topology: TopologyRecord,
    sourceAgentId: string,
    trigger: string,
  ) {
    return topology.edges.filter(
      (edge) => edge.source === sourceAgentId && edge.trigger === trigger,
    );
  }

  protected getEdgeForwardingConfig(
    topology: TopologyRecord,
    sourceAgentId: string,
    targetAgentId: string,
    trigger: string,
  ): EdgeForwardingConfig {
    const edge = topology.edges.find(
      (item) =>
        item.source === sourceAgentId &&
        item.target === targetAgentId &&
        item.trigger === trigger,
    );
    const topologyNodeRecords = getTopologyNodeRecords(topology);
    if (edge) {
      const targetNode = topologyNodeRecords.find(
        (node) => node.id === targetAgentId,
      );
      if (!targetNode) {
        throw new Error(`拓扑缺少目标节点记录：${targetAgentId}`);
      }
      return {
        messageMode: edge.messageMode,
        initialMessageRouting: targetNode.initialMessageRouting,
      };
    }

    const targetNode = topologyNodeRecords.find(
      (node) => node.id === targetAgentId,
    );
    if (targetNode) {
      const inheritedEdge = topology.edges.find(
        (item) =>
          item.source === sourceAgentId &&
          item.target === targetNode.templateName &&
          item.trigger === trigger,
      );
      if (inheritedEdge) {
        return {
          messageMode: inheritedEdge.messageMode,
          initialMessageRouting: targetNode.initialMessageRouting,
        };
      }
    }

    throw new Error(
      `拓扑边不存在，无法解析转发配置：${sourceAgentId} -> ${targetAgentId} (${trigger})`,
    );
  }

  private getAgentDisplayName(id: string) {
    return id;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  }

  private extractSessionIdFromOpenCodeEvent(event: unknown): string | null {
    const record = this.asRecord(event);
    const properties = this.asRecord(record["properties"]);
    const payload = this.asRecord(record["payload"]);
    const candidates = [
      record["sessionID"],
      record["sessionId"],
      properties["sessionID"],
      properties["sessionId"],
      payload["sessionID"],
      payload["sessionId"],
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    return null;
  }

  private scheduleRuntimeSync(taskId: string) {
    const overlay = this.taskRuntimeOverlays.get(taskId);
    if (!overlay) {
      return;
    }

    if (path.resolve(overlay.cwd) !== this.cwd) {
      return;
    }

    const existing = this.pendingRuntimeSyncTasks.get(taskId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.pendingRuntimeSyncTasks.delete(taskId);
      const overlayAfterDelay = this.taskRuntimeOverlays.get(taskId);
      if (!overlayAfterDelay) {
        throw new Error(`Task ${taskId} 缺少运行态 overlay，无法同步过程消息`);
      }
      void this.syncVisibleRuntimeActivities({
        taskId,
        agentIds: [...overlayAfterDelay.agentSessions.keys()],
      });
    }, this.runtimeRefreshDebounceMs);
    this.pendingRuntimeSyncTasks.set(taskId, timer);
  }

  private scheduleEventStreamReconnect(cwd: string) {
    const normalizedCwd = path.resolve(cwd);
    const overlay = [...this.taskRuntimeOverlays.values()].find((item) => path.resolve(item.cwd) === normalizedCwd);
    if (!overlay) {
      return;
    }

    if (
      !shouldScheduleEventStreamReconnect({
        hasProjectRecord: normalizedCwd === this.cwd,
        isDisposing: this.isDisposing,
      })
    ) {
      return;
    }
    if (this.pendingEventReconnects.has(normalizedCwd)) {
      return;
    }

    const timer = setTimeout(() => {
      this.pendingEventReconnects.delete(normalizedCwd);
      const reconnectOverlay = [...this.taskRuntimeOverlays.values()]
        .find((item) => path.resolve(item.cwd) === normalizedCwd);
      if (!reconnectOverlay) {
        return;
      }
      if (
        !shouldScheduleEventStreamReconnect({
          hasProjectRecord: normalizedCwd === this.cwd,
          isDisposing: this.isDisposing,
        })
      ) {
        return;
      }
      void this.ensureTaskRuntimeEventStream({
        id: reconnectOverlay.taskId,
        cwd: reconnectOverlay.cwd,
      });
    }, 1000);
    this.pendingEventReconnects.set(normalizedCwd, timer);
  }

  private getTaskAgentRunCount(
    taskId: string,
    agentId: string,
  ): number {
    return (
      this.store
        .listTaskAgents(taskId)
        .find((agent) => agent.id === agentId)?.runCount ?? 0
    );
  }

  private getPersistedActivityIdsForAgent(
    taskId: string,
    agentId: string,
  ): Set<string> {
    const overlay = this.taskRuntimeOverlays.get(taskId);
    if (!overlay) {
      throw new Error(`Task ${taskId} 缺少运行态 overlay，无法持久化过程消息`);
    }
    const existing = overlay.persistedActivityIdsByAgent.get(agentId);
    if (existing) {
      return existing;
    }
    const created = new Set<string>();
    overlay.persistedActivityIdsByAgent.set(agentId, created);
    return created;
  }

  private createAgentProgressMessage(input: {
    taskId: string;
    agentId: string;
    sessionId: string;
    runCount: number;
    activity: OpenCodeRuntimeActivity;
  }): AgentProgressMessageRecord {
    const detail = input.activity.detail.trim() || input.activity.label.trim();
    return {
      id: `${input.taskId}:${input.agentId}:${input.runCount}:${input.activity.id}`,
      taskId: input.taskId,
      content: detail,
      sender: input.agentId,
      timestamp: toUtcIsoTimestamp(input.activity.timestamp),
      kind: "agent-progress" as const,
      activityKind: input.activity.kind satisfies AgentProgressActivityKind,
      label: input.activity.label,
      detail,
      detailState: input.activity.detailState,
      sessionId: input.sessionId,
      runCount: input.runCount,
    };
  }

  private shouldRefreshAgentProgressDetail(
    taskId: string,
    existing: AgentProgressMessageRecord,
    nextFreshness: RuntimeActivityFreshness,
  ) {
    const overlay = this.taskRuntimeOverlays.get(taskId);
    if (!overlay) {
      throw new Error(`Task ${taskId} 缺少运行态 overlay，无法判断过程消息是否应更新`);
    }
    const existingFreshness = overlay.activityFreshnessByMessageId.get(existing.id);
    if (!existingFreshness) {
      return false;
    }
    return isRuntimeActivityFreshnessNewer(existingFreshness, nextFreshness);
  }

  private async syncVisibleRuntimeActivities(input: {
    taskId: string;
    agentIds: string[];
  }) {
    const overlay = this.taskRuntimeOverlays.get(input.taskId);
    if (!overlay) {
      throw new Error(`Task ${input.taskId} 缺少运行态 overlay，无法同步过程消息`);
    }

    const emittedMessages: MessageRecord[] = [];
    const targetAgentIds = new Set(input.agentIds);
    for (const [agentId, sessionId] of overlay.agentSessions.entries()) {
        if (!targetAgentIds.has(agentId)) {
          continue;
        }
      const runtime = await runWithTaskLogScope(overlay.taskId, () =>
        this.opencodeClient.getSessionRuntime(
          overlay.cwd,
          sessionId,
        ));

      const persistedActivityIds = this.getPersistedActivityIdsForAgent(
        input.taskId,
        agentId,
      );
      const runCount = this.getTaskAgentRunCount(
        input.taskId,
        agentId,
      );
      const nextActivities = runtime.activities.filter(
        (activity) => {
          if (!persistedActivityIds.has(activity.id)) {
            return true;
          }
          const nextFreshness = buildRuntimeActivityFreshness(activity);
          const candidateMessage = this.createAgentProgressMessage({
            taskId: input.taskId,
            agentId,
            sessionId,
            runCount,
            activity,
          });
          const existingMessage = this.store
            .listMessages(input.taskId)
            .find(
              (message): message is AgentProgressMessageRecord =>
                message.id === candidateMessage.id
                && message.kind === "agent-progress",
            );
          if (!existingMessage) {
            return false;
          }
          return this.shouldRefreshAgentProgressDetail(
            input.taskId,
            existingMessage,
            nextFreshness,
          );
        },
      );

      for (const activity of nextActivities) {
        const message = this.createAgentProgressMessage({
          taskId: input.taskId,
          agentId,
          sessionId,
          runCount,
          activity,
        });
        overlay.activityFreshnessByMessageId.set(
          message.id,
          buildRuntimeActivityFreshness(activity),
        );
        persistedActivityIds.add(activity.id);
        emittedMessages.push(message);
      }
    }

    if (emittedMessages.length === 0) {
      return;
    }

    for (const message of emittedMessages) {
      this.store.insertMessage(message);
      this.emit({
        type: "message-created",
        cwd: overlay.cwd,
        payload: message,
      });
    }

    this.emit({
      type: "task-updated",
      cwd: overlay.cwd,
      payload: this.hydrateTask(input.taskId),
    });
  }

  private async awaitExecutionWithProgressSync(input: {
    execution: Promise<OpenCodeExecutionResult>;
    taskId: string;
    agentIds: string[];
  }): Promise<OpenCodeExecutionResult> {
    const settled = {
      done: false,
    };
    const trackedExecution = input.execution.finally(() => {
      settled.done = true;
    });

    while (!settled.done) {
      await this.syncVisibleRuntimeActivities({
        taskId: input.taskId,
        agentIds: input.agentIds,
      });
      if (settled.done) {
        break;
      }
      const waitResult = await Promise.race([
        trackedExecution.then(() => "settled" as const),
        new Promise<"tick">((resolve) => {
          setTimeout(() => {
            resolve("tick");
          }, RUNTIME_PROGRESS_SYNC_INTERVAL_MS);
        }),
      ]);
      if (waitResult === "settled") {
        break;
      }
    }

    await this.syncVisibleRuntimeActivities({
      taskId: input.taskId,
      agentIds: input.agentIds,
    });
    return trackedExecution;
  }

  private emit(event: AgentTeamEvent) {
    this.events.emit("agent-team-event", event);
  }

  private async ensureTaskRuntimeEventStream(
    task: Pick<TaskRecord, "id" | "cwd">,
  ) {
    if (!this.enableEventStream) {
      return;
    }

    const overlay = this.taskRuntimeOverlays.get(task.id);
    if (!overlay) {
      return;
    }
    if (![...overlay.agentSessions.values()].some((sessionId) => sessionId.trim().length > 0)) {
      return;
    }
    const normalizedCwd = path.resolve(overlay.cwd);
    if (this.runtimeEventCallbacks.has(normalizedCwd)) {
      return;
    }

    const onEvent = (event: unknown) => {
      const sessionId = this.extractSessionIdFromOpenCodeEvent(event);
      if (!sessionId) {
        return;
      }
      const runtimeOverlay = [...this.taskRuntimeOverlays.values()].find((item) =>
        path.resolve(item.cwd) === normalizedCwd
        && [...item.agentSessions.values()].some((currentSessionId) => currentSessionId === sessionId)
      );
      if (!runtimeOverlay) {
        return;
      }
      this.scheduleRuntimeSync(runtimeOverlay.taskId);
    };
    this.runtimeEventCallbacks.set(normalizedCwd, onEvent);
    void this.opencodeClient
      .connectEvents(normalizedCwd, onEvent)
      .catch(() => undefined)
      .finally(() => {
        this.runtimeEventCallbacks.delete(normalizedCwd);
        this.scheduleEventStreamReconnect(normalizedCwd);
      });
  }
}
