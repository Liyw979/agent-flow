import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJson5 } from "@shared/json5";

import { buildTaskLogFilePath, initAppFileLogger, runWithTaskLogScope } from "./app-log";
import type { OpenCodeNormalizedMessage, OpenCodeSessionRuntime } from "./opencode-client";
import { OpenCodeClient } from "./opencode-client";
import { toUtcIsoTimestamp } from "@shared/types";

class TestOpenCodeClient extends OpenCodeClient {
  declare request: OpenCodeClient["request"];
}

type TestRequestPathname = Parameters<TestOpenCodeClient["request"]>[0];
type TestRequestOptions = Parameters<TestOpenCodeClient["request"]>[1];
type TestRequestResult = ReturnType<TestOpenCodeClient["request"]>;

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-team-opencode-client-"));
}

function createClient(cwd = createTempDir()) {
  const client = new OpenCodeClient() as OpenCodeClient & {
    servers: Map<string, {
      cwd: string;
      serverHandle: Promise<{ process: null; port: number }> | null;
      eventPump: Promise<void> | null;
      injectedConfigContent: {
        agent: Record<string, unknown>;
      };
    }>;
    request: (pathname: TestRequestPathname, options: TestRequestOptions) => TestRequestResult;
    getSessionMessage: (cwd: string, sessionId: string, messageId: string) => Promise<unknown>;
    listSessionMessages: (cwd: string, sessionId: string, limit?: number) => Promise<unknown[]>;
  };
  const normalizedCwd = path.resolve(cwd);
  client.servers.set(normalizedCwd, {
    cwd: normalizedCwd,
    serverHandle: Promise.resolve({
      process: null,
      port: 43127,
    }),
    eventPump: null,
    injectedConfigContent: {
      agent: {},
    },
  });
  return {
    client,
    cwd: normalizedCwd,
  };
}

async function withFastForwardedTimeouts<T>(
  callback: () => Promise<T>,
  stepMs = 400,
): Promise<T> {
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  let nowMs = originalDateNow();

  Date.now = () => nowMs;
  globalThis.setTimeout = (((handler: (...args: unknown[]) => void, _timeout?: number, ...args: unknown[]) => {
    nowMs += stepMs;
    handler(...args);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);

  try {
    return await callback();
  } finally {
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
  }
}

test("request 会跟随当前 serverHandle 的实际端口", async () => {
  const { client, cwd } = createClient();
  const typed = client as OpenCodeClient & {
    servers: Map<string, {
      cwd: string;
      serverHandle: Promise<{ process: null; port: number }> | null;
      eventPump: Promise<void> | null;
      injectedConfigContent: {
        agent: Record<string, unknown>;
      };
    }>;
    request: (pathname: TestRequestPathname, options: TestRequestOptions) => TestRequestResult;
  };
  const state = typed.servers.get(cwd);
  assert.notEqual(state, undefined);
  state!.serverHandle = Promise.resolve({
    process: null,
    port: 43127,
  });

  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    await typed.request("/session", {
      method: "GET",
      cwd,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestedUrl, "http://127.0.0.1:43127/session");
});

test("request 失败时会写入 task 级失败日志", async () => {
  const userDataPath = createTempDir();
  initAppFileLogger(userDataPath);
  const { client, cwd } = createClient();
  const typed = client as OpenCodeClient & {
    request: (pathname: TestRequestPathname, options: TestRequestOptions) => TestRequestResult;
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("boom task-request-failed");
  }) as typeof fetch;

  try {
    await runWithTaskLogScope("task-request-failed", () => assert.rejects(
      typed.request("/session", {
        method: "GET",
        cwd,
      }),
      /boom task-request-failed/,
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }

  const logFilePath = buildTaskLogFilePath(userDataPath, "task-request-failed");
  const records = fs.readFileSync(logFilePath, "utf8").trim().split("\n").map((line) => parseJson5<Record<string, unknown>>(line));
  assert.equal(records.at(-1)?.["event"], "opencode.request_failed");
  assert.equal(records.at(-1)?.["taskId"], "task-request-failed");
});

test("submitMessage 在空响应体时必须报错，不能伪造 pending message", async () => {
  const { client, cwd } = createClient();
  client.request = async () => new Response("", { status: 200 });

  await assert.rejects(
    client.submitMessage(cwd, "session-1", {
      agent: "BA",
      content: "请整理需求",
    }),
    /响应缺少有效的消息实体/,
  );
});

test("submitMessage 最终请求体不注入 system 字段", async () => {
  const { client, cwd } = createClient();
  let capturedBody = "";
  client.request = async (_pathname, options) => {
    capturedBody = options.body ?? "";
    return new Response(JSON.stringify({
      id: "msg-1",
      role: "assistant",
      parts: [{ type: "text", text: "已发送" }],
      createdAt: "2026-05-07T00:00:00.000Z",
      sessionID: "session-1",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await client.submitMessage(cwd, "session-1", {
    agent: "TaskReview",
    content: "请继续判定",
  });

  assert.notEqual(capturedBody, "");
  assert.equal(capturedBody.includes("\"system\""), false);
  assert.deepEqual(JSON.parse(capturedBody), {
    agent: "TaskReview",
    parts: [{ type: "text", text: "请继续判定" }],
  });
});

test("createSession throws when the response is missing a session id", async () => {
  const { client, cwd } = createClient();
  client.request = async () => new Response("", { status: 200 });

  await assert.rejects(
    client.createSession(cwd, "demo"),
    /session id/,
  );
});

test("createSession logs invalid responses into the task log file", async () => {
  const userDataPath = createTempDir();
  const cwd = createTempDir();
  const taskId = "task-123";
  initAppFileLogger(userDataPath);

  const client = new OpenCodeClient() as OpenCodeClient & {
    request: (pathname: TestRequestPathname, options: TestRequestOptions) => TestRequestResult;
  };
  client.request = async () => new Response("", { status: 200 });

  await runWithTaskLogScope(taskId, () => assert.rejects(
    client.createSession(cwd, "demo"),
    /session id/,
  ));

  const lines = fs.readFileSync(buildTaskLogFilePath(userDataPath, taskId), "utf8").trim().split("\n");
  const record = parseJson5<Record<string, unknown>>(lines.at(-1) ?? "{}");
  assert.equal(record["event"], "opencode.create_session_invalid_response");
  assert.equal(record["taskId"], taskId);
});

test("createSession 在响应体不是合法 JSON5 时仍走 invalid response 分支并记录日志", async () => {
  const userDataPath = createTempDir();
  const cwd = createTempDir();
  const taskId = "task-malformed";
  initAppFileLogger(userDataPath);

  const client = new OpenCodeClient() as OpenCodeClient & {
    request: (pathname: TestRequestPathname, options: TestRequestOptions) => TestRequestResult;
  };
  client.request = async () => new Response("oops", { status: 200 });

  await runWithTaskLogScope(taskId, () => assert.rejects(
    client.createSession(cwd, "demo"),
    /session id/,
  ));

  const lines = fs.readFileSync(buildTaskLogFilePath(userDataPath, taskId), "utf8").trim().split("\n");
  const record = parseJson5<Record<string, unknown>>(lines.at(-1) ?? "{}");
  assert.equal(record["event"], "opencode.create_session_invalid_response");
  assert.equal(record["taskId"], taskId);
});

test("session message 请求不注入 AbortSignal，确保长任务不会被请求层超时中断", async () => {
  const { client, cwd } = createClient();
  const typed = client as OpenCodeClient & {
    request: (pathname: TestRequestPathname, options: TestRequestOptions) => TestRequestResult;
  };

  const originalFetch = globalThis.fetch;
  let capturedSignal: AbortSignal | null | undefined;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    capturedSignal = args[1]?.signal;
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    await typed.request("/session/session-1/message", {
      method: "POST",
      cwd,
      body: JSON.stringify({ parts: [] }),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(capturedSignal, undefined);
});

test("createSession 超时后不应重启 runtime，也不应自动重试", async () => {
  const { client, cwd } = createClient();
  const typed = client as OpenCodeClient & {
    request: (pathname: TestRequestPathname, options: TestRequestOptions) => TestRequestResult;
  };

  let requestCount = 0;
  typed.request = async () => {
    requestCount += 1;
    throw new Error("OpenCode 请求超时: POST http://127.0.0.1:43127/session 超过 12000ms");
  };

  await assert.rejects(
    client.createSession(cwd, "demo"),
    /请求超时/,
  );
  assert.equal(requestCount, 1);
});

test("消息查询接口空响应体时返回空结果而不是抛错", async () => {
  const { client, cwd } = createClient();
  client.request = async () => new Response("", { status: 200 });

  const message = await client.getSessionMessage(cwd, "session-1", "msg-1");
  const list = await client.listSessionMessages(cwd, "session-1");

  assert.equal(message, null);
  assert.deepEqual(list, []);
});

test("resolveExecutionResult 在消息已完成时不会额外等待 session idle 超时", async () => {
  const { client, cwd } = createClient();
  const typed = client as unknown as OpenCodeClient & {
    waitForSessionSettled: (sessionId: string, after: number, timeoutMs: number) => Promise<void>;
    waitForMessageCompletion: (
      cwd: string,
      sessionId: string,
      messageId: string,
      fallbackTimestamp: string,
      timeoutMs: number,
    ) => Promise<OpenCodeNormalizedMessage | null>;
    getLatestAssistantMessage: (cwd: string, sessionId: string) => Promise<unknown>;
    getSessionRuntime: (cwd: string, sessionId: string) => Promise<OpenCodeSessionRuntime>;
  };
  const completedAt = new Date().toISOString();
  typed.waitForSessionSettled = async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  };
  typed.waitForMessageCompletion = async () => ({
    id: "msg-1",
    content: "已完成",
    sender: "assistant",
    timestamp: toUtcIsoTimestamp(completedAt),
    error: null,
    raw: { completedAt },
  });
  typed.getLatestAssistantMessage = async () => null;
  typed.getSessionRuntime = async () => ({
    sessionId: "session-1",
    messageCount: 1,
    updatedAt: completedAt,
    headline: null,
    activeToolNames: [],
    activities: [],
  });

  const startedAt = Date.now();
  const result = await typed.resolveExecutionResult(cwd, "session-1", {
    id: "msg-1",
    content: "",
    sender: "assistant",
    timestamp: toUtcIsoTimestamp(completedAt),
    error: null,
    raw: null,
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.finalMessage, "已完成");
  assert.ok(elapsed < 120, `resolveExecutionResult 耗时 ${elapsed}ms，说明仍然被 session idle 等待拖住了`);
});

test("resolveExecutionResult 在没有任何 assistant 消息时必须报错，不能拿提交态或空消息兜底", async () => {
  const { client, cwd } = createClient();
  const typed = client as unknown as OpenCodeClient & {
    waitForSessionSettled: (sessionId: string, after: number, timeoutMs: number) => Promise<void>;
    waitForMessageCompletion: (
      cwd: string,
      sessionId: string,
      messageId: string,
      fallbackTimestamp: string,
      timeoutMs: number,
    ) => Promise<OpenCodeNormalizedMessage | null>;
    getLatestAssistantMessage: (cwd: string, sessionId: string) => Promise<unknown>;
    getSessionRuntime: (cwd: string, sessionId: string) => Promise<OpenCodeSessionRuntime>;
  };

  typed.waitForSessionSettled = async () => undefined;
  typed.waitForMessageCompletion = async () => null;
  typed.getLatestAssistantMessage = async () => null;
  typed.getSessionRuntime = async () => ({
    sessionId: "session-1",
    messageCount: 0,
    updatedAt: null,
    headline: null,
    activeToolNames: [],
    activities: [],
  });

  await assert.rejects(
    typed.resolveExecutionResult(cwd, "session-1", {
      id: "msg-user",
      content: "请整理需求",
      sender: "user",
      timestamp: toUtcIsoTimestamp("2026-04-25T00:00:00.000Z"),
      error: null,
      raw: null,
    }),
    /未返回任何有效的 assistant 消息/,
  );
});

function readTaskLogRecords(userDataPath: string, taskId: string) {
  return fs.readFileSync(buildTaskLogFilePath(userDataPath, taskId), "utf8")
    .trim()
    .split("\n")
    .map((line) => parseJson5<Record<string, unknown>>(line));
}

function createTransportRecoveryClient(messages: unknown[]) {
  const { client, cwd } = createClient();
  const typed = client as OpenCodeClient & {
    listSessionMessages: (cwd: string, sessionId: string, limit?: number) => Promise<unknown[]>;
  };
  typed.listSessionMessages = async () => messages;
  return { client, cwd };
}

for (const scenario of [
  {
    name: "recoverExecutionResultAfterTransportError 会恢复多级 assistant 回复",
    taskId: "task-transport-recovery-recovered",
    startedAt: "2026-04-27T07:33:41.201Z",
    messages: [
      {
        info: {
          id: "msg-user",
          role: "user",
          time: {
            created: Date.parse("2026-04-27T07:33:41.201Z"),
          },
        },
        parts: [
          { type: "text", text: "请继续挑战" },
        ],
      },
      {
        info: {
          id: "msg-placeholder",
          parentID: "msg-user",
          role: "assistant",
          time: {
            created: Date.parse("2026-04-27T07:33:41.214Z"),
          },
        },
        parts: [
          { type: "text", text: "我先继续核对现有论证。" },
        ],
      },
      {
        info: {
          id: "msg-tool-calls",
          parentID: "msg-placeholder",
          role: "assistant",
          finish: "tool-calls",
          time: {
            created: Date.parse("2026-04-27T07:38:10.000Z"),
            completed: Date.parse("2026-04-27T07:38:22.000Z"),
          },
        },
        parts: [
          { type: "text", text: "我继续读取代码和 RFC。" },
        ],
      },
      {
        info: {
          id: "msg-final",
          parentID: "msg-tool-calls",
          role: "assistant",
          finish: "stop",
          time: {
            created: Date.parse("2026-04-27T07:38:24.000Z"),
            completed: Date.parse("2026-04-27T07:38:40.000Z"),
          },
        },
        parts: [
          { type: "text", text: "最终挑战结论已补齐。" },
        ],
      },
    ],
    expected: {
      recovered: true,
      messageId: "msg-final",
      finalMessage: "最终挑战结论已补齐。",
    },
  },
  {
    name: "recoverExecutionResultAfterTransportError 不会跨到后续 user 子树恢复结果",
    taskId: "task-transport-recovery-cross-user-subtree",
    startedAt: "2026-04-27T07:33:41.201Z",
    timeoutMs: 1,
    messages: [
      {
        info: {
          id: "msg-user",
          role: "user",
          time: {
            created: Date.parse("2026-04-27T07:33:41.201Z"),
          },
        },
        parts: [
          { type: "text", text: "请继续挑战" },
        ],
      },
      {
        info: {
          id: "msg-placeholder",
          parentID: "msg-user",
          role: "assistant",
          time: {
            created: Date.parse("2026-04-27T07:33:41.214Z"),
          },
        },
        parts: [
          { type: "text", text: "我先继续核对现有论证。" },
        ],
      },
      {
        info: {
          id: "msg-followup-user",
          parentID: "msg-placeholder",
          role: "user",
          time: {
            created: Date.parse("2026-04-27T07:35:10.000Z"),
          },
        },
        parts: [
          { type: "text", text: "补充一个新问题" },
        ],
      },
      {
        info: {
          id: "msg-followup-final",
          parentID: "msg-followup-user",
          role: "assistant",
          finish: "stop",
          time: {
            created: Date.parse("2026-04-27T07:35:15.000Z"),
            completed: Date.parse("2026-04-27T07:35:20.000Z"),
          },
        },
        parts: [
          { type: "text", text: "这是后续 user 回合的结果。" },
        ],
      },
    ],
    expected: {
      recovered: false,
      logEvent: "opencode.transport_recovery_timed_out",
      recoveryState: "waiting-with-related-reply",
      relatedReplyCount: 1,
      latestRelatedMessageId: "msg-placeholder",
      latestRelatedParentMessageId: "msg-user",
    },
  },
  {
    name: "recoverExecutionResultAfterTransportError 没有正式回复时不能把 tool-calls 文本当成恢复结果",
    taskId: "task-transport-recovery-no-final",
    startedAt: "2026-04-27T04:34:10.422Z",
    timeoutMs: 1,
    messages: [
      {
        info: {
          id: "msg-user",
          role: "user",
          time: {
            created: Date.parse("2026-04-27T04:34:10.422Z"),
          },
        },
        parts: [
          { type: "text", text: "请给出讨论总结" },
        ],
      },
      {
        info: {
          id: "msg-tool-calls",
          parentID: "msg-user",
          role: "assistant",
          finish: "tool-calls",
          time: {
            created: Date.parse("2026-04-27T04:39:40.178Z"),
            completed: Date.parse("2026-04-27T04:39:48.072Z"),
          },
        },
        parts: [
          { type: "text", text: "我先继续读取证据。" },
        ],
      },
    ],
    expected: {
      recovered: false,
      logEvent: "opencode.transport_recovery_timed_out",
      recoveryState: "waiting-with-related-reply",
      relatedReplyCount: 1,
      latestRelatedMessageId: "msg-tool-calls",
      latestRelatedParentMessageId: "msg-user",
      latestRelatedFinish: "tool-calls",
    },
  },
]) {
  test(scenario.name, async () => {
    const userDataPath = createTempDir();
    initAppFileLogger(userDataPath);
    const { client, cwd } = createTransportRecoveryClient(scenario.messages);

    const recovered = await runWithTaskLogScope(scenario.taskId, () => withFastForwardedTimeouts(() => (
      scenario.timeoutMs === undefined
        ? client.recoverExecutionResultAfterTransportError(
            cwd,
            "session-1",
            scenario.startedAt,
            "fetch failed",
          )
        : client.recoverExecutionResultAfterTransportError(
            cwd,
            "session-1",
            scenario.startedAt,
            "fetch failed",
            scenario.timeoutMs,
          )
    )));

    if (scenario.expected.recovered) {
      assert.notEqual(recovered, null);
      assert.equal(recovered?.status, "completed");
      assert.equal(recovered?.messageId, scenario.expected.messageId);
      assert.equal(recovered?.finalMessage, scenario.expected.finalMessage);
      return;
    }

    assert.equal(recovered, null);
    const records = readTaskLogRecords(userDataPath, scenario.taskId);
    assert.deepEqual(records.map((record) => record["event"]), [
      "opencode.transport_recovery_started",
      scenario.expected.logEvent,
    ]);
    assert.equal(records[1]?.["recoveryState"], scenario.expected.recoveryState);
    assert.equal(records[1]?.["relatedReplyCount"], scenario.expected.relatedReplyCount);
    assert.equal(records[1]?.["latestRelatedMessageId"], scenario.expected.latestRelatedMessageId);
    assert.equal(records[1]?.["latestRelatedParentMessageId"], scenario.expected.latestRelatedParentMessageId);
    if ("latestRelatedFinish" in scenario.expected) {
      assert.equal(records[1]?.["latestRelatedFinish"], scenario.expected.latestRelatedFinish);
    }
  });
}

test("配置变更不会重启当前 cwd 的 serve，且会写入 OpenCode 配置", async () => {
  const { client, cwd } = createClient();

  let startServerCount = 0;
  Reflect.set(client, "startServer", async () => {
    startServerCount += 1;
    return {
      process: null,
      port: 43127,
    };
  });

  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string | undefined; url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      method: init?.method,
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    await client.setInjectedConfigContent(cwd, {
      agent: {
        BA: {
          mode: "primary",
          prompt: "你是 BA。",
        },
      },
    });
    await client.setInjectedConfigContent(cwd, {
      agent: {
        BA: {
          mode: "primary",
          prompt: "你是 BA。",
        },
        TaskReview: {
          mode: "primary",
          prompt: "你是 TaskReview。",
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(startServerCount, 0);
  assert.deepEqual(requests, [
    {
      method: "PATCH",
      url: "http://127.0.0.1:43127/global/config",
      body: {
        config: {
          agent: {
            BA: {
              mode: "primary",
              prompt: "你是 BA。",
            },
          },
        },
      },
    },
    {
      method: "PATCH",
      url: "http://127.0.0.1:43127/global/config",
      body: {
        config: {
          agent: {
            BA: {
              mode: "primary",
              prompt: "你是 BA。",
            },
            TaskReview: {
              mode: "primary",
              prompt: "你是 TaskReview。",
            },
          },
        },
      },
    },
  ]);
});

test("配置更新失败时会回滚缓存并抛错", async () => {
  const { client, cwd } = createClient();
  const typed = client as OpenCodeClient & {
    servers: Map<string, {
      cwd: string;
      serverHandle: Promise<{ process: null; port: number }> | null;
      eventPump: Promise<void> | null;
      injectedConfigContent: {
        agent: Record<string, unknown>;
      };
    }>;
  };

  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response("", { status: requestCount === 1 ? 500 : 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      client.setInjectedConfigContent(cwd, {
        agent: {
          BA: {
            mode: "primary",
            prompt: "你是 BA。",
          },
        },
      }),
      /OpenCode 配置更新失败: 500/,
    );
    assert.deepEqual(typed.servers.get(cwd)?.injectedConfigContent, {
      agent: {},
    });

    await client.setInjectedConfigContent(cwd, {
      agent: {
        BA: {
          mode: "primary",
          prompt: "你是 BA。",
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestCount, 2);
  assert.deepEqual(typed.servers.get(cwd)?.injectedConfigContent, {
    agent: {
      BA: {
        mode: "primary",
        prompt: "你是 BA。",
      },
    },
  });
});

test("同一 cwd 的配置更新会串行执行，最终以最后一次写入为准", async () => {
  const { client, cwd } = createClient();
  const typed = client as OpenCodeClient & {
    servers: Map<string, {
      cwd: string;
      serverHandle: Promise<{ process: null; port: number }> | null;
      eventPump: Promise<void> | null;
      injectedConfigContent: {
        agent: Record<string, unknown>;
      };
    }>;
  };

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let releaseFirstFetch: (() => void) | undefined;
  const firstFetch = new Promise<void>((resolve) => {
    releaseFirstFetch = resolve;
  });
  const appliedConfigs: unknown[] = [];
  globalThis.fetch = (async (_input, init) => {
    fetchCount += 1;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (fetchCount === 1) {
      await firstFetch;
    }
    appliedConfigs.push(body?.config ?? null);
    return new Response("", { status: 200 });
  }) as typeof fetch;

  const firstConfig = {
    agent: {
      BA: {
        mode: "primary" as const,
        prompt: "你是 BA。",
      },
    },
  };
  const secondConfig = {
    agent: {
      BA: {
        mode: "primary" as const,
        prompt: "你是 BA。",
      },
      TaskReview: {
        mode: "primary" as const,
        prompt: "你是 TaskReview。",
      },
    },
  };

  try {
    const firstPromise = client.setInjectedConfigContent(cwd, firstConfig);
    const secondPromise = client.setInjectedConfigContent(cwd, secondConfig);
    await Promise.resolve();
    assert.equal(fetchCount, 1);
    releaseFirstFetch?.();
    await Promise.all([firstPromise, secondPromise]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCount, 2);
  assert.deepEqual(appliedConfigs, [firstConfig, secondConfig]);
  assert.deepEqual(typed.servers.get(cwd)?.injectedConfigContent, secondConfig);
});

test("同一 cwd 只会复用一个 serve 端口", async () => {
  const client = new OpenCodeClient() as OpenCodeClient & {
    startServer: (cwd: string) => Promise<{ process: null; port: number }>;
    request: (pathname: TestRequestPathname, options: TestRequestOptions) => TestRequestResult;
  };
  const cwd = createTempDir();
  let startServerCount = 0;

  client.startServer = async () => {
    startServerCount += 1;
    return {
      process: null,
      port: 43127,
    };
  };

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrls.push(String(input));
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    await client.request("/session", {
      method: "GET",
      cwd,
    });
    await client.request("/session", {
      method: "GET",
      cwd,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1:43127/session",
    "http://127.0.0.1:43127/session",
  ]);
  assert.equal(startServerCount, 1);
});

test("不同 cwd 会各自启动独立的 serve 端口", async () => {
  const client = new OpenCodeClient() as OpenCodeClient & {
    startServer: (cwd: string) => Promise<{ process: null; port: number }>;
    request: (pathname: TestRequestPathname, options: TestRequestOptions) => TestRequestResult;
  };
  const firstCwd = createTempDir();
  const secondCwd = createTempDir();
  let startServerCount = 0;

  client.startServer = async () => {
    startServerCount += 1;
    return {
      process: null,
      port: 43127 + startServerCount,
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;

  try {
    await client.request("/session", { method: "GET", cwd: firstCwd });
    await client.request("/session", { method: "GET", cwd: secondCwd });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(startServerCount, 2);
});

test("同一 cwd 下多个订阅者会共享一个 event pump 并同时收到事件", async () => {
  const client = new OpenCodeClient();
  const cwd = createTempDir();
  let startEventPumpCount = 0;
  let emitEvent: (event: Record<string, unknown>) => void = () => undefined;
  let releasePump: () => void = () => undefined;
  let notifyFirstPumpReady: () => void = () => undefined;
  const firstPumpReady = new Promise<void>((resolve) => {
    notifyFirstPumpReady = resolve;
  });

  Reflect.set(client, "startServer", async () => ({
    process: null,
    port: 43127,
  }));
  Reflect.set(client, "startEventPump", async (onEvent: (event: Record<string, unknown>) => void) => {
    startEventPumpCount += 1;
    return new Promise<void>((resolve) => {
      emitEvent = onEvent;
      releasePump = resolve;
      notifyFirstPumpReady();
    });
  });

  const firstEvents: Array<Record<string, unknown>> = [];
  const secondEvents: Array<Record<string, unknown>> = [];
  const firstConnect = client.connectEvents(cwd, (event) => {
    firstEvents.push(event);
  });
  await firstPumpReady;
  const secondConnect = client.connectEvents(cwd, (event) => {
    secondEvents.push(event);
  });

  emitEvent({ type: "session.idle", properties: { sessionID: "session-1" } });
  releasePump();
  await firstConnect;
  await secondConnect;

  assert.equal(startEventPumpCount, 1);
  assert.deepEqual(firstEvents, [{ type: "session.idle", properties: { sessionID: "session-1" } }]);
  assert.deepEqual(secondEvents, [{ type: "session.idle", properties: { sessionID: "session-1" } }]);
});
test("getAttachBaseUrl 会启动当前 task 自己的 serve", async () => {
  const cwd = createTempDir();
  const client = new OpenCodeClient() as OpenCodeClient & {
    startServer: (cwd: string) => Promise<{ process: null; port: number }>;
  };

  let startServerCalled = false;
  client.startServer = async () => {
    startServerCalled = true;
    return {
      process: null,
      port: 43128,
    };
  };

  const baseUrl = await client.getAttachBaseUrl(cwd);

  assert.equal(baseUrl, "http://127.0.0.1:43128");
  assert.equal(startServerCalled, true);
});

test("buildRuntimeSnapshot 会保留同一条消息内 thinking 和 tool 的原始顺序", () => {
  const { client } = createClient();
  const typed = client as OpenCodeClient & {
    buildRuntimeSnapshot: (sessionId: string, messages: unknown[]) => {
      activities: Array<{ kind: string; detail: string; label: string }>;
    };
  };

  const snapshot = typed.buildRuntimeSnapshot("session-1", [
    {
      id: "msg-1",
      role: "assistant",
      createdAt: "2026-04-21T12:52:26.000Z",
      completedAt: "2026-04-21T12:52:26.000Z",
      parts: [
        {
          type: "reasoning",
          text: "Determining project structure",
        },
        {
          type: "tool-call",
          tool: { id: "glob" },
          input: {
            pattern: "**/*",
            path: "/Users/liyw/code/empty",
          },
        },
      ],
    },
  ]);

  assert.deepEqual(
    snapshot.activities.map((activity) => ({
      kind: activity.kind,
      label: activity.label,
      detail: activity.detail,
    })),
    [
      {
        kind: "thinking",
        label: "Determining project structure",
        detail: "Determining project structure",
      },
      {
        kind: "tool",
        label: "glob",
        detail: "参数: pattern=**/*, path=/Users/liyw/code/empty",
      },
    ],
  );
});

test("buildRuntimeSnapshot 会在同一条 OpenCode 工具消息超过 4 个 part 时保留 thinking", () => {
  const { client } = createClient();
  const typed = client as OpenCodeClient & {
    buildRuntimeSnapshot: (sessionId: string, messages: unknown[]) => {
      activities: Array<{ kind: string; detail: string; label: string }>;
    };
  };

  const snapshot = typed.buildRuntimeSnapshot("session-1", [
    {
      info: {
        id: "msg-tool-round",
        role: "assistant",
        time: {
          created: 1776960271926,
          completed: 1776960280541,
        },
      },
      parts: [
        { type: "step-start" },
        {
          type: "reasoning",
          text: "**Prioritizing instructions**\n\nI need to inspect the repository before returning a finding.",
        },
        {
          type: "tool",
          tool: "glob",
          state: {
            input: { pattern: "**/*Http2*.java", path: "code/tomcat-vul" },
          },
        },
        {
          type: "tool",
          tool: "glob",
          state: {
            input: { pattern: "**/*Authority*.java", path: "code/tomcat-vul" },
          },
        },
        {
          type: "tool",
          tool: "glob",
          state: {
            input: { pattern: "**/*Host*.java", path: "code/tomcat-vul" },
          },
        },
        { type: "step-finish", reason: "tool-calls" },
      ],
    },
  ]);

  assert.deepEqual(
    snapshot.activities.map((activity) => ({
      kind: activity.kind,
      label: activity.label,
      detail: activity.detail,
    })),
    [
      {
        kind: "thinking",
        label: "**Prioritizing instructions** I need to inspect…",
        detail: "**Prioritizing instructions**\n\nI need to inspect the repository before returning a finding.",
      },
      {
        kind: "tool",
        label: "glob",
        detail: "参数: pattern=**/*Http2*.java, path=code/tomcat-vul",
      },
      {
        kind: "tool",
        label: "glob",
        detail: "参数: pattern=**/*Authority*.java, path=code/tomcat-vul",
      },
      {
        kind: "tool",
        label: "glob",
        detail: "参数: pattern=**/*Host*.java, path=code/tomcat-vul",
      },
    ],
  );
});

test("buildRuntimeSnapshot 不会因为后续活动超过全局显示窗口而丢掉早期 OpenCode thinking", () => {
  const { client } = createClient();
  const typed = client as OpenCodeClient & {
    buildRuntimeSnapshot: (sessionId: string, messages: unknown[]) => {
      activities: Array<{ kind: string; detail: string; label: string }>;
    };
  };
  const laterToolMessages = Array.from({ length: 25 }, (_, index) => ({
    info: {
      id: `msg-later-${index}`,
      role: "assistant",
      time: {
        created: 1776960281000 + index,
        completed: 1776960281000 + index,
      },
    },
    parts: [
      {
        type: "tool",
        tool: "grep",
        state: {
          input: { pattern: `later-${index}` },
        },
      },
    ],
  }));

  const snapshot = typed.buildRuntimeSnapshot("session-1", [
    {
      info: {
        id: "msg-first-thinking",
        role: "assistant",
        time: {
          created: 1776960271926,
          completed: 1776960280541,
        },
      },
      parts: [
        {
          type: "reasoning",
          text: "**Prioritizing instructions**\n\nI need to inspect the repository before returning a finding.",
        },
      ],
    },
    ...laterToolMessages,
  ]);

  assert.equal(
    snapshot.activities.some((activity) => activity.detail.includes("Prioritizing instructions")),
    true,
  );
});

test("buildRuntimeSnapshot 在工具参数形似 JSON5 但非法时回退为原始字符串摘要", () => {
  const { client } = createClient();
  const typed = client as OpenCodeClient & {
    buildRuntimeSnapshot: (sessionId: string, messages: unknown[]) => {
      activities: Array<{ kind: string; detail: string; label: string }>;
    };
  };

  const snapshot = typed.buildRuntimeSnapshot("session-1", [
    {
      id: "msg-1",
      role: "assistant",
      createdAt: "2026-04-21T12:52:26.000Z",
      completedAt: "2026-04-21T12:52:26.000Z",
      parts: [
        {
          type: "tool-call",
          tool: { id: "glob" },
          input: "{bad}",
        },
      ],
    },
  ]);

  assert.equal(snapshot.activities.length, 1);
  assert.equal(snapshot.activities[0]?.kind, "tool");
  assert.equal(snapshot.activities[0]?.label, "glob");
  assert.equal(snapshot.activities[0]?.detail, "参数: {bad}");
  assert.equal(snapshot.activities[0]?.timestamp, "2026-04-21T12:52:26.000Z");
});

test("buildRuntimeSnapshot 会优先使用 tool state.input 作为更完整的参数来源", () => {
  const { client } = createClient();
  const typed = client as OpenCodeClient & {
    buildRuntimeSnapshot: (sessionId: string, messages: unknown[]) => OpenCodeSessionRuntime;
  };

  const snapshot = typed.buildRuntimeSnapshot("session-1", [
    {
      id: "msg-1",
      role: "assistant",
      createdAt: "2026-04-21T12:52:26.000Z",
      completedAt: "2026-04-21T12:52:27.000Z",
      parts: [
        {
          type: "tool",
          tool: "read",
          input: "placeholder",
          state: {
            input: {
              filePath: "/tmp/demo.txt",
            },
          },
        },
      ],
    },
  ]);

  assert.equal(snapshot.activities.length, 1);
  assert.equal(snapshot.activities[0]?.kind, "tool");
  assert.equal(snapshot.activities[0]?.detail, "参数: filePath=/tmp/demo.txt");
  assert.equal(snapshot.activities[0]?.detailState, "complete");
  assert.equal(snapshot.activities[0]?.detailParseMode, "structured");
  assert.equal(snapshot.activities[0]?.detailPayloadKeyCount, 1);
  assert.equal(snapshot.activities[0]?.detailHasPlaceholderValue, false);
});

test("startEventPump 在单条 SSE 数据非法时保留原始载荷并继续消费后续事件", async () => {
  const { client, cwd } = createClient();
  const typed = client as unknown as {
    startEventPump: (
      onEvent: (event: Record<string, unknown>) => void,
      server: { process: null; port: number },
      cwd: string,
    ) => Promise<void>;
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        "data: not-json\n\ndata: {type:'session.idle',properties:{sessionID:'session-1'}}\n\n",
      ));
      controller.close();
    },
  }), { status: 200 })) as typeof fetch;

  const events: Array<Record<string, unknown>> = [];
  try {
    await typed.startEventPump((event: Record<string, unknown>) => {
      events.push(event);
    }, { process: null, port: 43127 }, cwd);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(events, [
    { payload: { raw: "not-json" } },
    { type: "session.idle", properties: { sessionID: "session-1" } },
  ]);
});
