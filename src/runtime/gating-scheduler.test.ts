import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTopologyNodeRecords,
  type TopologyRecord,
} from "@shared/types";

import {
  GatingScheduler,
  createGatingSchedulerRuntimeState,
} from "./gating-scheduler";
import { validateGroupRule } from "./runtime-topology";

function createTopology(): TopologyRecord {
  return {
    nodes: ["Build", "UnitTest", "TaskReview", "CodeReview"],
    edges: [
      { source: "Build", target: "UnitTest", trigger: "<default>", messageMode: "last" },
      { source: "Build", target: "TaskReview", trigger: "<default>", messageMode: "last" },
      { source: "Build", target: "CodeReview", trigger: "<default>", messageMode: "last" },
      { source: "UnitTest", target: "Build", trigger: "<continue>", messageMode: "last" },
      { source: "TaskReview", target: "Build", trigger: "<continue>", messageMode: "last" },
      { source: "CodeReview", target: "Build", trigger: "<continue>", messageMode: "last" },
    ],
    nodeRecords: buildTopologyNodeRecords({
      nodes: ["Build", "UnitTest", "TaskReview", "CodeReview"],
      groupNodeIds: new Set(),
      templateNameByNodeId: new Map(),
      initialMessageRoutingByNodeId: new Map(),
      groupRuleIdByNodeId: new Map(),
      groupEnabledNodeIds: new Set(),
      promptByNodeId: new Map(),
      writableNodeIds: new Set(),
    }),
  };
}

function withAgentNodeRecords(topology: Omit<TopologyRecord, "nodeRecords">): TopologyRecord {
  return {
    ...topology,
    nodeRecords: buildTopologyNodeRecords({
      nodes: topology.nodes,
      groupNodeIds: new Set(),
      templateNameByNodeId: new Map(),
      initialMessageRoutingByNodeId: new Map(),
      groupRuleIdByNodeId: new Map(),
      groupEnabledNodeIds: new Set(),
      promptByNodeId: new Map(),
      writableNodeIds: new Set(),
    }),
  };
}

function assertGroupRulesValid(topology: TopologyRecord): void {
  for (const rule of topology.groupRules ?? []) {
    validateGroupRule(topology, rule);
  }
}

function createAgentStates() {
  return [
    { id: "Build", status: "completed" as const },
    { id: "UnitTest", status: "idle" as const },
    { id: "TaskReview", status: "idle" as const },
    { id: "CodeReview", status: "idle" as const },
  ];
}

test("handoff 首轮派发会一次放行整批 decisionAgent", () => {
  const scheduler = new GatingScheduler(createTopology(), createGatingSchedulerRuntimeState());

  const plan = scheduler.planHandoffDispatch(
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

test("handoff 批次在 decisionAgent 未收齐前不会提前推进下一位 decisionAgent 或回流修复", () => {
  const scheduler = new GatingScheduler(createTopology(), createGatingSchedulerRuntimeState());

  const plan = scheduler.planHandoffDispatch(
    "Build",
    "Build 第 1 轮实现完成",
    createAgentStates(),
  );

  assert.notEqual(plan, null);

  const continuation = scheduler.recordHandoffBatchResponse(
    "UnitTest",
    "action_required",
  );

  assert.deepEqual(continuation, {
    sourceAgentId: "Build",
    sourceContent: "Build 第 1 轮实现完成",
    kind: "pending_targets",
    pendingTargets: ["TaskReview", "CodeReview"],
    redispatchTargets: [],
  });
});

test("单 decisionAgent 的 group 展开批次收尾时，不会把静态 group 节点误判成 stale target", () => {
  const runtime = createGatingSchedulerRuntimeState();
  runtime.activeHandoffBatchBySource.set("线索发现", {
    dispatchKind: "handoff",
    sourceAgentId: "线索发现",
    sourceContent: "发现一个可疑点",
    targets: ["漏洞论证-1"],
    pendingTargets: ["漏洞论证-1"],
    respondedTargets: [],
    sourceRound: 1,
    failedTargets: [],
  });
  runtime.sourceRoundStateByAgent.set("线索发现", {
    currentRound: 1,
    decisionPassRound: new Map(),
  });

  const scheduler = new GatingScheduler({
    nodes: ["线索发现", "疑点辩论"],
    nodeRecords: [
      { id: "线索发现", kind: "agent", templateName: "线索发现", initialMessageRouting: { mode: "inherit" } },
      { id: "疑点辩论", kind: "group", templateName: "疑点辩论", groupRuleId: "group-rule:疑点辩论", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [
      { source: "线索发现", target: "疑点辩论", trigger: "<default>", messageMode: "last" },
    ],
  }, runtime);

  const continuation = scheduler.recordHandoffBatchResponse(
    "漏洞论证-1",
    "resolved",
  );

  assert.deepEqual(continuation, {
    sourceAgentId: "线索发现",
    sourceContent: "发现一个可疑点",
    kind: "settled",
    pendingTargets: [],
    redispatchTargets: [],
  });
});

test("单 decisionAgent 的修复批次收尾时，会继续补跑同源的其他 stale decisionAgent", () => {
  const runtime = createGatingSchedulerRuntimeState();
  runtime.activeHandoffBatchBySource.set("Build", {
    dispatchKind: "handoff",
    sourceAgentId: "Build",
    sourceContent: "Build 第 2 轮实现完成",
    targets: ["UnitTest"],
    pendingTargets: ["UnitTest"],
    respondedTargets: [],
    sourceRound: 2,
    failedTargets: [],
  });
  runtime.sourceRoundStateByAgent.set("Build", {
    currentRound: 2,
    decisionPassRound: new Map([
      ["TaskReview", 1],
      ["CodeReview", 1],
    ]),
  });

  const scheduler = new GatingScheduler(withAgentNodeRecords({
    nodes: ["Build", "UnitTest", "TaskReview", "CodeReview"],
    edges: [
      { source: "Build", target: "UnitTest", trigger: "<default>", messageMode: "last" },
      { source: "Build", target: "TaskReview", trigger: "<default>", messageMode: "last" },
      { source: "Build", target: "CodeReview", trigger: "<default>", messageMode: "last" },
    ],
  }), runtime);

  const continuation = scheduler.recordHandoffBatchResponse(
    "UnitTest",
    "resolved",
  );

  assert.deepEqual(continuation, {
    sourceAgentId: "Build",
    sourceContent: "Build 第 2 轮实现完成",
    kind: "settled",
    pendingTargets: [],
    redispatchTargets: [],
  });
});

test("all_completed 子图里的 approved 多入边必须全部命中后才会派发目标节点", () => {
  const topology: TopologyRecord = {
    nodes: ["漏洞论证-1", "漏洞挑战-1", "讨论总结-1"],
    nodeRecords: [
      { id: "漏洞论证-1", kind: "agent", templateName: "漏洞论证", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞挑战-1", kind: "agent", templateName: "漏洞挑战", initialMessageRouting: { mode: "inherit" } },
      { id: "讨论总结-1", kind: "agent", templateName: "讨论总结", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [
      { source: "漏洞论证-1", target: "讨论总结-1", trigger: "<complete>", messageMode: "last" },
      { source: "漏洞挑战-1", target: "讨论总结-1", trigger: "<complete>", messageMode: "last" },
    ],
    groupRules: [
      {
        id: "group-rule:疑点辩论",
        groupNodeName: "疑点辩论",
        entryRole: "漏洞挑战",
        members: [
          { role: "漏洞挑战", templateName: "漏洞挑战" },
          { role: "漏洞论证", templateName: "漏洞论证" },
          { role: "讨论总结", templateName: "讨论总结" },
        ],
        edges: [
          { sourceRole: "漏洞论证", targetRole: "讨论总结", trigger: "<complete>", messageMode: "last" },
          { sourceRole: "漏洞挑战", targetRole: "讨论总结", trigger: "<complete>", messageMode: "last" },
        ],
        exitWhen: "all_completed",
        report: false,
      },
    ],
  };
  const firstScheduler = new GatingScheduler(topology, createGatingSchedulerRuntimeState());

  const firstPlan = firstScheduler.planLabeledDispatch(
    "漏洞论证-1",
    "漏洞论证同意进入裁决",
    [
      { id: "漏洞论证-1", status: "completed" as const },
      { id: "漏洞挑战-1", status: "idle" as const },
      { id: "讨论总结-1", status: "idle" as const },
    ],
    { trigger: "<complete>" },
  );

  assert.equal(firstPlan, null);

  const secondScheduler = new GatingScheduler(topology, createGatingSchedulerRuntimeState());
  const secondPlan = secondScheduler.planLabeledDispatch(
    "漏洞论证-1",
    "漏洞论证已在对方回应后完成本轮总结前判断",
    [
      { id: "漏洞论证-1", status: "completed" as const },
      { id: "漏洞挑战-1", status: "action_required" as const },
      { id: "讨论总结-1", status: "idle" as const },
    ],
    { trigger: "<complete>" },
  );

  assert.deepEqual(secondPlan, {
    sourceAgentId: "漏洞论证-1",
    sourceContent: "漏洞论证已在对方回应后完成本轮总结前判断",
    displayTargets: ["讨论总结-1"],
    triggerTargets: ["讨论总结-1"],
    readyTargets: ["讨论总结-1"],
    queuedTargets: [],
  });
});

test("one_side_agrees 子图里的 approved 多入边仍然允许单边命中后派发目标节点", () => {
  const scheduler = new GatingScheduler({
    nodes: ["漏洞论证-1", "漏洞挑战-1", "讨论总结-1"],
    nodeRecords: [
      { id: "漏洞论证-1", kind: "agent", templateName: "漏洞论证", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞挑战-1", kind: "agent", templateName: "漏洞挑战", initialMessageRouting: { mode: "inherit" } },
      { id: "讨论总结-1", kind: "agent", templateName: "讨论总结", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [
      { source: "漏洞论证-1", target: "讨论总结-1", trigger: "<complete>", messageMode: "last" },
      { source: "漏洞挑战-1", target: "讨论总结-1", trigger: "<complete>", messageMode: "last" },
    ],
    groupRules: [
      {
        id: "group-rule:疑点辩论",
        groupNodeName: "疑点辩论",
        entryRole: "漏洞挑战",
        members: [
          { role: "漏洞挑战", templateName: "漏洞挑战" },
          { role: "漏洞论证", templateName: "漏洞论证" },
          { role: "讨论总结", templateName: "讨论总结" },
        ],
        edges: [
          { sourceRole: "漏洞论证", targetRole: "讨论总结", trigger: "<complete>", messageMode: "last" },
          { sourceRole: "漏洞挑战", targetRole: "讨论总结", trigger: "<complete>", messageMode: "last" },
        ],
        exitWhen: "one_side_agrees",
        report: false,
      },
    ],
  }, createGatingSchedulerRuntimeState());

  const plan = scheduler.planLabeledDispatch(
    "漏洞论证-1",
    "漏洞论证同意进入裁决",
    [
      { id: "漏洞论证-1", status: "completed" as const },
      { id: "漏洞挑战-1", status: "idle" as const },
      { id: "讨论总结-1", status: "idle" as const },
    ],
    { trigger: "<complete>" },
  );

  assert.deepEqual(plan, {
    sourceAgentId: "漏洞论证-1",
    sourceContent: "漏洞论证同意进入裁决",
    displayTargets: ["讨论总结-1"],
    triggerTargets: ["讨论总结-1"],
    readyTargets: ["讨论总结-1"],
    queuedTargets: [],
  });
});

test("approved 派发也会写入核心批次状态，后续 decisionAgent 回复时仍能继续等待剩余 decisionAgent", () => {
  const runtime = createGatingSchedulerRuntimeState();
  const scheduler = new GatingScheduler(withAgentNodeRecords({
    nodes: ["CodeReview", "TaskReview", "UnitTest"],
    edges: [
      { source: "CodeReview", target: "TaskReview", trigger: "<complete>", messageMode: "last" },
      { source: "CodeReview", target: "UnitTest", trigger: "<complete>", messageMode: "last" },
    ],
  }), runtime);

  const plan = scheduler.planLabeledDispatch(
    "CodeReview",
    "CodeReview 通过并进入后续判定",
    [
      { id: "CodeReview", status: "completed" as const },
      { id: "TaskReview", status: "idle" as const },
      { id: "UnitTest", status: "idle" as const },
    ],
    { trigger: "<complete>" },
  );

  assert.deepEqual(plan?.readyTargets, ["TaskReview", "UnitTest"]);
  assert.deepEqual(runtime.activeHandoffBatchBySource.get("CodeReview")?.pendingTargets, [
    "TaskReview",
    "UnitTest",
  ]);

  const continuation = scheduler.recordHandoffBatchResponse("TaskReview", "resolved");

  assert.deepEqual(continuation, {
    sourceAgentId: "CodeReview",
    sourceContent: "CodeReview 通过并进入后续判定",
    kind: "pending_targets",
    pendingTargets: ["UnitTest"],
    redispatchTargets: [],
  });
});

test("默认 handoff 不会被未满足的自定义示例 trigger 入边错误阻塞", () => {
  const scheduler = new GatingScheduler(withAgentNodeRecords({
    nodes: ["BA", "Build", "Judge"],
    edges: [
      { source: "BA", target: "Build", trigger: "<default>", messageMode: "last" },
      { source: "Judge", target: "Build", trigger: "<revise>", messageMode: "last" },
    ],
  }), createGatingSchedulerRuntimeState());

  const plan = scheduler.planHandoffDispatch("BA", "BA 已完成澄清", [
    { id: "BA", status: "completed" },
    { id: "Build", status: "idle" },
    { id: "Judge", status: "idle" },
  ]);

  assert.notEqual(plan, null);
  assert.deepEqual(plan?.readyTargets, ["Build"]);
});

test("运行时 group report 边完成后，会满足对应静态 group report 入边并放行外层节点", () => {
  const runtime = createGatingSchedulerRuntimeState();
  runtime.completedEdges.add("裁决总结-1__初筛__transfer");
  runtime.edgeTriggerVersion.set("裁决总结-1__初筛__transfer", 1);
  const scheduler = new GatingScheduler({
    nodes: ["初筛", "疑点辩论", "反方-1", "裁决总结-1"],
    nodeRecords: [
      { id: "初筛", kind: "agent", templateName: "初筛", initialMessageRouting: { mode: "inherit" } },
      { id: "疑点辩论", kind: "group", templateName: "疑点辩论", groupRuleId: "group-rule:疑点辩论", initialMessageRouting: { mode: "inherit" } },
      { id: "反方-1", kind: "agent", templateName: "反方", initialMessageRouting: { mode: "inherit" } },
      { id: "裁决总结-1", kind: "agent", templateName: "裁决总结", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [
      { source: "疑点辩论", target: "初筛", trigger: "<default>", messageMode: "last" },
      { source: "裁决总结-1", target: "初筛", trigger: "<default>", messageMode: "last" },
    ],
    groupRules: [
      {
        id: "group-rule:疑点辩论",
        groupNodeName: "疑点辩论",
        entryRole: "反方",
        members: [
          { role: "反方", templateName: "反方" },
          { role: "裁决总结", templateName: "裁决总结" },
        ],
        edges: [
          { sourceRole: "反方", targetRole: "裁决总结", trigger: "<complete>", messageMode: "last" },
        ],
        exitWhen: "all_completed",
        report: {
          sourceRole: "裁决总结",
          templateName: "初筛",
          trigger: "<default>",
          messageMode: "last",
          maxTriggerRounds: false,
        },
      },
    ],
  }, runtime);
  assertGroupRulesValid({
    nodes: ["初筛", "疑点辩论", "反方-1", "裁决总结-1"],
    nodeRecords: [
      { id: "初筛", kind: "agent", templateName: "初筛", initialMessageRouting: { mode: "inherit" } },
      { id: "疑点辩论", kind: "group", templateName: "疑点辩论", groupRuleId: "group-rule:疑点辩论", initialMessageRouting: { mode: "inherit" } },
      { id: "反方-1", kind: "agent", templateName: "反方", initialMessageRouting: { mode: "inherit" } },
      { id: "裁决总结-1", kind: "agent", templateName: "裁决总结", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [
      { source: "疑点辩论", target: "初筛", trigger: "<default>", messageMode: "last" },
      { source: "裁决总结-1", target: "初筛", trigger: "<default>", messageMode: "last" },
    ],
    groupRules: [
      {
        id: "group-rule:疑点辩论",
        groupNodeName: "疑点辩论",
        entryRole: "反方",
        members: [
          { role: "反方", templateName: "反方" },
          { role: "裁决总结", templateName: "裁决总结" },
        ],
        edges: [
          { sourceRole: "反方", targetRole: "裁决总结", trigger: "<complete>", messageMode: "last" },
        ],
        exitWhen: "all_completed",
        report: {
          sourceRole: "裁决总结",
          templateName: "初筛",
          trigger: "<default>",
          messageMode: "last",
          maxTriggerRounds: false,
        },
      },
    ],
  });

  const plan = scheduler.planHandoffDispatch(
    "裁决总结-1",
    "通过",
    [
      { id: "初筛", status: "completed" as const },
      { id: "疑点辩论", status: "idle" as const },
      { id: "反方-1", status: "completed" as const },
      { id: "裁决总结-1", status: "completed" as const },
    ],
  );

  assert.deepEqual(plan?.readyTargets, ["初筛"]);
});
