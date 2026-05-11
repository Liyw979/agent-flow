import test from "node:test";
import assert from "node:assert/strict";

import type { TopologyRecord } from "@shared/types";

import {
  getDownstreamMode,
  setDownstreamMode,
  setGroupEnabledForDownstream,
} from "./topology-group-toggle";

test("在下游配置中把某个下游勾选为 group 后，会自动把该下游及其后续可达 Agent 组成同一个动态团队", () => {
  const topology: TopologyRecord = {
    nodes: ["Build", "漏洞论证", "漏洞挑战", "Summary"],
    nodeRecords: [
      { id: "Build", kind: "agent", templateName: "Build", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞论证", kind: "agent", templateName: "漏洞论证", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞挑战", kind: "agent", templateName: "漏洞挑战", initialMessageRouting: { mode: "inherit" } },
      { id: "Summary", kind: "agent", templateName: "Summary", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [
      { source: "Build", target: "漏洞论证", trigger: "<default>", messageMode: "last" },
      { source: "漏洞论证", target: "漏洞挑战", trigger: "<continue>", messageMode: "last" },
      { source: "漏洞挑战", target: "Summary", trigger: "<complete>", messageMode: "last" },
    ],
    groupRules: [],
  };

  const next = setGroupEnabledForDownstream({
    topology,
    sourceNodeId: "Build",
    targetNodeId: "漏洞论证",
    enabled: true,
  });

  const groupNode = next.nodeRecords.find((node) => node.id === "漏洞论证");
  assert.equal(groupNode?.kind, "group");
  assert.equal(groupNode?.groupEnabled, true);
  assert.equal(groupNode?.groupRuleId, "group-rule:漏洞论证");

  const groupRule = next.groupRules?.find((rule) => rule.id === "group-rule:漏洞论证");
  assert.notEqual(groupRule, undefined);
  assert.equal(groupRule?.sourceTemplateName, "Build");
  assert.deepEqual(
    groupRule?.members.map((agent) => agent.templateName),
    ["漏洞论证", "漏洞挑战", "Summary"],
  );
});

test("启用 group 时，会清掉同一下游上的其它触发类型，保证四种模式完全互斥", () => {
  const topology: TopologyRecord = {
    nodes: ["Build", "漏洞论证", "漏洞挑战", "Summary"],
    nodeRecords: [
      { id: "Build", kind: "agent", templateName: "Build", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞论证", kind: "agent", templateName: "漏洞论证", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞挑战", kind: "agent", templateName: "漏洞挑战", initialMessageRouting: { mode: "inherit" } },
      { id: "Summary", kind: "agent", templateName: "Summary", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [
      { source: "Build", target: "漏洞论证", trigger: "<default>", messageMode: "last" },
      { source: "Build", target: "漏洞论证", trigger: "<complete>", messageMode: "last" },
      { source: "Build", target: "漏洞论证", trigger: "<continue>", messageMode: "last" },
      { source: "漏洞论证", target: "漏洞挑战", trigger: "<continue>", messageMode: "last" },
      { source: "漏洞挑战", target: "Summary", trigger: "<complete>", messageMode: "last" },
    ],
    groupRules: [],
  };

  const next = setGroupEnabledForDownstream({
    topology,
    sourceNodeId: "Build",
    targetNodeId: "漏洞论证",
    enabled: true,
  });

  assert.deepEqual(
    next.edges
      .filter((edge) => edge.source === "Build" && edge.target === "漏洞论证")
      .map((edge) => edge.trigger)
      .sort(),
    ["<default>"],
  );
});

test("切换到传递时，会关闭 group、删除动态团队规则，并只保留传递一种模式", () => {
  const topology: TopologyRecord = {
    nodes: ["Build", "漏洞论证", "漏洞挑战", "Summary"],
    nodeRecords: [
      { id: "Build", kind: "agent", templateName: "Build", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞论证", kind: "group", templateName: "漏洞论证", groupEnabled: true, groupRuleId: "group-rule:漏洞论证", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞挑战", kind: "agent", templateName: "漏洞挑战", initialMessageRouting: { mode: "inherit" } },
      { id: "Summary", kind: "agent", templateName: "Summary", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [
      { source: "Build", target: "漏洞论证", trigger: "<continue>", messageMode: "last" },
      { source: "漏洞论证", target: "漏洞挑战", trigger: "<continue>", messageMode: "last" },
      { source: "漏洞挑战", target: "Summary", trigger: "<complete>", messageMode: "last" },
    ],
    groupRules: [
      {
        id: "group-rule:漏洞论证",
        groupNodeName: "漏洞论证",
        sourceTemplateName: "Build",
        entryRole: "entry",
        members: [
          { role: "entry", templateName: "漏洞论证" },
          { role: "漏洞挑战", templateName: "漏洞挑战" },
          { role: "Summary", templateName: "Summary" },
        ],
        edges: [
          { sourceRole: "entry", targetRole: "漏洞挑战", trigger: "<default>", messageMode: "last" },
          { sourceRole: "漏洞挑战", targetRole: "Summary", trigger: "<default>", messageMode: "last" },
        ],
        exitWhen: "one_side_agrees",
        report: {
          sourceRole: "summary",
          templateName: "Summary",
          trigger: "<default>",
          messageMode: "last",
          maxTriggerRounds: false,
        },
      },
    ],
  };

  const next = setDownstreamMode({
    topology,
    sourceNodeId: "Build",
    targetNodeId: "漏洞论证",
    mode: "<default>",
  });

  const targetNode = next.nodeRecords.find((node) => node.id === "漏洞论证");
  assert.equal(targetNode?.kind, "agent");
  assert.equal(targetNode?.groupEnabled, false);
  assert.equal(targetNode?.groupRuleId, undefined);
  assert.equal(next.groupRules?.length ?? 0, 0);
  assert.deepEqual(
    next.edges
      .filter((edge) => edge.source === "Build" && edge.target === "漏洞论证")
      .map((edge) => edge.trigger)
      .sort(),
    ["<default>"],
  );
});

test("切换到继续处理时，会关闭 group 并保留一条可调度的 action_required 入口边", () => {
  const topology: TopologyRecord = {
    nodes: ["Build", "漏洞论证", "漏洞挑战"],
    nodeRecords: [
      { id: "Build", kind: "agent", templateName: "Build", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞论证", kind: "group", templateName: "漏洞论证", groupEnabled: true, groupRuleId: "group-rule:漏洞论证", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞挑战", kind: "agent", templateName: "漏洞挑战", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [],
    groupRules: [
      {
        id: "group-rule:漏洞论证",
        groupNodeName: "漏洞论证",
        sourceTemplateName: "Build",
        entryRole: "entry",
        members: [{ role: "entry", templateName: "漏洞论证" }],
        edges: [],
        exitWhen: "one_side_agrees",
        report: {
          sourceRole: "summary",
          templateName: "Build",
          trigger: "<default>",
          messageMode: "last",
          maxTriggerRounds: false,
        },
      },
    ],
  };

  const next = setDownstreamMode({
    topology,
    sourceNodeId: "Build",
    targetNodeId: "漏洞论证",
    mode: "<continue>",
  });

  assert.equal(next.nodeRecords.find((node) => node.id === "漏洞论证")?.kind, "agent");
  assert.equal(next.groupRules?.length ?? 0, 0);
  assert.deepEqual(
    next.edges
      .filter((edge) => edge.source === "Build" && edge.target === "漏洞论证")
      .map((edge) => edge.trigger),
    ["<continue>"],
  );
});

test("当前下游模式会在 group、传递、已完成判定、继续处理 四种触发里返回唯一结果", () => {
  const spawnTopology: TopologyRecord = {
    nodes: ["Build", "漏洞论证"],
    nodeRecords: [
      { id: "Build", kind: "agent", templateName: "Build", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞论证", kind: "group", templateName: "漏洞论证", groupEnabled: true, groupRuleId: "group-rule:漏洞论证", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [],
    groupRules: [],
  };
  assert.equal(
    getDownstreamMode({
      topology: spawnTopology,
      sourceNodeId: "Build",
      targetNodeId: "漏洞论证",
    }),
    "group",
  );

  const handoffTopology: TopologyRecord = {
    nodes: ["Build", "漏洞论证"],
    nodeRecords: [
      { id: "Build", kind: "agent", templateName: "Build", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞论证", kind: "agent", templateName: "漏洞论证", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [{ source: "Build", target: "漏洞论证", trigger: "<default>", messageMode: "last" }],
    groupRules: [],
  };
  assert.equal(
    getDownstreamMode({
      topology: handoffTopology,
      sourceNodeId: "Build",
      targetNodeId: "漏洞论证",
    }),
    "<default>",
  );

  const passTopology: TopologyRecord = {
    nodes: ["Build", "漏洞论证"],
    nodeRecords: [
      { id: "Build", kind: "agent", templateName: "Build", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞论证", kind: "agent", templateName: "漏洞论证", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [{ source: "Build", target: "漏洞论证", trigger: "<complete>", messageMode: "last" }],
    groupRules: [],
  };
  assert.equal(
    getDownstreamMode({
      topology: passTopology,
      sourceNodeId: "Build",
      targetNodeId: "漏洞论证",
    }),
    "<complete>",
  );

  const failTopology: TopologyRecord = {
    nodes: ["Build", "漏洞论证"],
    nodeRecords: [
      { id: "Build", kind: "agent", templateName: "Build", initialMessageRouting: { mode: "inherit" } },
      { id: "漏洞论证", kind: "agent", templateName: "漏洞论证", initialMessageRouting: { mode: "inherit" } },
    ],
    edges: [{ source: "Build", target: "漏洞论证", trigger: "<continue>", messageMode: "last" }],
    groupRules: [],
  };
  assert.equal(
    getDownstreamMode({
      topology: failTopology,
      sourceNodeId: "Build",
      targetNodeId: "漏洞论证",
    }),
    "<continue>",
  );
});
