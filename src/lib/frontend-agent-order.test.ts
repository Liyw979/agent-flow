import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAvailableAgentNamesForFrontend,
  orderAgentsForFrontend,
  resolveDefaultSelectedAgentIdForFrontend,
} from "./frontend-agent-order";

test("orderAgentsForFrontend 会严格按 JSON topology.nodes 排序成员", () => {
  const ordered = orderAgentsForFrontend(
    [
      { name: "Build", prompt: "" },
      { name: "TaskReview", prompt: "" },
      { name: "BA", prompt: "" },
    ],
    {
      nodes: ["BA", "Build", "TaskReview"],
    },
  );

  assert.deepEqual(ordered.map((agent) => agent.name), ["BA", "Build", "TaskReview"]);
});

test("buildAvailableAgentNamesForFrontend 会按 JSON topology.nodes 输出可 @ 的成员顺序", () => {
  const available = buildAvailableAgentNamesForFrontend(
    [
      { name: "Build", prompt: "" },
      { name: "TaskReview", prompt: "" },
      { name: "BA", prompt: "" },
    ],
    {
      nodes: ["BA", "Build", "TaskReview"],
    },
  );

  assert.deepEqual(available, ["BA", "Build", "TaskReview"]);
});

test("resolveDefaultSelectedAgentIdForFrontend 会回到 JSON 中的第一个 agent，而不是 workspace.agents 的第一个", () => {
  const selected = resolveDefaultSelectedAgentIdForFrontend({
    selectedAgentId: null,
    workspaceAgents: [
      { name: "Build", prompt: "" },
      { name: "TaskReview", prompt: "" },
      { name: "BA", prompt: "" },
    ],
    taskAgents: [
      { id: "task-1:Build", taskId: "task-1", name: "Build", opencodeSessionId: null, opencodeAttachBaseUrl: null, status: "running", runCount: 1 },
      { id: "task-1:TaskReview", taskId: "task-1", name: "TaskReview", opencodeSessionId: null, opencodeAttachBaseUrl: null, status: "idle", runCount: 0 },
      { id: "task-1:BA", taskId: "task-1", name: "BA", opencodeSessionId: null, opencodeAttachBaseUrl: null, status: "completed", runCount: 1 },
    ],
    topology: {
      nodes: ["BA", "Build", "TaskReview"],
    },
  });

  assert.equal(selected, "BA");
});
