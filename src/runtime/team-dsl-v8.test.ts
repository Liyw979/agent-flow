import assert from "node:assert/strict";
import test from "node:test";

import { readBuiltinTopology } from "../../test-support/runtime/builtin-topology-test-helpers";
import { compileTeamDsl } from "./team-dsl";

test("compileTeamDsl 支持 v8 递归式图 DSL，并保留 spawn 子图定义", () => {
  const compiled = compileTeamDsl(readBuiltinTopology("vulnerability.json5"));

  assert.deepEqual(compiled.topology.edges, [
    {
      source: "线索发现",
      target: "疑点辩论",
      trigger: "<continue>",
      messageMode: "last",
      maxTriggerRounds: 999,
    },
    {
      source: "线索发现",
      target: "线索完备性评估",
      trigger: "<complete>",
      messageMode: "last",
    },
    {
      source: "线索完备性评估",
      target: "线索发现",
      trigger: "<continue>",
      messageMode: "last",
      maxTriggerRounds: 4,
    },
  ]);
  assert.equal(compiled.topology.spawnRules?.[0]?.id, "spawn-rule:疑点辩论");
  assert.equal(compiled.topology.spawnRules?.[0]?.entryRole, "漏洞挑战");
  assert.deepEqual(compiled.topology.spawnRules?.[0]?.spawnedAgents, [
    { role: "漏洞挑战", templateName: "漏洞挑战" },
    { role: "漏洞论证", templateName: "漏洞论证" },
    { role: "讨论总结", templateName: "讨论总结" },
  ]);
  const summaryNode = compiled.topology.nodeRecords.find((node) => node.id === "讨论总结");
  assert.ok(summaryNode);
  assert.equal(summaryNode.kind, "agent");
  assert.equal(summaryNode.templateName, "讨论总结");
  assert.deepEqual(summaryNode.initialMessageRouting, {
    mode: "list",
    agentIds: ["线索发现", "漏洞挑战", "漏洞论证"],
  });
  assert.equal(summaryNode.writable, true);
});
