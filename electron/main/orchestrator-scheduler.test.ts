import test from "node:test";
import assert from "node:assert/strict";

import type { TopologyRecord } from "@shared/types";

import {
  OrchestratorScheduler,
  createSchedulerRuntimeState,
} from "./orchestrator-scheduler";

function createTopology(): TopologyRecord {
  return {
    projectId: "project-1",
    startAgentId: "Build",
    agentOrderIds: ["Build", "UnitTest", "TaskReview", "CodeReview"],
    nodes: [
      { id: "Build", label: "Build", kind: "agent" },
      { id: "UnitTest", label: "UnitTest", kind: "agent" },
      { id: "TaskReview", label: "TaskReview", kind: "agent" },
      { id: "CodeReview", label: "CodeReview", kind: "agent" },
    ],
    edges: [
      { id: "Build__UnitTest__association", source: "Build", target: "UnitTest", triggerOn: "association" },
      { id: "Build__TaskReview__association", source: "Build", target: "TaskReview", triggerOn: "association" },
      { id: "Build__CodeReview__association", source: "Build", target: "CodeReview", triggerOn: "association" },
      { id: "UnitTest__Build__review_fail", source: "UnitTest", target: "Build", triggerOn: "review_fail" },
      { id: "TaskReview__Build__review_fail", source: "TaskReview", target: "Build", triggerOn: "review_fail" },
      { id: "CodeReview__Build__review_fail", source: "CodeReview", target: "Build", triggerOn: "review_fail" },
    ],
  };
}

function createAgentStates() {
  return [
    { name: "Build", status: "completed" as const },
    { name: "UnitTest", status: "idle" as const },
    { name: "TaskReview", status: "idle" as const },
    { name: "CodeReview", status: "idle" as const },
  ];
}

test("association 首轮派发会一次放行整批 reviewer", () => {
  const scheduler = new OrchestratorScheduler(createTopology(), createSchedulerRuntimeState());

  const plan = scheduler.planAssociationDispatch(
    "Build",
    "Build 第 1 轮实现完成",
    createAgentStates(),
  );

  assert.notEqual(plan, null);
  assert.deepEqual(plan?.displayTargets, ["UnitTest", "TaskReview", "CodeReview"]);
  assert.deepEqual(plan?.triggerTargets, ["UnitTest", "TaskReview", "CodeReview"]);
  assert.deepEqual(plan?.readyTargets, ["UnitTest", "TaskReview", "CodeReview"]);
  assert.deepEqual(plan?.queuedTargets, []);
});

test("association 批次在 reviewer 未收齐前不会提前推进下一位 reviewer 或回流修复", () => {
  const scheduler = new OrchestratorScheduler(createTopology(), createSchedulerRuntimeState());

  const plan = scheduler.planAssociationDispatch(
    "Build",
    "Build 第 1 轮实现完成",
    createAgentStates(),
  );

  assert.notEqual(plan, null);

  const continuation = scheduler.recordAssociationBatchResponse(
    "UnitTest",
    "fail",
    createAgentStates(),
  );

  assert.deepEqual(continuation, {
    matchedBatch: true,
    sourceAgentId: "Build",
    sourceContent: "Build 第 1 轮实现完成",
    pendingTargets: ["TaskReview", "CodeReview"],
    repairReviewerAgentId: null,
    redispatchTargets: [],
  });
});
