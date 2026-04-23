import assert from "node:assert/strict";
import test from "node:test";

import { createTopology } from "./topology-test-dsl";

test("createTopology 支持以前端下游模板 DSL 生成普通拓扑", () => {
  const topology = createTopology({
    projectId: "dsl-basic",
    downstream: {
      BA: { Build: "handoff" },
      Build: {
        CodeReview: "handoff",
        UnitTest: "handoff",
        TaskReview: "handoff",
      },
      CodeReview: {
        Build: "action_required",
        TaskReview: "approved",
      },
    },
  });

  assert.deepEqual(topology.nodes, ["BA", "Build", "CodeReview", "UnitTest", "TaskReview"]);
  assert.deepEqual(topology.edges, [
    { source: "BA", target: "Build", triggerOn: "handoff" },
    { source: "Build", target: "CodeReview", triggerOn: "handoff" },
    { source: "Build", target: "UnitTest", triggerOn: "handoff" },
    { source: "Build", target: "TaskReview", triggerOn: "handoff" },
    { source: "CodeReview", target: "Build", triggerOn: "action_required" },
    { source: "CodeReview", target: "TaskReview", triggerOn: "approved" },
  ]);
});

test("createTopology 支持把 spawn 作为下游模式写进 DSL", () => {
  const topology = createTopology({
    projectId: "dsl-spawn",
    downstream: {
      Build: { TaskReview: "spawn" },
      TaskReview: { Build: "action_required" },
    },
    spawn: {
      TaskReview: {},
    },
  });

  assert.deepEqual(topology.edges, [
    { source: "Build", target: "TaskReview", triggerOn: "handoff" },
    { source: "TaskReview", target: "Build", triggerOn: "action_required" },
  ]);
  assert.deepEqual(topology.nodeRecords, [
    { id: "Build", kind: "agent", templateName: "Build" },
    {
      id: "TaskReview",
      kind: "spawn",
      templateName: "TaskReview",
      spawnEnabled: true,
      spawnRuleId: "spawn-rule:TaskReview",
    },
  ]);
  assert.deepEqual(topology.spawnRules, [
    {
      id: "spawn-rule:TaskReview",
      name: "TaskReview",
      spawnNodeName: "TaskReview",
      sourceTemplateName: "Build",
      entryRole: "entry",
      spawnedAgents: [{ role: "entry", templateName: "TaskReview" }],
      edges: [],
      exitWhen: "one_side_agrees",
      reportToTemplateName: "Build",
    },
  ]);
});
