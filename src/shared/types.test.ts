import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultTopology,
  getNeedsRevisionEdgeLoopLimit,
  isReviewAgentInTopology,
  normalizeTopologyEdgeTrigger,
  type TopologyAgentSeed,
  type TopologyRecord,
  usesOpenCodeBuiltinPrompt,
} from "./types";
import { readFileSync } from "node:fs";

const TYPES_SOURCE = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
const MESSAGE_RECORD_BLOCK = TYPES_SOURCE.match(/export interface MessageRecord \{[\s\S]*?\n\}/u)?.[0] ?? "";

test("默认拓扑只生成首节点到次节点的 association 边", () => {
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
    triggerOn: "association",
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
    topology.edges.some((edge) => edge.triggerOn === "approved" || edge.triggerOn === "needs_revision"),
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
        triggerOn: "needs_revision",
      },
    ],
  };

  assert.equal(isReviewAgentInTopology(topology, "TaskReview"), true);
  assert.equal(isReviewAgentInTopology(topology, "Build"), false);
});

test("needs_revision 边默认回流上限为 4，且支持按边单独覆盖", () => {
  const topology: TopologyRecord = {
    nodes: ["Build", "UnitTest", "TaskReview"],
    edges: [
      {
        source: "UnitTest",
        target: "Build",
        triggerOn: "needs_revision",
      },
      {
        source: "TaskReview",
        target: "Build",
        triggerOn: "needs_revision",
        maxRevisionRounds: 7,
      },
    ],
  };

  assert.equal(getNeedsRevisionEdgeLoopLimit(topology, "UnitTest", "Build"), 4);
  assert.equal(getNeedsRevisionEdgeLoopLimit(topology, "TaskReview", "Build"), 7);
});

test("只有 Build 继续视为 OpenCode 内置 prompt", () => {
  assert.equal(usesOpenCodeBuiltinPrompt("Build"), true);
  assert.equal(usesOpenCodeBuiltinPrompt("build"), true);
  assert.equal(usesOpenCodeBuiltinPrompt("BA"), false);
  assert.equal(usesOpenCodeBuiltinPrompt("UnitTest"), false);
});

test("旧的 review_pass / review_fail 别名不再被识别为合法 trigger", () => {
  assert.equal(normalizeTopologyEdgeTrigger("review_pass"), "association");
  assert.equal(normalizeTopologyEdgeTrigger("review_fail"), "association");
});

test("MessageRecord 不再暴露无生产用途的 projectId / sessionId / sourceAgentId", () => {
  assert.equal(MESSAGE_RECORD_BLOCK.includes("  projectId?: string;\n"), false);
  assert.equal(MESSAGE_RECORD_BLOCK.includes("  sessionId?: string;\n"), false);
  assert.equal(MESSAGE_RECORD_BLOCK.includes("  sourceAgentId?: string;\n"), false);
});

test("MessageRecord 使用必选 kind 作为判别字段，并为用户消息保留显式种类", () => {
  assert.equal(MESSAGE_RECORD_BLOCK.includes("  kind?:"), false);
  assert.match(TYPES_SOURCE, /kind:\s*"user"/u);
  assert.match(TYPES_SOURCE, /kind:\s*"system-message"/u);
});
