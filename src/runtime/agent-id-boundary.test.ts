import { strict as assert } from "assert";
import test from "node:test";

import { buildTopologyNodeRecords } from "@shared/types";

import { createEmptyGraphTaskState } from "./gating-state";
import { createUserDispatchDecision } from "./gating-router";

test("用户派发决策使用 agentId 字段表达来源和目标", () => {
  const state = createEmptyGraphTaskState({
    taskId: "task-1",
    topology: {
      nodes: ["Build"],
      edges: [],
      nodeRecords: buildTopologyNodeRecords({
        nodes: ["Build"],
        spawnNodeIds: new Set(),
        templateNameByNodeId: new Map(),
        initialMessageRoutingByNodeId: new Map(),
        spawnRuleIdByNodeId: new Map(),
        spawnEnabledNodeIds: new Set(),
        promptByNodeId: new Map(),
        writableNodeIds: new Set(),
      }),
    },
  });

  const decision = createUserDispatchDecision(state, {
    targetAgentId: "Build",
    content: "实现加法",
  });

  assert.equal(decision.type, "execute_batch");
  assert.deepEqual(decision.batch, {
    routingKind: "default",
    sourceAgentId: null,
    sourceContent: "实现加法",
    displayContent: "实现加法",
    triggerTargets: ["Build"],
    jobs: [
      {
        agentId: "Build",
        sourceContent: "实现加法",
        displayContent: "实现加法",
        kind: "raw",
      },
    ],
  });
});
