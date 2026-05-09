import assert from "node:assert/strict";
import test from "node:test";

import { createTopology as createTopologyCore } from "./topology-test-dsl";

function createTopology(...args: Parameters<typeof createTopologyCore>): ReturnType<typeof createTopologyCore> {
  return createTopologyCore(...args);
}

test("createTopology 支持以前端下游模板 DSL 生成普通拓扑", () => {
  const topology = createTopology({
    downstream: {
      BA: { Build: "<default>" },
      Build: {
        CodeReview: "<default>",
        UnitTest: "<default>",
        TaskReview: "<default>",
      },
      CodeReview: {
        Build: { trigger: "<continue>", maxTriggerRounds: 4 },
        TaskReview: "<complete>",
      },
    },
  });

  assert.deepEqual(topology.nodes, ["BA", "Build", "CodeReview", "UnitTest", "TaskReview"]);
  assert.deepEqual(topology.edges, [
    { source: "BA", target: "Build", trigger: "<default>", messageMode: "last" },
    { source: "Build", target: "CodeReview", trigger: "<default>", messageMode: "last" },
    { source: "Build", target: "UnitTest", trigger: "<default>", messageMode: "last" },
    { source: "Build", target: "TaskReview", trigger: "<default>", messageMode: "last" },
    { source: "CodeReview", target: "Build", trigger: "<continue>", messageMode: "last", maxTriggerRounds: 4 },
    { source: "CodeReview", target: "TaskReview", trigger: "<complete>", messageMode: "last" },
  ]);
});

test("createTopology 支持把 spawn 作为下游模式写进 DSL", () => {
  const topology = createTopology({
    downstream: {
      Build: { TaskReview: "spawn" },
      TaskReview: { Build: { trigger: "<continue>", maxTriggerRounds: 4 } },
    },
    spawn: {
      TaskReview: {},
    },
  });

  assert.deepEqual(topology.edges, [
    { source: "Build", target: "TaskReview", trigger: "<default>", messageMode: "last" },
    { source: "TaskReview", target: "Build", trigger: "<continue>", messageMode: "last", maxTriggerRounds: 4 },
  ]);
  assert.deepEqual(topology.nodeRecords, [
    { id: "Build", kind: "agent", templateName: "Build", initialMessageRouting: { mode: "inherit" } },
    {
      id: "TaskReview",
      kind: "spawn",
      templateName: "TaskReview",
      spawnEnabled: true,
      spawnRuleId: "spawn-rule:TaskReview",
      initialMessageRouting: { mode: "inherit" },
    },
  ]);
  assert.deepEqual(topology.spawnRules, [
    {
      id: "spawn-rule:TaskReview",
      spawnNodeName: "TaskReview",
      sourceTemplateName: "Build",
      entryRole: "entry",
      spawnedAgents: [{ role: "entry", templateName: "TaskReview" }],
      edges: [],
      exitWhen: "one_side_agrees",
      report: {
        templateName: "Build",
        trigger: "<default>",
        messageMode: "last",
        maxTriggerRounds: false,
      },
    },
  ]);
});
