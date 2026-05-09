import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import type {
  AgentTeamEvent,
  GetTaskRuntimePayload,
  OpenAgentTerminalPayload,
  SubmitTaskPayload,
  UiSnapshotPayload,
} from "@shared/types";
import { parseJson5 } from "@shared/json5";
import type { Orchestrator } from "../runtime/orchestrator";
import { buildTaskLogFilePath } from "../runtime/app-log";
import {
  UI_LOOPBACK_HOST,
  UI_LOOPBACK_IPV6_HOST,
  type UiLoopbackBindHost,
} from "./ui-host-launch";
import { buildUiUrl } from "./ui-host-launch";

interface StartWebHostOptions {
  orchestrator: Orchestrator;
  cwd: string;
  taskId: string;
  port: number;
  webRoot: string | null;
  userDataPath: string;
  bindHosts: UiLoopbackBindHost[];
}

function json(response: http.ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function text(response: http.ServerResponse, statusCode: number, body: string, extraHeaders?: Record<string, string>) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return parseJson5(Buffer.concat(chunks).toString("utf8"));
}

async function buildUiSnapshotPayload(
  orchestrator: Orchestrator,
  taskId: string,
  options: Pick<StartWebHostOptions, "port" | "userDataPath">,
): Promise<UiSnapshotPayload> {
  const task = await orchestrator.getTaskSnapshot(taskId);
  const workspace = await orchestrator.getWorkspaceSnapshot(task.task.cwd);
  return {
    workspace,
    task,
    launchTaskId: taskId,
    launchCwd: workspace.cwd,
    taskLogFilePath: buildTaskLogFilePath(options.userDataPath, taskId),
    taskUrl: buildUiUrl({
      port: options.port,
      taskId,
    }),
  };
}

function getContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function buildStaticFileHeaders(filePath: string): Record<string, string> {
  return {
    "content-type": getContentType(filePath),
    "cache-control": "no-store",
  };
}

function resolveStaticFilePath(webRoot: string, pathname: string): string {
  const sanitized = pathname === "/" ? "/index.html" : pathname;
  const nextPath = path.normalize(path.join(webRoot, sanitized));
  if (!nextPath.startsWith(path.normalize(webRoot))) {
    return path.join(webRoot, "index.html");
  }
  if (fs.existsSync(nextPath) && fs.statSync(nextPath).isFile()) {
    return nextPath;
  }
  return path.join(webRoot, "index.html");
}

export async function startWebHost(
  options: StartWebHostOptions,
): Promise<{ close: () => Promise<void> }> {
  const subscriptions = new Set<http.ServerResponse>();
  let unsubscribed = false;

  const unsubscribe = options.orchestrator.subscribe((event: AgentTeamEvent) => {
    if (event.cwd !== options.cwd) {
      return;
    }

    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of subscriptions) {
      response.write(payload);
    }
  });

  const requestHandler = async (request: http.IncomingMessage, response: http.ServerResponse) => {
    if (!request.url) {
      text(response, 400, "missing url");
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? UI_LOOPBACK_HOST}`);
    try {
      if (request.method === "GET" && url.pathname === "/healthz") {
        json(response, 200, {
          ok: true,
          taskId: options.taskId,
          port: options.port,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/ui-snapshot") {
        const taskId = url.searchParams.get("taskId") ?? options.taskId;
        json(response, 200, await buildUiSnapshotPayload(options.orchestrator, taskId, options));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/tasks/runtime") {
        const taskId = url.searchParams.get("taskId") ?? options.taskId;
        const snapshot = await options.orchestrator.getTaskSnapshot(taskId, options.cwd);
        const payload: GetTaskRuntimePayload = {
          cwd: snapshot.task.cwd,
          taskId: snapshot.task.id,
        };
        json(response, 200, await options.orchestrator.getTaskRuntime(payload));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/submit") {
        const payload = await readJsonBody(request) as SubmitTaskPayload;
        json(response, 200, await options.orchestrator.submitTask(payload));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/open-agent-terminal") {
        const payload = await readJsonBody(request) as OpenAgentTerminalPayload;
        await options.orchestrator.openAgentTerminal(payload);
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/events") {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        response.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
        subscriptions.add(response);
        request.on("close", () => {
          subscriptions.delete(response);
          response.end();
        });
        return;
      }

      if (request.method !== "GET") {
        text(response, 405, "method not allowed");
        return;
      }

      if (options.webRoot) {
        const filePath = resolveStaticFilePath(options.webRoot, url.pathname);
        response.writeHead(200, buildStaticFileHeaders(filePath));
        fs.createReadStream(filePath).pipe(response);
        return;
      }

      text(response, 500, "web assets unavailable");
    } catch (error) {
      json(response, 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const closeServer = async (server: http.Server) => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  const closeBoundServers = async (servers: readonly http.Server[]) => {
    for (const server of servers) {
      await closeServer(server);
    }
  };

  const unsubscribeOnce = () => {
    if (unsubscribed) {
      return;
    }
    unsubscribed = true;
    unsubscribe();
  };

  const teardown = async (servers: readonly http.Server[]) => {
    unsubscribeOnce();
    for (const response of subscriptions) {
      response.end();
    }
    subscriptions.clear();
    await closeBoundServers(servers);
  };

  const boundServers: http.Server[] = [];
  for (const host of options.bindHosts) {
    const server = http.createServer(requestHandler);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        if (host === UI_LOOPBACK_IPV6_HOST) {
          server.listen({
            port: options.port,
            host,
            ipv6Only: true,
          }, () => resolve());
          return;
        }
        server.listen(options.port, host, () => resolve());
      });
      boundServers.push(server);
    } catch (error) {
      const listenError =
        error instanceof Error ? error : new Error(String(error));
      try {
        await teardown(boundServers);
      } catch (teardownError) {
        throw new AggregateError(
          [listenError, teardownError],
          "Web Host 监听失败，且回滚失败",
        );
      }
      throw listenError;
    }
  }

  if (boundServers.length === 0) {
    await teardown(boundServers);
    throw new Error("当前机器没有可用的 loopback 地址可用于启动 Web Host。");
  }

  return {
    close: async () => teardown(boundServers),
  };
}
