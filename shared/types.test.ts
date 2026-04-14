import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultTopology, isReviewAgentInTopology, type TopologyAgentSeed } from "./types";

test("默认拓扑只把存在 review 出边的 Agent 视为审视 Agent", () => {
  const agents: TopologyAgentSeed[] = [
    {
      name: "BA",
      relativePath: "BA.md",
      mode: "primary",
      role: "business_analyst",
      tools: [],
    },
    {
      name: "Build",
      relativePath: "builtin://Build",
      mode: "primary",
      role: "implementation",
      tools: [],
    },
    {
      name: "UnitTest",
      relativePath: "UnitTest.md",
      mode: "subagent",
      role: "unit_test",
      tools: [],
    },
    {
      name: "IntegrationTest",
      relativePath: "IntegrationTest.md",
      mode: "subagent",
      role: "integration_test",
      tools: [],
    },
    {
      name: "TaskReview",
      relativePath: "TaskReview.md",
      mode: "subagent",
      role: "task_review",
      tools: [],
    },
    {
      name: "CodeReview",
      relativePath: "CodeReview.md",
      mode: "subagent",
      role: "code_review",
      tools: [],
    },
  ];

  const topology = createDefaultTopology("project-1", agents);

  assert.equal(isReviewAgentInTopology(topology, "BA"), false);
  assert.equal(isReviewAgentInTopology(topology, "Build"), false);
  assert.equal(isReviewAgentInTopology(topology, "UnitTest"), true);
  assert.equal(isReviewAgentInTopology(topology, "IntegrationTest"), true);
  assert.equal(isReviewAgentInTopology(topology, "TaskReview"), true);
  assert.equal(isReviewAgentInTopology(topology, "CodeReview"), true);

  assert.equal(
    topology.edges.some((edge) => edge.source === "BA" && edge.target === "Build" && edge.triggerOn === "review_fail"),
    false,
  );
  assert.equal(
    topology.edges.some((edge) => edge.source === "UnitTest" && edge.target === "TaskReview" && edge.triggerOn === "review_pass"),
    true,
  );
  assert.equal(
    topology.edges.some((edge) => edge.source === "IntegrationTest" && edge.target === "TaskReview" && edge.triggerOn === "review_pass"),
    true,
  );
  assert.equal(
    topology.edges.some((edge) => edge.source === "TaskReview" && edge.target === "Build" && edge.triggerOn === "review_fail"),
    true,
  );
});
