import test from "node:test";
import assert from "node:assert/strict";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import type { AgentRuntimeSnapshot, TaskSnapshot, UiSnapshotPayload } from "@shared/types";

import App from "./App";

type GlobalPatchKey =
  | "window"
  | "document"
  | "navigator"
  | "HTMLElement"
  | "HTMLDivElement"
  | "HTMLButtonElement"
  | "HTMLTextAreaElement"
  | "Node"
  | "Event"
  | "MouseEvent"
  | "KeyboardEvent"
  | "ResizeObserver"
  | "requestAnimationFrame"
  | "cancelAnimationFrame"
  | "setInterval"
  | "clearInterval"
  | "getComputedStyle"
  | "fetch"
  | "EventSource"
  | "IS_REACT_ACT_ENVIRONMENT";

type GlobalPatch = {
  existed: boolean;
  value: unknown;
};

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

class MockEventSource {
  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor(_url: string) {}

  close() {}
}

const TASK_ID = "task-app-runtime-refresh";
const WORKSPACE_CWD = "/tmp/agent-team-app-runtime-refresh";

type SessionFixtureState =
  | {
      kind: "present";
      sessionId: string;
    }
  | {
      kind: "absent";
    };

function createUiSnapshot(input: {
  agentSession: SessionFixtureState;
  messages: TaskSnapshot["messages"];
}): UiSnapshotPayload {
  return {
    workspace: {
      cwd: WORKSPACE_CWD,
      name: "app-runtime-refresh",
      agents: [
        {
          id: "漏洞挑战-1",
          prompt: "挑战输入",
          isWritable: false,
        },
      ],
      topology: {
        nodes: ["漏洞挑战-1"],
        edges: [],
      },
      messages: [],
      tasks: [],
    },
    task: {
      task: {
        id: TASK_ID,
        title: "runtime refresh",
        status: "running",
        cwd: WORKSPACE_CWD,
        opencodeSessionId: null,
        agentCount: 1,
        createdAt: "2026-04-29T10:00:00.000Z",
        completedAt: null,
        initializedAt: "2026-04-29T10:00:00.000Z",
      },
      agents: [
        {
          id: "漏洞挑战-1",
          taskId: TASK_ID,
          opencodeSessionId: input.agentSession.kind === "present" ? input.agentSession.sessionId : null,
          opencodeAttachBaseUrl: input.agentSession.kind === "present" ? "http://localhost:4310" : null,
          status: "completed",
          runCount: 1,
        },
      ],
      messages: input.messages,
      topology: {
        nodes: ["漏洞挑战-1"],
        edges: [],
      },
    },
    launchTaskId: TASK_ID,
    launchCwd: WORKSPACE_CWD,
    taskLogFilePath: null,
    taskUrl: "http://localhost:4310/?taskId=task-app-runtime-refresh",
  };
}

function createRuntimeSnapshot(): AgentRuntimeSnapshot[] {
  return [
    {
      taskId: TASK_ID,
      agentId: "漏洞挑战-1",
      sessionId: "session-challenge-1",
      status: "completed",
      runtimeStatus: "completed",
      messageCount: 1,
      updatedAt: "2026-04-29T10:00:02.000Z",
      headline: "挑战已完成",
      activeToolNames: [],
      activities: [],
    },
  ];
}

function createAgentFinalMessage() {
  return [
    {
      id: "challenge-final-1",
      taskId: TASK_ID,
      sender: "漏洞挑战-1",
      content: "挑战结论：这里的消息应当在 runtime 完成后自动出现。",
      timestamp: "2026-04-29T10:00:02.000Z",
      kind: "agent-final" as const,
      status: "completed" as const,
      routingKind: "default" as const,
      responseNote: "",
      rawResponse: "挑战结论：这里的消息应当在 runtime 完成后自动出现。",
    },
  ];
}

function setupDom(fetchImpl: typeof fetch) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: `http://localhost/?taskId=${TASK_ID}`,
    pretendToBeVisual: true,
  });
  const previousValues = new Map<GlobalPatchKey, GlobalPatch>();

  function setGlobal(key: GlobalPatchKey, value: unknown) {
    previousValues.set(key, {
      existed: key in globalThis,
      value: (globalThis as Record<string, unknown>)[key],
    });
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  setGlobal("window", dom.window);
  setGlobal("document", dom.window.document);
  setGlobal("navigator", dom.window.navigator);
  setGlobal("HTMLElement", dom.window.HTMLElement);
  setGlobal("HTMLDivElement", dom.window.HTMLDivElement);
  setGlobal("HTMLButtonElement", dom.window.HTMLButtonElement);
  setGlobal("HTMLTextAreaElement", dom.window.HTMLTextAreaElement);
  setGlobal("Node", dom.window.Node);
  setGlobal("Event", dom.window.Event);
  setGlobal("MouseEvent", dom.window.MouseEvent);
  setGlobal("KeyboardEvent", dom.window.KeyboardEvent);
  setGlobal("ResizeObserver", MockResizeObserver);
  setGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(dom.window.performance.now()), 0));
  setGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  setGlobal("setInterval", (_handler: TimerHandler, _timeout?: number, ..._args: unknown[]) => 1);
  setGlobal("clearInterval", (_id: ReturnType<typeof setInterval>) => undefined);
  setGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  setGlobal("fetch", fetchImpl);
  setGlobal("EventSource", MockEventSource);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  return {
    dom,
    cleanup() {
      for (const [key, patch] of previousValues) {
        if (patch.existed) {
          Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: patch.value,
          });
          continue;
        }
        delete (globalThis as Record<string, unknown>)[key];
      }
      dom.window.close();
    },
  };
}

async function waitForAssertion(assertion: () => void) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
  throw lastError;
}

test("App 会在同一轮 runtime 发现落后后持续补拉 uiSnapshot，直到消息与 attach 无需手动刷新即可出现", async () => {
  let uiSnapshotRequestCount = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (requestUrl.includes("/api/ui-snapshot")) {
      uiSnapshotRequestCount += 1;
      const payload = uiSnapshotRequestCount <= 2
        ? createUiSnapshot({
            agentSession: {
              kind: "absent",
            },
            messages: [],
          })
        : createUiSnapshot({
            agentSession: {
              kind: "present",
              sessionId: "session-challenge-1",
            },
            messages: createAgentFinalMessage(),
          });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    if (requestUrl.includes("/api/tasks/runtime")) {
      return new Response(JSON.stringify(createRuntimeSnapshot()), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    throw new Error(`unexpected request: ${requestUrl}`);
  };

  const { cleanup } = setupDom(fetchImpl);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<App />);
    });

    await waitForAssertion(() => {
      assert.match(document.body.textContent ?? "", /挑战结论：这里的消息应当在 runtime 完成后自动出现。/u);
      const attachButton = document.querySelector('button[aria-label="打开 漏洞挑战-1 的 attach 终端"]');
      assert.ok(attachButton instanceof HTMLButtonElement, "应显示漏洞挑战-1 的 attach 按钮");
      assert.equal(attachButton.disabled, false);
    });

    assert.equal(uiSnapshotRequestCount, 3, "应在同一轮发现落后后连续补拉到第三次才追平，而不是等待下一轮 runtime 轮询");
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanup();
  }
});
