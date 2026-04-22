import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultTopology,
  getActionRequiredEdgeLoopLimit,
  isReviewAgentInTopology,
  type TopologyAgentSeed,
  type TopologyRecord,
  usesOpenCodeBuiltinPrompt,
} from "./types";

test("默认拓扑只生成首节点到次节点的 handoff 边", () => {
  const agents: TopologyAgentSeed[] = [
    { name: "BA" },
    { name: "Build" },
    { name: "TaskReview" },
  ];

  const topology = createDefaultTopology(agents);

  assert.equal(Object.prototype.hasOwnProperty.call(topology, "startAgentId"), false);
  assert.deepEqual(topology.nodes, ["Build", "BA", "TaskReview"]);
  assert.equal(topology.edges.length, 1);
  assert.deepEqual(topology.edges[0], {
    source: "Build",
    target: "BA",
    triggerOn: "handoff",
    messageMode: "last",
  });
  assert.deepEqual(topology.langgraph, {
    start: {
      id: "__start__",
      targets: ["Build"],
    },
    end: null,
  });
  assert.equal(
    topology.edges.some((edge) => edge.triggerOn === "approved" || edge.triggerOn === "action_required"),
    false,
  );
});

test("默认拓扑在缺少 Build 时不会偷偷把首个 Agent 当起点", () => {
  const agents: TopologyAgentSeed[] = [
    { name: "BA" },
    { name: "TaskReview" },
  ];

  const topology = createDefaultTopology(agents);

  assert.equal(Object.prototype.hasOwnProperty.call(topology, "startAgentId"), false);
  assert.deepEqual(topology.nodes, ["BA", "TaskReview"]);
  assert.deepEqual(topology.edges, []);
  assert.deepEqual(topology.langgraph, {
    start: {
      id: "__start__",
      targets: ["BA"],
    },
    end: null,
  });
});

test("存在 review 出边时 isReviewAgentInTopology 返回 true", () => {
  const topology: TopologyRecord = {
    nodes: ["Build", "TaskReview"],
    edges: [
      {
        source: "TaskReview",
        target: "Build",
        triggerOn: "action_required",
      },
    ],
  };

  assert.equal(isReviewAgentInTopology(topology, "TaskReview"), true);
  assert.equal(isReviewAgentInTopology(topology, "Build"), false);
});

test("action_required 边默认回流上限为 4，且支持按边单独覆盖", () => {
  const topology: TopologyRecord = {
    nodes: ["Build", "UnitTest", "TaskReview"],
    edges: [
      {
        source: "UnitTest",
        target: "Build",
        triggerOn: "action_required",
      },
      {
        source: "TaskReview",
        target: "Build",
        triggerOn: "action_required",
        maxRevisionRounds: 7,
      },
    ],
  };

  assert.equal(getActionRequiredEdgeLoopLimit(topology, "UnitTest", "Build"), 4);
  assert.equal(getActionRequiredEdgeLoopLimit(topology, "TaskReview", "Build"), 7);
});

test("只有 Build 继续视为 OpenCode 内置 prompt", () => {
  assert.equal(usesOpenCodeBuiltinPrompt("Build"), true);
  assert.equal(usesOpenCodeBuiltinPrompt("build"), true);
  assert.equal(usesOpenCodeBuiltinPrompt("BA"), false);
  assert.equal(usesOpenCodeBuiltinPrompt("UnitTest"), false);
});
