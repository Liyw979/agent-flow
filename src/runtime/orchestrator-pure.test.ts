import assert from "node:assert/strict";
import test from "node:test";

import type {
  MessageRecord,
  TaskAgentRecord,
  TaskStatus,
  TopologyEdgeTrigger,
  TopologyRecord,
} from "@shared/types";
import { buildTopologyNodeRecords } from "@shared/types";

import {
  buildDownstreamForwardedContextFromMessages,
  buildUserHistoryContent,
  getInitialUserMessageContent,
} from "./message-forwarding";
import {
  resolveAgentStatusFromRouting,
  resolveActionRequiredRequestContinuationAction,
  shouldStopTaskForUnhandledActionRequiredRequest,
} from "./gating-rules";
import {
  getPersistedCompletionSeedAgentIds,
  resolveStandaloneTaskStatusAfterAgentRun,
  shouldFinishTaskFromPersistedState,
} from "./task-lifecycle-rules";
import { buildTaskCompletionMessageContent } from "./task-completion-message";

const TEST_TASK_ID = "task-1";
const TEST_TIMESTAMP = "2026-04-16T00:00:00.000Z";

function createTopologyForTest(input: {
  nodes: string[];
  edges: Array<{
    source: string;
    target: string;
    trigger: TopologyEdgeTrigger;
    messageMode: "last" | "none";
  }>;
}): TopologyRecord {
  const nodeIds = new Set<string>();
  for (const agentId of input.nodes) {
    nodeIds.add(agentId);
  }
  for (const edge of input.edges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }

  return {
    nodes: [...nodeIds],
    edges: input.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      trigger: edge.trigger,
      messageMode: edge.messageMode,
    })),
    nodeRecords: buildTopologyNodeRecords({
      nodes: [...nodeIds],
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

function createUserMessage(input: {
  content: string;
  timestamp: string;
  targetAgentIds: string[];
}): MessageRecord {
  return {
    id: `user:${input.content}`,
    taskId: TEST_TASK_ID,
    sender: "user",
    content: input.content,
    timestamp: input.timestamp,
    kind: "user",
    scope: "task",
    taskTitle: "demo",
    targetAgentIds: input.targetAgentIds,
    targetRunCounts: input.targetAgentIds.map(() => 1),
  };
}

function createAgentFinalMessage(input: {
  sender: string;
  content: string;
  timestamp: string;
  routingKind: "default" | "invalid";
}): MessageRecord {
  return {
    id: `${input.sender}:${input.content}`,
    taskId: TEST_TASK_ID,
    sender: input.sender,
    content: input.content,
    timestamp: input.timestamp,
    kind: "agent-final",
    runCount: 1,
    status: "completed",
    routingKind: input.routingKind,
    responseNote: "",
    rawResponse: input.content,
  };
}

function createAgentDispatchMessage(input: {
  sender: string;
  content: string;
  timestamp: string;
  targetAgentIds: string[];
}): MessageRecord {
  return {
    id: `${input.sender}:${input.content}`,
    taskId: TEST_TASK_ID,
    sender: input.sender,
    content: input.content,
    timestamp: input.timestamp,
    kind: "agent-dispatch",
    targetAgentIds: input.targetAgentIds,
    targetRunCounts: input.targetAgentIds.map(() => 1),
    dispatchDisplayContent: input.content,
  };
}

function createActionRequiredRequestMessage(input: {
  sender: string;
  content: string;
  timestamp: string;
  targetAgentIds: string[];
  followUpMessageId: string;
}): MessageRecord {
  return {
    id: `${input.sender}:${input.content}`,
    taskId: TEST_TASK_ID,
    sender: input.sender,
    content: input.content,
    timestamp: input.timestamp,
    kind: "action-required-request",
    followUpMessageId: input.followUpMessageId,
    targetAgentIds: input.targetAgentIds,
    targetRunCounts: input.targetAgentIds.map(() => 1),
  };
}

function createAgentProgressMessage(input: {
  sender: string;
  content: string;
  timestamp: string;
}): MessageRecord {
  return {
    id: `${input.sender}:${input.content}:${input.timestamp}`,
    taskId: TEST_TASK_ID,
    sender: input.sender,
    content: input.content,
    timestamp: input.timestamp,
    kind: "agent-progress",
    activityKind: "message",
    label: input.content,
    detail: input.content,
    detailState: "not_applicable",
    sessionId: `session:${input.sender}`,
    runCount: 1,
  };
}

function createAgent(input: {
  id: string;
  status: TaskAgentRecord["status"];
  runCount: number;
}): TaskAgentRecord {
  return {
    taskId: TEST_TASK_ID,
    id: input.id,
    opencodeSessionId: `session:${input.id}`,
    opencodeAttachBaseUrl: "http://127.0.0.1:43127",
    status: input.status,
    runCount: input.runCount,
  };
}

test("下游结构化 prompt 的 Initial Task 继续使用首条用户任务，而不是最新追问", () => {
  const messages = [
    createUserMessage({
      content: "@Build 初始任务：实现加法工具",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["Build"],
    }),
    createUserMessage({
      content: "@Build 追问：顺便补一份使用说明",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["Build"],
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "Build 已完成实现，等待下游继续处理。",
    {
      includeInitialTask: true,
      messageMode: "last",
      initialMessageRouting: { mode: "inherit" },
      sourceAgentId: "Build",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "初始任务：实现加法工具",
    agentMessage:
      "[From Build Agent]\nBuild 已完成实现，等待下游继续处理。",
  });
});

test("边配置为 none 时，下游只收到原始标签正文，不再携带上游最后一条正文", () => {
  const messages = [
    createUserMessage({
      content: "@Build 初始任务：实现加法工具",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["Build"],
    }),
    createAgentFinalMessage({
      sender: "Build",
      content: "我已经写完加法工具，并补了测试。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "我已经写完加法工具，并补了测试。",
    {
      messageMode: "none",
      includeInitialTask: true,
      initialMessageRouting: { mode: "inherit" },
      sourceAgentId: "Build",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, { kind: "empty" });
});

test("边配置为 none 且 initialMessage 包含当前 source 时，会注入该来源首条可转发消息", () => {
  const messages = [
    createUserMessage({
      content: "@线索发现 请继续分析。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["线索发现"],
    }),
    createAgentFinalMessage({
      sender: "线索发现",
      content: "线索发现确认了入口参数可控。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "这段当前 source 正文不应按 none 默认转发。",
    {
      messageMode: "none",
      includeInitialTask: true,
      initialMessageRouting: {
        mode: "list",
        agentIds: ["线索发现"],
      },
      sourceAgentId: "线索发现",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请继续分析。",
    agentMessage: "[From 线索发现 Agent]\n线索发现确认了入口参数可控。",
  });
});

test("initialMessage 为额外来源 agent 时，下游会收到对应来源段落", () => {
  const messages = [
    createUserMessage({
      content: "@线索发现 请继续分析。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["线索发现"],
    }),
    createAgentFinalMessage({
      sender: "线索发现",
      content: "线索发现确认了第一条线索。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "漏洞讨论",
      content: "漏洞讨论补充了无关信息。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "漏洞讨论准备接手。",
    {
      includeInitialTask: true,
      messageMode: "last",
      initialMessageRouting: {
        mode: "list",
        agentIds: ["线索发现"],
      },
      sourceAgentId: "漏洞讨论",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请继续分析。",
    agentMessage:
    [
      "[From 线索发现 Agent]",
      "线索发现确认了第一条线索。",
      "",
      "[From 漏洞讨论 Agent]",
      "漏洞讨论准备接手。",
    ].join("\n"),
  });
});

test("initialMessage 包含当前 source 且首条与当前正文不同，两个来源段落都会保留", () => {
  const messages = [
    createUserMessage({
      content: "@漏洞讨论 请继续分析。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["漏洞讨论"],
    }),
    createAgentFinalMessage({
      sender: "漏洞讨论",
      content: "漏洞讨论首条证据。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "漏洞讨论",
      content: "漏洞讨论当前结论。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "漏洞讨论当前结论。",
    {
      includeInitialTask: true,
      messageMode: "last",
      initialMessageRouting: {
        mode: "list",
        agentIds: ["漏洞讨论"],
      },
      sourceAgentId: "漏洞讨论",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请继续分析。",
    agentMessage:
    [
      "[From 漏洞讨论 Agent]",
      "漏洞讨论当前结论。",
      "",
      "漏洞讨论首条证据。",
    ].join("\n"),
  });
});

test("initialMessage 只注入来源 agent 的首条正文，不会混入后续 action-required-request 反馈", () => {
  const messages = [
    createUserMessage({
      content: "@漏洞讨论 请继续分析。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["漏洞讨论"],
    }),
    createAgentFinalMessage({
      sender: "漏洞讨论",
      content: "漏洞讨论首条证据。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createActionRequiredRequestMessage({
      sender: "漏洞讨论",
      content: "请继续补充第二条证据。\n\n@Build",
      timestamp: "2026-04-16T00:00:01.000Z",
      targetAgentIds: ["Build"],
      followUpMessageId: "漏洞讨论:漏洞讨论首条证据。",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "漏洞讨论当前结论。",
    {
      includeInitialTask: true,
      messageMode: "last",
      initialMessageRouting: {
        mode: "list",
        agentIds: ["漏洞讨论"],
      },
      sourceAgentId: "漏洞讨论",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请继续分析。",
    agentMessage:
    [
      "[From 漏洞讨论 Agent]",
      "漏洞讨论当前结论。",
      "",
      "漏洞讨论首条证据。",
    ].join("\n"),
  });
});

test("首条 agent-progress 早于 agent-final 时，initialMessage 仍应注入 agent-final 正文", () => {
  const messages = [
    createUserMessage({
      content: "@漏洞讨论 请继续分析。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["漏洞讨论"],
    }),
    createAgentProgressMessage({
      sender: "漏洞讨论",
      content: "正在读取文件并整理线索。",
      timestamp: "2026-04-16T00:00:00.500Z",
    }),
    createAgentFinalMessage({
      sender: "漏洞讨论",
      content: "漏洞讨论首条证据。",
      timestamp: "2026-04-16T00:00:01.000Z",
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "漏洞讨论当前结论。",
    {
      includeInitialTask: true,
      messageMode: "last",
      initialMessageRouting: {
        mode: "list",
        agentIds: ["漏洞讨论"],
      },
      sourceAgentId: "漏洞讨论",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请继续分析。",
    agentMessage:
    [
      "[From 漏洞讨论 Agent]",
      "漏洞讨论当前结论。",
      "",
      "漏洞讨论首条证据。",
    ].join("\n"),
  });
});

test("initialMessage 为多个 agent 时，下游会按编译后的来源顺序收到多个来源段落", () => {
  const messages = [
    createUserMessage({
      content: "@线索发现 请继续分析。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["线索发现"],
    }),
    createAgentFinalMessage({
      sender: "线索发现",
      content: "线索发现确认了第一条线索。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "漏洞讨论",
      content: "漏洞讨论给出了第二条证据。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "线索发现",
      content: "线索发现后续又发了一条，不应覆盖首条 initialMessage。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "线索完备性评估准备接手。",
    {
      includeInitialTask: true,
      messageMode: "last",
      initialMessageRouting: {
        mode: "list",
        agentIds: ["线索发现", "漏洞讨论"],
      },
      sourceAgentId: "漏洞讨论",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请继续分析。",
    agentMessage:
    [
      "[From 线索发现 Agent]",
      "线索发现确认了第一条线索。",
      "",
      "[From 漏洞讨论 Agent]",
      "线索完备性评估准备接手。",
      "",
      "漏洞讨论给出了第二条证据。",
    ].join("\n"),
  });
});

test("initialMessage 为空列表时，行为等同于 none", () => {
  const messages = [
    createUserMessage({
      content: "@线索发现 请继续分析。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["线索发现"],
    }),
    createAgentFinalMessage({
      sender: "线索发现",
      content: "线索发现确认了第一条线索。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "线索完备性评估准备接手。",
    {
      includeInitialTask: true,
      messageMode: "none",
      initialMessageRouting: {
        mode: "none",
      },
      sourceAgentId: "线索发现",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, { kind: "empty" });
});

test("initialMessage 为空列表时，不会影响 messageMode=last 的默认转发", () => {
  const messages = [
    createUserMessage({
      content: "@线索发现 请继续分析。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["线索发现"],
    }),
    createAgentFinalMessage({
      sender: "线索发现",
      content: "线索发现确认了第一条线索。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "线索完备性评估准备接手。",
    {
      includeInitialTask: true,
      messageMode: "last",
      initialMessageRouting: {
        mode: "none",
      },
      sourceAgentId: "线索发现",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请继续分析。",
    agentMessage: "[From 线索发现 Agent]\n线索完备性评估准备接手。",
  });
});

test("initialMessage 可以额外注入另一个来源 agent 的首条可转发消息", () => {
  const messages = [
    createUserMessage({
      content: "@Build 初始任务：实现加法工具",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["Build"],
    }),
    createAgentFinalMessage({
      sender: "agent-1",
      content: "agent-1 的历史消息",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "bgent-1",
      content: "bgent-1 的历史消息",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "agent-2",
      content: "agent-2 的历史消息",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "bgent-2",
      content: "bgent-2 的历史消息",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "agent-3",
      content: "agent-3 的上一条消息",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "bgent-3",
      content: "bgent-3 的上一条消息",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "agent-3",
      content: "agent-3 的最后一条消息",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "bgent-3",
      content: "bgent-3 的最后一条消息",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "agent-3 的最后一条消息",
    {
      messageMode: "last",
      includeInitialTask: true,
      initialMessageRouting: {
        mode: "list",
        agentIds: ["bgent-3"],
      },
      sourceAgentId: "agent-3",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "初始任务：实现加法工具",
    agentMessage:
    [
      "[From agent-3 Agent]\nagent-3 的最后一条消息",
      "[From bgent-3 Agent]\nbgent-3 的上一条消息",
    ].join("\n\n"),
  });
});

test("runtime agent 场景下，initialMessage 用模板名也能命中实例消息", () => {
  const messages = [
    createUserMessage({
      content: "@线索发现 请持续挖掘当前代码中的可疑漏洞点。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["线索发现"],
    }),
    createAgentFinalMessage({
      sender: "线索发现",
      content: "线索发现发现了 safe4 的可疑点。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "漏洞挑战-3",
      content: "漏洞挑战-3 认为证据还不够支撑中危结论。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "漏洞论证-3",
      content: "漏洞论证-3 补充了接口可达性与异常触发路径。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];
  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "漏洞论证-3 补充了接口可达性与异常触发路径。",
    {
      messageMode: "last",
      includeInitialTask: true,
      initialMessageRouting: {
        mode: "list",
        agentIds: ["线索发现", "漏洞挑战"],
      },
      sourceAgentId: "漏洞论证-3",
      initialMessageSourceAliasesByAgentId: {
        "线索发现": ["线索发现"],
        "漏洞挑战": ["漏洞挑战", "漏洞挑战-3"],
      },
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请持续挖掘当前代码中的可疑漏洞点。",
    agentMessage:
    [
      "[From 线索发现 Agent]\n线索发现发现了 safe4 的可疑点。",
      "[From 漏洞挑战-3 Agent]\n漏洞挑战-3 认为证据还不够支撑中危结论。",
      "[From 漏洞论证-3 Agent]\n漏洞论证-3 补充了接口可达性与异常触发路径。",
    ].join("\n\n"),
  });
});

test("默认转发只保留当前来源消息", () => {
  const messages = [
    createUserMessage({
      content: "@讨论总结 请给出结论。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["讨论总结"],
    }),
    createAgentFinalMessage({
      sender: "漏洞论证-2",
      content: "漏洞论证-2 本轮新的正方结论。",
      timestamp: "2026-05-07T03:00:00.000Z",
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "漏洞论证-2 本轮新的正方结论。",
    {
      messageMode: "last",
      includeInitialTask: true,
      initialMessageRouting: { mode: "none" },
      sourceAgentId: "漏洞论证-2",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["线索发现", "漏洞挑战", "漏洞论证", "讨论总结"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请给出结论。",
    agentMessage: "[From 漏洞论证-2 Agent]\n漏洞论证-2 本轮新的正方结论。",
  });
});

test("spawn 首轮派发给漏洞论证实例时，initialMessage 会补入静态线索发现消息", () => {
  const messages = [
    createUserMessage({
      content: "@线索发现 RFC 5321 第 2.3.8 节",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["线索发现"],
    }),
    createAgentFinalMessage({
      sender: "线索发现",
      content: "1. 可疑点标题\nSMTP 数据行处理存在一个新的可疑点。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "漏洞挑战-1",
      content: "当前材料更像误报，请继续补充更直接的实现证据。",
      timestamp: "2026-05-07T02:00:01.000Z",
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "当前材料更像误报，请继续补充更直接的实现证据。",
    {
      messageMode: "last",
      includeInitialTask: true,
      initialMessageRouting: {
        mode: "list",
        agentIds: ["线索发现"],
      },
      sourceAgentId: "漏洞挑战-1",
      initialMessageSourceAliasesByAgentId: {
        "线索发现": ["线索发现"],
      },
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "RFC 5321 第 2.3.8 节",
    agentMessage:
    [
      "[From 线索发现 Agent]\n1. 可疑点标题\nSMTP 数据行处理存在一个新的可疑点。",
      "[From 漏洞挑战-1 Agent]\n当前材料更像误报，请继续补充更直接的实现证据。",
    ].join("\n\n"),
  });
});

test("runtime agent 场景下，多个 initialMessage 来源会按编译后的顺序注入", () => {
  const messages = [
    createUserMessage({
      content: "@入口 请继续分析。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["入口"],
    }),
    createAgentFinalMessage({
      sender: "入口",
      content: "入口提供第一条背景材料。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "正方-1",
      content: "正方补充子图内部证据。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "反方-1",
      content: "反方给出当前反驳结论。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];
  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "反方给出当前反驳结论。",
    {
      messageMode: "last",
      includeInitialTask: true,
      initialMessageRouting: {
        mode: "list",
        agentIds: ["入口", "正方"],
      },
      sourceAgentId: "反方-1",
      initialMessageSourceAliasesByAgentId: {
        "入口": ["入口"],
        "正方": ["正方", "正方-1"],
      },
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请继续分析。",
    agentMessage:
    [
      "[From 反方-1 Agent]\n反方给出当前反驳结论。",
      "[From 入口 Agent]\n入口提供第一条背景材料。",
      "[From 正方-1 Agent]\n正方补充子图内部证据。",
    ].join("\n\n"),
  });
});

test("普通正文恰好以 From 标签开头但不符合系统转发格式时，不会被误拆", () => {
  const messages = [
    createUserMessage({
      content: "@A 请继续分析。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["A"],
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "[From 线索发现 Agent] 这里是 agent 自己正文的一部分，不是系统转发块。",
    {
      includeInitialTask: true,
      messageMode: "last",
      initialMessageRouting: { mode: "inherit" },
      sourceAgentId: "A",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请继续分析。",
    agentMessage: "[From A Agent]\n[From 线索发现 Agent] 这里是 agent 自己正文的一部分，不是系统转发块。",
  });
});

test("initialMessage 原始正文恰好以 From 标签开头时，不会被误当成系统转发块拆开", () => {
  const messages = [
    createUserMessage({
      content: "@线索发现 请继续分析。",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["线索发现"],
    }),
    createAgentFinalMessage({
      sender: "线索发现",
      content: "[From 线索发现 Agent] 这是一段普通正文，不是系统转发块。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];

  const forwarded = buildDownstreamForwardedContextFromMessages(
    messages,
    "漏洞讨论准备接手。",
    {
      includeInitialTask: true,
      messageMode: "last",
      initialMessageRouting: {
        mode: "list",
        agentIds: ["线索发现"],
      },
      sourceAgentId: "漏洞讨论",
      initialMessageSourceAliasesByAgentId: {},
      initialMessageForwardedAgentMessageByAgentId: {},
      globalSourceOrder: ["Build", "线索发现", "漏洞讨论", "漏洞挑战", "漏洞论证", "线索完备性评估", "agent-1", "bgent-1", "agent-2", "bgent-2", "agent-3", "bgent-3"],
    },
  );

  assert.deepEqual(forwarded, {
    kind: "forwarded",
    userMessage: "请继续分析。",
    agentMessage:
    [
      "[From 线索发现 Agent]",
      "[From 线索发现 Agent] 这是一段普通正文，不是系统转发块。",
      "",
      "[From 漏洞讨论 Agent]",
      "漏洞讨论准备接手。",
    ].join("\n"),
  });
});


test("群聊消息保留寻址 @Agent，但下游转发读取时会去掉该寻址标记", () => {
  const storedUserContent = buildUserHistoryContent(
    "在当前项目的一个临时文件中实现一个加法工具，调用后传入a和b，返回c @BA",
    "BA",
  );
  const messages = [
    createUserMessage({
      content: storedUserContent,
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["BA"],
    }),
  ];

  const forwardedUserContent = getInitialUserMessageContent(messages);

  assert.equal(messages[0]?.content.includes("@BA"), true);
  assert.equal(forwardedUserContent.includes("@BA"), false);
  assert.equal(forwardedUserContent.includes("返回c"), true);
});

test("单目标消息也只通过 targetAgentIds 数组表达目标", () => {
  const messages = [
    createUserMessage({
      content: "@Build 初始任务：实现加法工具",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["Build"],
    }),
    createActionRequiredRequestMessage({
      sender: "TaskReview",
      content: "请补充实现依据。\n\n@Build",
      timestamp: TEST_TIMESTAMP,
      followUpMessageId: "follow-up-task-review",
      targetAgentIds: ["Build"],
    }),
  ];

  assert.equal(
    getInitialUserMessageContent(messages),
    "初始任务：实现加法工具",
  );
  assert.deepEqual(
    getPersistedCompletionSeedAgentIds({
      topology: createTopologyForTest({
        nodes: ["Build", "TaskReview"],
        edges: [
          {
            source: "TaskReview",
            target: "Build",
            trigger: "<continue>",
            messageMode: "last",
          },
        ],
      }),
      agents: [
        createAgent({ id: "Build", status: "idle", runCount: 0 }),
        createAgent({ id: "TaskReview", status: "completed", runCount: 1 }),
      ],
      messages,
    }),
    ["TaskReview", "Build"],
  );
});

test("旧运行数据里悬空 idle Agent 不会阻止持久化补偿逻辑判定任务结束", () => {
  const topology = createTopologyForTest({
    nodes: [
      "BA",
      "Build",
      "CodeReview",
      "IntegrationTest",
      "TaskReview",
      "UnitTest",
    ],
    edges: [
      {
        source: "BA",
        target: "Build",
        trigger: "<default>",
        messageMode: "last",
      },
      {
        source: "Build",
        target: "UnitTest",
        trigger: "<default>",
        messageMode: "last",
      },
      {
        source: "Build",
        target: "TaskReview",
        trigger: "<default>",
        messageMode: "last",
      },
      {
        source: "Build",
        target: "CodeReview",
        trigger: "<default>",
        messageMode: "last",
      },
    ],
  });
  const agents = [
    createAgent({ id: "BA", status: "completed", runCount: 1 }),
    createAgent({ id: "Build", status: "completed", runCount: 1 }),
    createAgent({ id: "UnitTest", status: "completed", runCount: 1 }),
    createAgent({ id: "TaskReview", status: "completed", runCount: 1 }),
    createAgent({ id: "CodeReview", status: "completed", runCount: 1 }),
    createAgent({ id: "IntegrationTest", status: "idle", runCount: 0 }),
  ];
  const messages = [
    createAgentFinalMessage({
      sender: "Build",
      content: "所有参与的 Agent 都已完成。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
  ];

  const shouldFinish = shouldFinishTaskFromPersistedState({
    taskStatus: "running",
    topology,
    agents,
    messages,
  });

  assert.equal(shouldFinish, true);
});

test("最新一条仍是用户 @Agent 追问时，持久化补偿逻辑不会提前把任务判 finished", () => {
  const topology = createTopologyForTest({
    nodes: ["UnitTest"],
    edges: [],
  });
  const agents = [
    createAgent({ id: "UnitTest", status: "completed", runCount: 1 }),
  ];
  const messages = [
    createUserMessage({
      content: "@UnitTest 你的指责呢",
      timestamp: TEST_TIMESTAMP,
      targetAgentIds: ["UnitTest"],
    }),
  ];

  const shouldFinish = shouldFinishTaskFromPersistedState({
    taskStatus: "running" as TaskStatus,
    topology,
    agents,
    messages,
  });

  assert.equal(shouldFinish, false);
});

test("spawn 运行时实例刚被 dispatch 但尚未完成时，持久化补偿逻辑不会提前把任务判 finished", () => {
  const topology = createTopologyForTest({
    nodes: ["线索发现", "疑点辩论"],
    edges: [
      {
        source: "线索发现",
        target: "疑点辩论",
        trigger: "<default>",
        messageMode: "last",
      },
    ],
  });
  const runtimeAgentId = "漏洞论证-1";
  const agents = [
    createAgent({ id: "线索发现", status: "completed", runCount: 1 }),
    createAgent({ id: runtimeAgentId, status: "idle", runCount: 0 }),
  ];
  const messages = [
    createAgentFinalMessage({
      sender: "线索发现",
      content: "线索发现发现了一个可疑点。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentDispatchMessage({
      sender: "线索发现",
      content: `@${runtimeAgentId}`,
      timestamp: "2026-04-16T00:00:01.000Z",
      targetAgentIds: [runtimeAgentId],
    }),
  ];

  const shouldFinish = shouldFinishTaskFromPersistedState({
    taskStatus: "running",
    topology,
    agents,
    messages,
  });

  assert.equal(shouldFinish, false);
});

test("spawn 运行时实例已写入 dispatch 消息但尚未落库为 task agent 时，持久化补偿逻辑不会提前把任务判 finished", () => {
  const topology = createTopologyForTest({
    nodes: ["线索发现", "疑点辩论"],
    edges: [
      {
        source: "线索发现",
        target: "疑点辩论",
        trigger: "<default>",
        messageMode: "last",
      },
    ],
  });
  const runtimeAgentId = "漏洞论证-1";
  const agents = [
    createAgent({ id: "线索发现", status: "completed", runCount: 1 }),
  ];
  const messages = [
    createAgentFinalMessage({
      sender: "线索发现",
      content: "线索发现发现了一个可疑点。",
      timestamp: TEST_TIMESTAMP,
      routingKind: "default",
    }),
    createAgentDispatchMessage({
      sender: "线索发现",
      content: `@${runtimeAgentId}`,
      timestamp: "2026-04-16T00:00:01.000Z",
      targetAgentIds: [runtimeAgentId],
    }),
  ];

  const shouldFinish = shouldFinishTaskFromPersistedState({
    taskStatus: "running",
    topology,
    agents,
    messages,
  });

  assert.equal(shouldFinish, false);
});

test("decisionAgent 仍处于 action_required 状态时，持久化补偿逻辑不会把中途流程误判为 finished", () => {
  const topology = createTopologyForTest({
    nodes: ["Build", "CodeReview", "UnitTest", "TaskReview"],
    edges: [
      {
        source: "Build",
        target: "CodeReview",
        trigger: "<default>",
        messageMode: "last",
      },
      {
        source: "Build",
        target: "UnitTest",
        trigger: "<default>",
        messageMode: "last",
      },
      {
        source: "Build",
        target: "TaskReview",
        trigger: "<default>",
        messageMode: "last",
      },
      {
        source: "CodeReview",
        target: "Build",
        trigger: "<continue>",
        messageMode: "last",
      },
    ],
  });
  const agents = [
    createAgent({ id: "Build", status: "completed", runCount: 2 }),
    createAgent({ id: "CodeReview", status: "action_required", runCount: 1 }),
    createAgent({ id: "UnitTest", status: "completed", runCount: 1 }),
    createAgent({ id: "TaskReview", status: "completed", runCount: 1 }),
  ];
  const messages = [
    createAgentFinalMessage({
      sender: "Build",
      content: "Build 首轮实现完成。",
      timestamp: "2026-04-24T15:36:15.000Z",
      routingKind: "default",
    }),
    createAgentDispatchMessage({
      sender: "Build",
      content: "@CodeReview @UnitTest @TaskReview",
      targetAgentIds: ["CodeReview", "UnitTest", "TaskReview"],
      timestamp: "2026-04-24T15:36:16.000Z",
    }),
    createActionRequiredRequestMessage({
      sender: "CodeReview",
      content: "还需要继续修改。\n\n@Build",
      followUpMessageId: "follow-up-code-review",
      targetAgentIds: ["Build"],
      timestamp: "2026-04-24T15:36:29.000Z",
    }),
    createAgentFinalMessage({
      sender: "UnitTest",
      content: "测试通过。",
      timestamp: "2026-04-24T15:37:20.000Z",
      routingKind: "default",
    }),
    createAgentFinalMessage({
      sender: "TaskReview",
      content: "可以验收。",
      timestamp: "2026-04-24T15:37:21.000Z",
      routingKind: "default",
    }),
  ];

  const shouldFinish = shouldFinishTaskFromPersistedState({
    taskStatus: "running",
    topology,
    agents,
    messages,
  });

  assert.equal(shouldFinish, false);
});

test("最新一条是 agent-dispatch 时，持久化补偿逻辑不会把重新派发中的任务误判为 finished", () => {
  const topology = createTopologyForTest({
    nodes: ["Build", "CodeReview", "UnitTest", "TaskReview"],
    edges: [
      {
        source: "Build",
        target: "CodeReview",
        trigger: "<default>",
        messageMode: "last",
      },
      {
        source: "Build",
        target: "UnitTest",
        trigger: "<default>",
        messageMode: "last",
      },
      {
        source: "Build",
        target: "TaskReview",
        trigger: "<default>",
        messageMode: "last",
      },
      {
        source: "CodeReview",
        target: "Build",
        trigger: "<continue>",
        messageMode: "last",
      },
      {
        source: "UnitTest",
        target: "Build",
        trigger: "<continue>",
        messageMode: "last",
      },
      {
        source: "TaskReview",
        target: "Build",
        trigger: "<continue>",
        messageMode: "last",
      },
    ],
  });
  const agents = [
    createAgent({ id: "Build", status: "completed", runCount: 3 }),
    createAgent({ id: "CodeReview", status: "completed", runCount: 1 }),
    createAgent({ id: "UnitTest", status: "completed", runCount: 2 }),
    createAgent({ id: "TaskReview", status: "completed", runCount: 1 }),
  ];
  const messages = [
    createAgentFinalMessage({
      sender: "Build",
      content: "Build 已根据 UnitTest 意见修复完成。",
      timestamp: "2026-04-24T15:37:17.000Z",
      routingKind: "default",
    }),
    createAgentDispatchMessage({
      sender: "Build",
      content: "@CodeReview @TaskReview",
      targetAgentIds: ["CodeReview", "TaskReview"],
      timestamp: "2026-04-24T15:37:20.000Z",
    }),
  ];

  const shouldFinish = shouldFinishTaskFromPersistedState({
    taskStatus: "running",
    topology,
    agents,
    messages,
  });

  assert.equal(shouldFinish, false);
});

test("没有消息和运行痕迹时，持久化补偿逻辑只会把 Build 当默认入口 seed", () => {
  const topology = createTopologyForTest({
    nodes: ["BA", "Build", "TaskReview"],
    edges: [
      {
        source: "Build",
        target: "TaskReview",
        trigger: "<default>",
        messageMode: "last",
      },
    ],
  });
  const seedAgentIds = getPersistedCompletionSeedAgentIds({
    topology,
    agents: [
      createAgent({ id: "BA", status: "idle", runCount: 0 }),
      createAgent({ id: "Build", status: "idle", runCount: 0 }),
      createAgent({ id: "TaskReview", status: "idle", runCount: 0 }),
    ],
    messages: [],
  });

  assert.deepEqual(seedAgentIds, ["Build"]);
});

test("过期 decisionAgent 回复不应被当成有效回流继续触发修复", () => {
  const action = resolveActionRequiredRequestContinuationAction({
    continuation: null,
  });

  assert.equal(action, "ignore");
});

test("decisionAgent 已经形成有效回流动作时，不应直接结束 Task", () => {
  const shouldStopTask = shouldStopTaskForUnhandledActionRequiredRequest({
    completeTaskOnFinish: true,
    continuationAction: "trigger_repair_decision",
  });

  assert.equal(shouldStopTask, false);
});

test("decisionAgent 给出需要修复时应标记为 action_required 而不是 failed", () => {
  const status = resolveAgentStatusFromRouting({
    routingKind: "labeled",
    decisionAgent: true,
    enteredActionRequired: true,
  });

  assert.equal(status, "action_required");
});

test("decisionAgent 缺少强制标签时应标记为 failed", () => {
  const status = resolveAgentStatusFromRouting({
    routingKind: "invalid",
    decisionAgent: true,
    enteredActionRequired: false,
  });

  assert.equal(status, "failed");
});

test("非拓扑驱动的单次执行后，仍有未完成 Agent 时任务进入 finished", () => {
  const status = resolveStandaloneTaskStatusAfterAgentRun({
    latestAgentStatus: "completed",
    agentStatuses: [
      createAgent({ id: "Build", status: "completed", runCount: 1 }),
      createAgent({ id: "QA", status: "idle", runCount: 0 }),
    ],
  });

  assert.equal(status, "finished");
});

test("非拓扑驱动的单次执行后，全部 Agent 已完成时任务进入 finished", () => {
  const status = resolveStandaloneTaskStatusAfterAgentRun({
    latestAgentStatus: "completed",
    agentStatuses: [
      createAgent({ id: "Build", status: "completed", runCount: 1 }),
      createAgent({ id: "QA", status: "completed", runCount: 1 }),
    ],
  });

  assert.equal(status, "finished");
});

test("非拓扑驱动的单次执行失败时任务直接进入 failed", () => {
  const status = resolveStandaloneTaskStatusAfterAgentRun({
    latestAgentStatus: "failed",
    agentStatuses: [
      createAgent({ id: "Build", status: "failed", runCount: 1 }),
      createAgent({ id: "QA", status: "idle", runCount: 0 }),
    ],
  });

  assert.equal(status, "failed");
});

test("任务失败完成消息优先展示明确失败原因", () => {
  const content = buildTaskCompletionMessageContent({
    status: "failed",
    taskTitle: "演示任务",
    failureReason: "UnitTest -> Build 已连续交流 4 次，任务已结束",
  });

  assert.equal(content, "UnitTest -> Build 已连续交流 4 次，任务已结束");
});
