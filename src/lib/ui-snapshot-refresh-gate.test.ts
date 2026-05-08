import test from "node:test";
import assert from "node:assert/strict";

import {
  isSemanticallyOlderUiSnapshot,
  resolveUiSnapshotQueryData,
} from "./ui-snapshot-refresh-gate";
import {
  buildTopologyNodeRecords,
  type MessageRecord,
  type UiSnapshotPayload,
} from "@shared/types";

function createSystemMessage(id: string, sender: "system" | "BA", content: string, timestamp: string): MessageRecord {
  if (sender === "system") {
    return {
      id,
      taskId: "task-1",
      sender: "system",
      content,
      timestamp,
      kind: "system-message",
    };
  }

  return {
    id,
    taskId: "task-1",
    sender: "BA",
    content,
    timestamp,
    kind: "agent-final",
    runCount: 1,
    status: "completed",
    routingKind: "default",
    responseNote: "",
    rawResponse: content,
  };
}

function createUiSnapshotPayload(input: {
  baStatus: "idle" | "running" | "completed";
  unitTestStatus: "idle" | "running" | "completed";
  buildStatus?: "idle" | "running" | "completed";
  messageCount?: number;
  taskStatus?: "running" | "finished" | "failed";
  completedAt?: string | null;
  baRunCount?: number;
  unitTestRunCount?: number;
  buildRunCount?: number;
}): UiSnapshotPayload {
  const buildStatus = input.buildStatus ?? "idle";
  const messageCount = input.messageCount ?? 0;
  const baRunCount = input.baRunCount ?? (input.baStatus === "idle" ? 0 : 1);
  const unitTestRunCount = input.unitTestRunCount ?? (input.unitTestStatus === "idle" ? 0 : 1);
  const buildRunCount = input.buildRunCount ?? (buildStatus === "idle" ? 0 : 1);
  return {
    workspace: null,
    launchTaskId: "task-1",
    launchCwd: "/Users/liyw/code/empty",
    taskLogFilePath: "/Users/liyw/Library/Application Support/agent-team/logs/tasks/task-1.log",
    taskUrl: "http://localhost:4310/?taskId=task-1",
    task: {
      task: {
        id: "task-1",
        title: "demo",
        status: input.taskStatus ?? "running",
        cwd: "/Users/liyw/code/empty",
        opencodeSessionId: null,
        agentCount: 2,
        createdAt: "2026-04-21T03:22:09.404Z",
        completedAt: input.completedAt ?? null,
        initializedAt: "2026-04-21T03:22:11.615Z",
      },
      agents: [
        {
          taskId: "task-1",
          id: "BA",
          opencodeSessionId: null,
          opencodeAttachBaseUrl: null,
          status: input.baStatus,
          runCount: baRunCount,
        },
        {
          taskId: "task-1",
          id: "UnitTest",
          opencodeSessionId: null,
          opencodeAttachBaseUrl: null,
          status: input.unitTestStatus,
          runCount: unitTestRunCount,
        },
        {
          taskId: "task-1",
          id: "Build",
          opencodeSessionId: null,
          opencodeAttachBaseUrl: null,
          status: buildStatus,
          runCount: buildRunCount,
        },
      ],
      messages: Array.from({ length: messageCount }).map((value, index) => {
        void value;
        return createSystemMessage(
          `message-${index + 1}`,
          index === 0 ? "system" : "BA",
          `message-${index + 1}`,
          `2026-04-21T03:22:${String(index).padStart(2, "0")}.000Z`,
        );
      }),
      topology: {
        nodes: ["BA", "Build", "UnitTest"],
        edges: [],
        nodeRecords: buildTopologyNodeRecords({
          nodes: ["BA", "Build", "UnitTest"],
          spawnNodeIds: new Set(),
          templateNameByNodeId: new Map(),
          initialMessageRoutingByNodeId: new Map(),
          spawnRuleIdByNodeId: new Map(),
          spawnEnabledNodeIds: new Set(),
          promptByNodeId: new Map(),
          writableNodeIds: new Set(),
        }),
      },
    },
  };
}

test("语义更旧的 ui snapshot 必须被识别出来，避免把 UnitTest 运行中回滚成 BA 运行中", () => {
  const newerPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "running",
  });
  const olderPayload = createUiSnapshotPayload({
    baStatus: "running",
    unitTestStatus: "idle",
  });

  assert.equal(isSemanticallyOlderUiSnapshot(newerPayload, olderPayload), true);
});

test("缓存里已有较新 snapshot 时，语义更旧的结果必须被拒绝", () => {
  const acceptedFresh = createUiSnapshotPayload({
    baStatus: "completed",
    buildStatus: "running",
    unitTestStatus: "idle",
    messageCount: 3,
  });
  const olderPayload = createUiSnapshotPayload({
    baStatus: "running",
    buildStatus: "idle",
    unitTestStatus: "idle",
    messageCount: 2,
  });

  assert.equal(resolveUiSnapshotQueryData(acceptedFresh, olderPayload), acceptedFresh);
});

test("合法 reopen 的 running snapshot 仍然应当被接受", () => {
  const finishedPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "idle",
    taskStatus: "finished",
    completedAt: "2026-04-21T03:22:20.000Z",
    messageCount: 2,
  });
  const reopenedRunning = createUiSnapshotPayload({
    baStatus: "running",
    unitTestStatus: "idle",
    taskStatus: "running",
    completedAt: null,
    messageCount: 3,
    baRunCount: 2,
  });

  assert.equal(isSemanticallyOlderUiSnapshot(finishedPayload, reopenedRunning), false);
  assert.equal(resolveUiSnapshotQueryData(finishedPayload, reopenedRunning), reopenedRunning);
});

test("语义上更新的 snapshot 必须覆盖旧缓存，避免群聊停留在旧快照", () => {
  const previousPayload = createUiSnapshotPayload({
    baStatus: "running",
    unitTestStatus: "idle",
    buildStatus: "idle",
    messageCount: 1,
  });
  const nextPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "running",
    buildStatus: "idle",
    messageCount: 3,
  });

  const acceptedPayload = resolveUiSnapshotQueryData(previousPayload, nextPayload);
  assert.equal(acceptedPayload, nextPayload);
  assert.equal(acceptedPayload.task?.messages.length, 3);
  assert.equal(
    acceptedPayload.task?.agents.find((agent) => agent.id === "UnitTest")?.status,
    "running",
  );
});

test("消息条数增加时，查询缓存应接受新 snapshot", () => {
  const previousPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "idle",
    buildStatus: "idle",
    messageCount: 1,
  });
  const nextPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "idle",
    buildStatus: "idle",
    messageCount: 2,
  });

  assert.equal(resolveUiSnapshotQueryData(previousPayload, nextPayload), nextPayload);
  assert.equal(resolveUiSnapshotQueryData(nextPayload, previousPayload), nextPayload);
});

test("补齐 session 与 attach 的 snapshot 必须被视为语义更新并接受", () => {
  const previousPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "idle",
    messageCount: 2,
  });

  const nextPayloadWithAttach = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "idle",
    messageCount: 2,
  });
  const nextBaAgent = nextPayloadWithAttach.task?.agents.find((agent) => agent.id === "BA");
  assert.ok(nextBaAgent, "应存在 BA agent 测试夹具");
  nextBaAgent.opencodeSessionId = "session-ba-2";
  nextBaAgent.opencodeAttachBaseUrl = "http://localhost:4310";

  const acceptedPayload = resolveUiSnapshotQueryData(previousPayload, nextPayloadWithAttach);
  assert.equal(
    acceptedPayload.task?.agents.find((agent) => agent.id === "BA")?.opencodeSessionId,
    "session-ba-2",
  );
  assert.equal(
    acceptedPayload.task?.agents.find((agent) => agent.id === "BA")?.opencodeAttachBaseUrl,
    "http://localhost:4310",
  );
});

test("仅把旧的非空 session 与 attach 换成另一组非空值时，不应误判为语义回退", () => {
  const previousPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "idle",
    messageCount: 2,
  });
  const previousBaAgent = previousPayload.task?.agents.find((agent) => agent.id === "BA");
  assert.ok(previousBaAgent, "应存在 BA agent 测试夹具");
  previousBaAgent.opencodeSessionId = "session-ba-1";
  previousBaAgent.opencodeAttachBaseUrl = "http://localhost:4310/old";

  const nextPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "idle",
    messageCount: 2,
  });
  const nextBaAgent = nextPayload.task?.agents.find((agent) => agent.id === "BA");
  assert.ok(nextBaAgent, "应存在 BA agent 测试夹具");
  nextBaAgent.opencodeSessionId = "session-ba-2";
  nextBaAgent.opencodeAttachBaseUrl = "http://localhost:4310/new";

  assert.equal(isSemanticallyOlderUiSnapshot(previousPayload, nextPayload), false);
  assert.equal(resolveUiSnapshotQueryData(previousPayload, nextPayload), previousPayload);
});

test("即使补齐了 attach，只要消息数发生回退也必须拒绝", () => {
  const previousPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "running",
    messageCount: 3,
  });

  const olderPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "idle",
    messageCount: 2,
  });
  const olderBaAgent = olderPayload.task?.agents.find((agent) => agent.id === "BA");
  assert.ok(olderBaAgent, "应存在 BA agent 测试夹具");
  olderBaAgent.opencodeSessionId = "session-ba-2";
  olderBaAgent.opencodeAttachBaseUrl = "http://localhost:4310";

  assert.equal(resolveUiSnapshotQueryData(previousPayload, olderPayload), previousPayload);
});

test("首次带回新的 runtime agent 时，也必须被视为语义前进并接受", () => {
  const previousPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "idle",
    messageCount: 1,
  });

  const nextPayload = createUiSnapshotPayload({
    baStatus: "completed",
    unitTestStatus: "idle",
    messageCount: 1,
  });
  nextPayload.task?.agents.push({
    id: "漏洞挑战-2",
    taskId: "task-1",
    opencodeSessionId: "session-challenge-2",
    opencodeAttachBaseUrl: "http://localhost:4310",
    status: "running",
    runCount: 1,
  });

  const acceptedPayload = resolveUiSnapshotQueryData(previousPayload, nextPayload);
  assert.equal(
    acceptedPayload.task?.agents.some((agent) => agent.id === "漏洞挑战-2"),
    true,
  );
});
