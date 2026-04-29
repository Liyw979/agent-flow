import test from "node:test";
import assert from "node:assert/strict";

import type { AgentRuntimeSnapshot, TaskSnapshot } from "@shared/types";

import { shouldRefreshUiSnapshotFromRuntimeGap } from "./runtime-ui-refresh";

type SessionFixtureState =
  | {
      kind: "present";
      sessionId: string;
    }
  | {
      kind: "absent";
    };

function createTaskSnapshot(input: {
  session: SessionFixtureState;
  status: TaskSnapshot["agents"][number]["status"];
  messageTimestamp: string;
}): TaskSnapshot {
  return {
    task: {
      id: "task-1",
      title: "runtime gap",
      status: "running",
      cwd: "/tmp/runtime-gap",
      opencodeSessionId: null,
      agentCount: 1,
      createdAt: "2026-04-29T10:00:00.000Z",
      completedAt: null,
      initializedAt: "2026-04-29T10:00:00.000Z",
    },
    agents: [
      {
        id: "Build",
        taskId: "task-1",
        opencodeSessionId: input.session.kind === "present" ? input.session.sessionId : null,
        opencodeAttachBaseUrl: input.session.kind === "present" ? "http://localhost:4310" : null,
        status: input.status,
        runCount: 1,
      },
    ],
    messages: [
      {
        id: "build-final-1",
        taskId: "task-1",
        sender: "Build",
        content: "Build 输出",
        timestamp: input.messageTimestamp,
        kind: "agent-final",
        status: "completed",
        routingKind: "default",
        responseNote: "",
        rawResponse: "Build 输出",
      },
    ],
    topology: {
      nodes: ["Build"],
      edges: [],
    },
  };
}

function createRuntimeSnapshot(overrides: Partial<AgentRuntimeSnapshot>): AgentRuntimeSnapshot {
  return {
    taskId: "task-1",
    agentId: "Build",
    sessionId: "session-build-1",
    status: "completed",
    runtimeStatus: "completed",
    messageCount: 1,
    updatedAt: "2026-04-29T10:00:02.000Z",
    headline: "Build 已完成",
    activeToolNames: [],
    activities: [],
    ...overrides,
  };
}

test("runtime session 领先于 task snapshot 时应继续刷新 ui snapshot", () => {
  assert.equal(shouldRefreshUiSnapshotFromRuntimeGap({
    task: createTaskSnapshot({
      session: {
        kind: "absent",
      },
      status: "completed",
      messageTimestamp: "2026-04-29T10:00:02.000Z",
    }),
    runtimeSnapshots: {
      Build: createRuntimeSnapshot({}),
    },
  }), true);
});

test("runtime 已结束但最新消息时间戳仍领先于 uiSnapshot 时应继续刷新", () => {
  assert.equal(shouldRefreshUiSnapshotFromRuntimeGap({
    task: createTaskSnapshot({
      session: {
        kind: "present",
        sessionId: "session-build-1",
      },
      status: "completed",
      messageTimestamp: "2026-04-29T10:00:01.000Z",
    }),
    runtimeSnapshots: {
      Build: createRuntimeSnapshot({
        updatedAt: "2026-04-29T10:00:02.000Z",
      }),
    },
  }), true);
});

test("task snapshot 已追平 runtime 的 session、状态与消息时间后不再额外刷新", () => {
  assert.equal(shouldRefreshUiSnapshotFromRuntimeGap({
    task: createTaskSnapshot({
      session: {
        kind: "present",
        sessionId: "session-build-1",
      },
      status: "completed",
      messageTimestamp: "2026-04-29T10:00:02.000Z",
    }),
    runtimeSnapshots: {
      Build: createRuntimeSnapshot({}),
    },
  }), false);
});

test("状态对齐只以 runtimeStatus 为准，不会被 runtime 的辅助 status 字段干扰", () => {
  assert.equal(shouldRefreshUiSnapshotFromRuntimeGap({
    task: createTaskSnapshot({
      session: {
        kind: "present",
        sessionId: "session-build-1",
      },
      status: "completed",
      messageTimestamp: "2026-04-29T10:00:02.000Z",
    }),
    runtimeSnapshots: {
      Build: createRuntimeSnapshot({
        status: "running",
        runtimeStatus: "completed",
      }),
    },
  }), false);
});
