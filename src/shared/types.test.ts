import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTopologyNodeRecords,
  collectTopologyTriggerShapes,
  createDefaultTopology,
  getSpawnRules,
  getActionRequiredEdgeLoopLimit,
  isDecisionAgentInTopology,
  normalizeActionRequiredMaxRounds,
  normalizeTopologyEdgeTrigger,
  type TopologyAgentSeed,
  type TopologyRecord,
  usesOpenCodeBuiltinPrompt,
} from "./types";
import { readFileSync } from "node:fs";

const TYPES_SOURCE = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
const MESSAGE_RECORD_BLOCK = TYPES_SOURCE.match(/export interface MessageRecord \{[\s\S]*?\n\}/u)?.[0] ?? "";
const TOPOLOGY_RECORD_BLOCK = TYPES_SOURCE.match(/export interface TopologyRecord \{[\s\S]*?\n\}/u)?.[0] ?? "";

function withAgentNodeRecords(topology: Omit<TopologyRecord, "nodeRecords">): TopologyRecord {
  return {
    ...topology,
    nodeRecords: buildTopologyNodeRecords({
      nodes: topology.nodes,
      spawnNodeIds: new Set(),
      templateNameByNodeId: new Map(),
      initialMessageRoutingByNodeId: new Map(),
      spawnRuleIdByNodeId: new Map(),
      spawnEnabledNodeIds: new Set(),
      promptByNodeId: new Map(),
      writableNodeIds: new Set(),
    }),
  };
}

test("默认拓扑只生成首节点到次节点的 transfer 边", () => {
  const agents: TopologyAgentSeed[] = [
    { id: "BA" },
    { id: "Build" },
    { id: "TaskReview" },
  ];

  const topology = createDefaultTopology(agents);

  assert.deepEqual(topology.nodes, ["Build", "BA", "TaskReview"]);
  assert.equal(topology.edges.length, 1);
  assert.deepEqual(topology.edges[0], {
    source: "Build",
    target: "BA",
    trigger: "<default>",
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
    topology.edges.some((edge) => edge.trigger === "complete" || edge.trigger === "continue"),
    false,
  );
});

test("默认拓扑在缺少 Build 时不会偷偷把首个 Agent 当起点", () => {
  const agents: TopologyAgentSeed[] = [
    { id: "BA" },
    { id: "TaskReview" },
  ];

  const topology = createDefaultTopology(agents);

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

test("存在 decision 出边时 isDecisionAgentInTopology 返回 true", () => {
  const topology: TopologyRecord = withAgentNodeRecords({
    nodes: ["Build", "TaskReview"],
    edges: [
      {
        source: "TaskReview",
        target: "Build",
        trigger: "<continue>",
        messageMode: "last",
      },
    ],
  });

  assert.equal(isDecisionAgentInTopology(topology, "TaskReview"), true);
  assert.equal(isDecisionAgentInTopology(topology, "Build"), false);
});

test("回流边默认上限为 4，且支持按显式 trigger 单独覆盖", () => {
  const topology: TopologyRecord = withAgentNodeRecords({
    nodes: ["Build", "UnitTest", "TaskReview"],
    edges: [
      {
        source: "UnitTest",
        target: "Build",
        trigger: "<continue>",
        messageMode: "last",
        maxTriggerRounds: 4,
      },
      {
        source: "TaskReview",
        target: "Build",
        trigger: "<continue>",
        messageMode: "last",
        maxTriggerRounds: 7,
      },
    ],
  });

  assert.equal(getActionRequiredEdgeLoopLimit(topology, "UnitTest", "Build", "<continue>"), 4);
  assert.equal(getActionRequiredEdgeLoopLimit(topology, "TaskReview", "Build", "<continue>"), 7);
});

test("getActionRequiredEdgeLoopLimit 会按 trigger 精确命中同源同目标回流边", () => {
  const topology: TopologyRecord = withAgentNodeRecords({
    nodes: ["漏洞论证", "Build"],
    edges: [
      {
        source: "漏洞论证",
        target: "Build",
        trigger: "<first>",
        messageMode: "last",
        maxTriggerRounds: 2,
      },
      {
        source: "漏洞论证",
        target: "Build",
        trigger: "<second>",
        messageMode: "last",
        maxTriggerRounds: 5,
      },
    ],
  });

  assert.equal(getActionRequiredEdgeLoopLimit(topology, "漏洞论证", "Build", "<first>"), 2);
  assert.equal(getActionRequiredEdgeLoopLimit(topology, "漏洞论证", "Build", "<second>"), 5);
});

test("getActionRequiredEdgeLoopLimit 在 trigger 不匹配时必须直接报错", () => {
  const topology: TopologyRecord = withAgentNodeRecords({
    nodes: ["漏洞论证", "Build"],
    edges: [
      {
        source: "漏洞论证",
        target: "Build",
        trigger: "<first>",
        messageMode: "last",
        maxTriggerRounds: 2,
      },
    ],
  });

  assert.throws(
    () => getActionRequiredEdgeLoopLimit(topology, "漏洞论证", "Build", "<second>"),
    /未找到匹配 trigger 的 action_required 边/u,
  );
});

test("自定义 label 的回流与通过不再按 trigger 名字推断，而是按边配置区分", () => {
  const topology: TopologyRecord = withAgentNodeRecords({
    nodes: ["Build", "Judge", "Summary"],
    edges: [
      {
        source: "Build",
        target: "Judge",
        trigger: "<default>",
        messageMode: "last",
      },
      {
        source: "Judge",
        target: "Build",
        trigger: "<revise>",
        messageMode: "last",
        maxTriggerRounds: 2,
      },
      {
        source: "Judge",
        target: "Summary",
        trigger: "<approved>",
        messageMode: "last",
      },
    ],
  });

  assert.deepEqual(collectTopologyTriggerShapes({
    edges: topology.edges,
    endIncoming: topology.langgraph?.end?.incoming ?? [],
  }), [
    { source: "Judge", trigger: "<revise>", routeKind: "action_required" },
    { source: "Judge", trigger: "<approved>", routeKind: "labeled" },
  ]);
});

test("示例 label 作为普通 trigger 时不会获得特殊待遇，仍只按边配置区分", () => {
  const topology: TopologyRecord = withAgentNodeRecords({
    nodes: ["Judge", "Build", "Summary"],
    edges: [
      {
        source: "Judge",
        target: "Summary",
        trigger: "<continue>",
        messageMode: "last",
      },
      {
        source: "Judge",
        target: "Build",
        trigger: "<complete>",
        messageMode: "last",
        maxTriggerRounds: 3,
      },
    ],
  });

  assert.deepEqual(collectTopologyTriggerShapes({
    edges: topology.edges,
    endIncoming: topology.langgraph?.end?.incoming ?? [],
  }), [
    { source: "Judge", trigger: "<continue>", routeKind: "labeled" },
    { source: "Judge", trigger: "<complete>", routeKind: "action_required" },
  ]);
});

test("只有 Build 继续视为 OpenCode 内置 prompt", () => {
  assert.equal(usesOpenCodeBuiltinPrompt("Build"), true);
  assert.equal(usesOpenCodeBuiltinPrompt("build"), true);
  assert.equal(usesOpenCodeBuiltinPrompt("BA"), false);
  assert.equal(usesOpenCodeBuiltinPrompt("UnitTest"), false);
});

test("未知 trigger 必须直接报错，canonical trigger 保持新命名", () => {
  assert.throws(() => normalizeTopologyEdgeTrigger("unknown"), /非法拓扑 trigger/u);
  assert.throws(() => normalizeTopologyEdgeTrigger("transfer"), /非法拓扑 trigger/u);
  assert.throws(() => normalizeTopologyEdgeTrigger("complete"), /非法拓扑 trigger/u);
  assert.throws(() => normalizeTopologyEdgeTrigger("continue"), /非法拓扑 trigger/u);
  assert.equal(normalizeTopologyEdgeTrigger("<default>"), "<default>");
  assert.equal(normalizeTopologyEdgeTrigger("<complete>"), "<complete>");
  assert.equal(normalizeTopologyEdgeTrigger("<continue>"), "<continue>");
});

test("非法 maxTriggerRounds 必须直接报错，不能偷偷修正", () => {
  assert.throws(() => normalizeActionRequiredMaxRounds(0), /maxTriggerRounds 必须是大于等于 1 的整数/u);
  assert.throws(() => normalizeActionRequiredMaxRounds(1.5), /maxTriggerRounds 必须是大于等于 1 的整数/u);
  assert.throws(() => normalizeActionRequiredMaxRounds("4"), /maxTriggerRounds 必须是大于等于 1 的整数/u);
  assert.equal(normalizeActionRequiredMaxRounds(4), 4);
});

test("MessageRecord 不再暴露无生产用途的 projectId / sessionId / sourceAgentId", () => {
  assert.equal(MESSAGE_RECORD_BLOCK.includes("  projectId?: string;\n"), false);
  assert.equal(MESSAGE_RECORD_BLOCK.includes("  sessionId?: string;\n"), false);
  assert.equal(MESSAGE_RECORD_BLOCK.includes("  sourceAgentId?: string;\n"), false);
});

test("TopologyRecord 不再暴露无生产用途的 projectId", () => {
  assert.equal(TOPOLOGY_RECORD_BLOCK.includes("  projectId?: string;\n"), false);
});

test("MessageRecord 使用必选 kind 作为判别字段，并为用户消息保留显式种类", () => {
  assert.equal(MESSAGE_RECORD_BLOCK.includes("  kind?:"), false);
  assert.match(TYPES_SOURCE, /kind:\s*"user"/u);
  assert.match(TYPES_SOURCE, /kind:\s*"system-message"/u);
});

test("getSpawnRules 保留显式声明的 messageMode，不再依赖默认补值", () => {
  const topology: TopologyRecord = {
    nodes: ["线索发现", "疑点辩论"],
    edges: [],
    nodeRecords: [
      {
        id: "线索发现",
        kind: "agent",
        templateName: "线索发现",
        initialMessageRouting: { mode: "inherit" },
      },
      {
        id: "疑点辩论",
        kind: "spawn",
        templateName: "疑点辩论",
        spawnEnabled: true,
        spawnRuleId: "spawn-rule:疑点辩论",
        initialMessageRouting: { mode: "inherit" },
      },
    ],
    spawnRules: [
      {
        id: "疑点辩论",
        spawnNodeName: "疑点辩论",
        sourceTemplateName: "线索发现",
        entryRole: "pro",
        spawnedAgents: [
          { role: "pro", templateName: "漏洞论证" },
          { role: "con", templateName: "漏洞挑战" },
        ],
        edges: [
          {
            sourceRole: "pro",
            targetRole: "con",
            trigger: "<continue>",
            messageMode: "last",
          },
        ],
        exitWhen: "all_completed",
      },
    ],
  };

  assert.deepEqual(getSpawnRules(topology)[0]?.edges, [
    {
      sourceRole: "pro",
      targetRole: "con",
      trigger: "<continue>",
      messageMode: "last",
    },
  ]);
});

test("getSpawnRules 会拒绝缺少 reportToTrigger 的 spawn report 配置", () => {
  const topology: TopologyRecord = {
    nodes: ["线索发现", "疑点辩论", "漏洞论证", "漏洞挑战"],
    edges: [],
    nodeRecords: [
      { id: "线索发现", kind: "agent", templateName: "线索发现", initialMessageRouting: { mode: "inherit" } },
      { id: "疑点辩论", kind: "spawn", templateName: "疑点辩论", spawnRuleId: "spawn-rule:疑点辩论", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞论证", kind: "agent", templateName: "漏洞论证", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞挑战", kind: "agent", templateName: "漏洞挑战", initialMessageRouting: { mode: "inherit" } },
    ],
    spawnRules: [
      {
        id: "spawn-rule:疑点辩论",
        spawnNodeName: "疑点辩论",
        entryRole: "pro",
        spawnedAgents: [
          { role: "pro", templateName: "漏洞论证" },
          { role: "con", templateName: "漏洞挑战" },
        ],
        edges: [],
        exitWhen: "all_completed",
        reportToTemplateName: "线索发现",
        reportToTrigger: "<default>",
      },
    ],
  };
  Reflect.deleteProperty(topology.spawnRules![0]!, "reportToTrigger");

  assert.throws(
    () => getSpawnRules(topology),
    /必须显式声明 reportToTrigger/u,
  );
});
