import test from "node:test";
import assert from "node:assert/strict";

import { act } from "react";

import type { TaskSnapshot, TopologyRecord, WorkspaceSnapshot } from "@shared/types";
import { renderTopologyGraphInDom } from "../../test-support/components/topology-graph-dom";
import { toUtcIsoTimestamp } from "@shared/types";

const TASK_ID = "task-runtime-refresh";
const WORKSPACE_CWD = "/tmp/agent-team-topology-runtime-refresh";

const topology: TopologyRecord = {
  nodes: ["线索发现", "漏洞挑战"],
  edges: [],
  nodeRecords: [
    { id: "线索发现", kind: "agent", templateName: "线索发现", initialMessageRouting: { mode: "inherit" } },
    { id: "漏洞挑战", kind: "agent", templateName: "漏洞挑战", initialMessageRouting: { mode: "inherit" } },
    { id: "疑点辩论", kind: "group", templateName: "漏洞挑战", groupRuleId: "group-rule:疑点辩论", initialMessageRouting: { mode: "inherit" } },
  ],
  groupRules: [
    {
      id: "group-rule:疑点辩论",
      groupNodeName: "疑点辩论",
      sourceTemplateName: "线索发现",
      entryRole: "challenge",
      members: [
        { role: "challenge", templateName: "漏洞挑战" },
      ],
      edges: [],
      exitWhen: "all_completed",
      report: false,
    },
  ],
};

const workspace: WorkspaceSnapshot = {
  cwd: WORKSPACE_CWD,
  name: "topology-runtime-refresh",
  agents: [
    { id: "线索发现", prompt: "发现线索", isWritable: false },
    { id: "漏洞挑战", prompt: "挑战线索", isWritable: false },
  ],
  topology,
  messages: [],
  tasks: [],
};

function createTask(input: {
  taskStatus: TaskSnapshot["task"]["status"];
  agents: TaskSnapshot["agents"];
  messages: TaskSnapshot["messages"];
}): TaskSnapshot {
  return {
    task: {
      id: TASK_ID,
      title: "runtime refresh",
      status: input.taskStatus,
      cwd: WORKSPACE_CWD,
      agentCount: input.agents.length,
      createdAt: "2026-04-29T10:00:00.000Z",
      completedAt: "",
      initializedAt: "2026-04-29T10:00:00.000Z",
    },
    agents: input.agents,
    messages: input.messages,
    topology,
  };
}

function findAttachButton(agentId: string) {
  return document.querySelector(`button[aria-label="打开 ${agentId} 的 attach 终端"]`);
}

test("TopologyGraph 会把静态模板节点刷新成最新 runtime agent，并保持 attach 可点击", async () => {
  const firstRoundTask = createTask({
    taskStatus: "running",
    agents: [
      {
        id: "线索发现",
        taskId: TASK_ID,
        opencodeSessionId: "session-clue",
        opencodeAttachBaseUrl: "http://localhost:4310",
        status: "completed",
        runCount: 1,
      },
      {
        id: "漏洞挑战-1",
        taskId: TASK_ID,
        opencodeSessionId: "session-challenge-1",
        opencodeAttachBaseUrl: "http://localhost:4310",
        status: "completed",
        runCount: 1,
      },
    ],
    messages: [],
  });
  const secondRoundTask = createTask({
    taskStatus: "running",
    agents: [
      ...firstRoundTask.agents,
      {
        id: "漏洞挑战-2",
        taskId: TASK_ID,
        opencodeSessionId: "session-challenge-2",
        opencodeAttachBaseUrl: "http://localhost:4310",
        status: "running",
        runCount: 1,
      },
    ],
    messages: [],
  });

  const rendered = await renderTopologyGraphInDom({
    workspace,
    task: firstRoundTask,
    openingAgentTerminalId: "",
    onToggleMaximize: () => {},
    onOpenAgentTerminal: () => {},
  });

  try {
    await act(async () => {
      await rendered.flushAnimationFrames();
    });

    const firstRoundAttachButton = findAttachButton("漏洞挑战-1");
    assert.ok(firstRoundAttachButton instanceof HTMLButtonElement, "应展示第一轮 runtime agent 的 attach 按钮");
    assert.equal(firstRoundAttachButton.disabled, false);
    assert.equal(findAttachButton("漏洞挑战"), null);

    await rendered.render({
      workspace,
      task: secondRoundTask,
      openingAgentTerminalId: "",
      onToggleMaximize: () => {},
      onOpenAgentTerminal: () => {},
    });
    await act(async () => {
      await rendered.flushAnimationFrames();
    });

    const secondRoundAttachButton = findAttachButton("漏洞挑战-2");
    assert.ok(secondRoundAttachButton instanceof HTMLButtonElement, "应切换到最新 runtime agent 的 attach 按钮");
    assert.equal(secondRoundAttachButton.disabled, false);
    assert.equal(secondRoundAttachButton.title, "attach 到 漏洞挑战-2");
    assert.equal(findAttachButton("漏洞挑战"), null);
  } finally {
    await rendered.cleanup();
  }
});

test("task snapshot 尚未带上 session 时，TopologyGraph 不会启用 attach", async () => {
  const task = createTask({
    taskStatus: "running",
    agents: [
      {
        id: "线索发现",
        taskId: TASK_ID,
        opencodeSessionId: "session-clue",
        opencodeAttachBaseUrl: "http://localhost:4310",
        status: "completed",
        runCount: 1,
      },
      {
        id: "漏洞挑战-2",
        taskId: TASK_ID,
        opencodeSessionId: "",
        opencodeAttachBaseUrl: "",
        status: "running",
        runCount: 1,
      },
    ],
    messages: [],
  });

  const rendered = await renderTopologyGraphInDom({
    workspace,
    task,
    openingAgentTerminalId: "",
    onToggleMaximize: () => {},
    onOpenAgentTerminal: () => {},
  });

  try {
    await act(async () => {
      await rendered.flushAnimationFrames();
    });

    const attachButton = findAttachButton("漏洞挑战-2");
    assert.ok(attachButton instanceof HTMLButtonElement, "应展示已运行 agent 的 attach 按钮");
    assert.equal(attachButton.disabled, true);
    assert.equal(attachButton.title, "漏洞挑战-2 当前还没有可 attach 的 OpenCode session。");
  } finally {
    await rendered.cleanup();
  }
});

test("TopologyGraph 会继续展示刚完成的运行实例", async () => {
  const task = createTask({
    taskStatus: "running",
    agents: [
      {
        id: "线索发现",
        taskId: TASK_ID,
        opencodeSessionId: "session-clue",
        opencodeAttachBaseUrl: "http://localhost:4310",
        status: "completed",
        runCount: 1,
      },
      {
        id: "漏洞挑战-1",
        taskId: TASK_ID,
        opencodeSessionId: "session-challenge-1",
        opencodeAttachBaseUrl: "http://localhost:4310",
        status: "completed",
        runCount: 1,
      },
    ],
    messages: [
      {
        id: "challenge-final",
        taskId: TASK_ID,
        sender: "漏洞挑战-1",
        content: "漏洞挑战-1 已经完成本轮回应。",
        timestamp: toUtcIsoTimestamp("2026-04-29T10:00:02.000Z"),
        kind: "agent-final",
        runCount: 1,
        status: "completed",
        routingKind: "default",
        responseNote: "",
        rawResponse: "漏洞挑战-1 已经完成本轮回应。",
      },
    ],
  });

  const rendered = await renderTopologyGraphInDom({
    workspace,
    task,
    openingAgentTerminalId: "",
    onToggleMaximize: () => {},
    onOpenAgentTerminal: () => {},
  });

  try {
    await act(async () => {
      await rendered.flushAnimationFrames();
    });

    const attachButton = findAttachButton("漏洞挑战-1");
    assert.ok(attachButton instanceof HTMLButtonElement, "刚完成的 runtime agent 仍应保留在拓扑里");
    assert.equal(attachButton.disabled, false);
    assert.equal(rendered.window.document.body.textContent?.includes("漏洞挑战-1 已经完成本轮回应。"), true);
  } finally {
    await rendered.cleanup();
  }
});

test("TopologyGraph 仅展示最后一条最终消息，不展示过程消息", async () => {
  const task = createTask({
    taskStatus: "running",
    agents: [
      {
        id: "线索发现",
        taskId: TASK_ID,
        opencodeSessionId: "session-clue",
        opencodeAttachBaseUrl: "http://localhost:4310",
        status: "running",
        runCount: 1,
      },
    ],
    messages: [
      {
        id: "runtime-tool",
        taskId: TASK_ID,
        sender: "线索发现",
        content: "读取工具文件",
        timestamp: toUtcIsoTimestamp("2026-04-29T10:00:28.000Z"),
        kind: "agent-progress",
        activityKind: "tool",
        label: "read_file",
        detail: "参数: hidden.ts",
        detailState: "complete",
        sessionId: "session-clue",
        runCount: 1,
      },
      {
        id: "runtime-final-first",
        taskId: TASK_ID,
        sender: "线索发现",
        content: "第一条最终结果消息",
        timestamp: toUtcIsoTimestamp("2026-04-29T10:00:29.000Z"),
        kind: "agent-final",
        runCount: 1,
        status: "completed",
        routingKind: "default",
        responseNote: "",
        rawResponse: "第一条最终结果消息",
      },
      {
        id: "runtime-final-last",
        taskId: TASK_ID,
        sender: "线索发现",
        content: "最后一条最终结果消息",
        timestamp: toUtcIsoTimestamp("2026-04-29T10:00:30.000Z"),
        kind: "agent-final",
        runCount: 1,
        status: "completed",
        routingKind: "default",
        responseNote: "",
        rawResponse: "最后一条最终结果消息",
      },
    ],
  });

  const rendered = await renderTopologyGraphInDom({
    workspace,
    task,
    openingAgentTerminalId: "",
    onToggleMaximize: () => {},
    onOpenAgentTerminal: () => {},
  });

  try {
    await act(async () => {
      await rendered.flushAnimationFrames();
    });

    const pageText = rendered.window.document.body.textContent ?? "";
    assert.equal(pageText.includes("参数: hidden.ts"), false);
    assert.equal(pageText.includes("第一条最终结果消息"), false);
    assert.equal(pageText.includes("最后一条最终结果消息"), true);
  } finally {
    await rendered.cleanup();
  }
});

test("TopologyGraph 会按时间戳选择最后一条最终消息，而不是依赖消息数组顺序", async () => {
  const task = createTask({
    taskStatus: "running",
    agents: [
      {
        id: "线索发现",
        taskId: TASK_ID,
        opencodeSessionId: "session-clue",
        opencodeAttachBaseUrl: "http://localhost:4310",
        status: "completed",
        runCount: 1,
      },
    ],
    messages: [
      {
        id: "runtime-final-latest",
        taskId: TASK_ID,
        sender: "线索发现",
        content: "时间更晚的最终消息",
        timestamp: toUtcIsoTimestamp("2026-04-29T10:00:31.000Z"),
        kind: "agent-final",
        runCount: 1,
        status: "completed",
        routingKind: "default",
        responseNote: "",
        rawResponse: "时间更晚的最终消息",
      },
      {
        id: "runtime-final-earlier",
        taskId: TASK_ID,
        sender: "线索发现",
        content: "时间更早的最终消息",
        timestamp: toUtcIsoTimestamp("2026-04-29T10:00:30.000Z"),
        kind: "agent-final",
        runCount: 1,
        status: "completed",
        routingKind: "default",
        responseNote: "",
        rawResponse: "时间更早的最终消息",
      },
    ],
  });

  const rendered = await renderTopologyGraphInDom({
    workspace,
    task,
    openingAgentTerminalId: "",
    onToggleMaximize: () => {},
    onOpenAgentTerminal: () => {},
  });

  try {
    await act(async () => {
      await rendered.flushAnimationFrames();
    });

    const pageText = rendered.window.document.body.textContent ?? "";
    assert.equal(pageText.includes("时间更晚的最终消息"), true);
    assert.equal(pageText.includes("时间更早的最终消息"), false);
  } finally {
    await rendered.cleanup();
  }
});

test("TopologyGraph 运行中且尚无最终消息时展示固定提示", async () => {
  const task = createTask({
    taskStatus: "running",
    agents: [
      {
        id: "线索发现",
        taskId: TASK_ID,
        opencodeSessionId: "session-clue",
        opencodeAttachBaseUrl: "http://localhost:4310",
        status: "running",
        runCount: 1,
      },
    ],
    messages: [
      {
        id: "runtime-tool-only",
        taskId: TASK_ID,
        sender: "线索发现",
        content: "读取工具文件",
        timestamp: toUtcIsoTimestamp("2026-04-29T10:00:28.000Z"),
        kind: "agent-progress",
        activityKind: "tool",
        label: "read_file",
        detail: "参数: hidden.ts",
        detailState: "complete",
        sessionId: "session-clue",
        runCount: 1,
      },
    ],
  });

  const rendered = await renderTopologyGraphInDom({
    workspace,
    task,
    openingAgentTerminalId: "",
    onToggleMaximize: () => {},
    onOpenAgentTerminal: () => {},
  });

  try {
    await act(async () => {
      await rendered.flushAnimationFrames();
    });

    const pageText = rendered.window.document.body.textContent ?? "";
    assert.equal(pageText.includes("参数: hidden.ts"), false);
    assert.equal(pageText.includes("正在执行，暂无结果"), true);
  } finally {
    await rendered.cleanup();
  }
});

test("TopologyGraph 会把已完成但尚未同步最终消息的运行中任务标记为等待同步", async () => {
  const task = createTask({
    taskStatus: "running",
    agents: [
      {
        id: "线索发现",
        taskId: TASK_ID,
        opencodeSessionId: "session-clue",
        opencodeAttachBaseUrl: "http://localhost:4310",
        status: "completed",
        runCount: 1,
      },
    ],
    messages: [],
  });

  const rendered = await renderTopologyGraphInDom({
    workspace,
    task,
    openingAgentTerminalId: "",
    onToggleMaximize: () => {},
    onOpenAgentTerminal: () => {},
  });

  try {
    await act(async () => {
      await rendered.flushAnimationFrames();
    });

    const pageText = rendered.window.document.body.textContent ?? "";
    assert.equal(pageText.includes("等待最终结果同步"), true);
  } finally {
    await rendered.cleanup();
  }
});

test("TopologyGraph 不再展示节点全屏与详情交互", async () => {
  const task = createTask({
    taskStatus: "running",
    agents: [
      {
        id: "线索发现",
        taskId: TASK_ID,
        opencodeSessionId: "session-clue",
        opencodeAttachBaseUrl: "http://localhost:4310",
        status: "completed",
        runCount: 1,
      },
    ],
    messages: [
      {
        id: "runtime-final",
        taskId: TASK_ID,
        sender: "线索发现",
        content: "最终结果消息",
        timestamp: toUtcIsoTimestamp("2026-04-29T10:00:30.000Z"),
        kind: "agent-final",
        runCount: 1,
        status: "completed",
        routingKind: "default",
        responseNote: "",
        rawResponse: "最终结果消息",
      },
    ],
  });

  const rendered = await renderTopologyGraphInDom({
    workspace,
    task,
    openingAgentTerminalId: "",
    onToggleMaximize: () => {},
    onOpenAgentTerminal: () => {},
  });

  try {
    await act(async () => {
      await rendered.flushAnimationFrames();
    });

    assert.equal(
      rendered.window.document.querySelector('[aria-label="展开查看 线索发现 详情"]'),
      null,
    );
    assert.equal(
      rendered.window.document.querySelector('[aria-label="线索发现 全屏详情"]'),
      null,
    );
    assert.equal(
      rendered.window.document.querySelector('[aria-label="线索发现 历史详情"]'),
      null,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("TopologyGraph 遇到非运行态却缺少最终消息时直接报错", async () => {
  await assert.rejects(
    () =>
      renderTopologyGraphInDom({
        workspace,
        task: createTask({
          taskStatus: "running",
          agents: [
            {
              id: "线索发现",
              taskId: TASK_ID,
              opencodeSessionId: "session-clue",
              opencodeAttachBaseUrl: "http://localhost:4310",
              status: "failed",
              runCount: 1,
            },
          ],
          messages: [],
        }),
        openingAgentTerminalId: "",
        onToggleMaximize: () => {},
        onOpenAgentTerminal: () => {},
      }),
    /拓扑节点 线索发现 在任务状态 running、Agent 状态 failed 下缺少最终消息/u,
  );
});

test("TopologyGraph 遇到任务已结束但 agent 仍缺少最终消息时直接报错", async () => {
  await assert.rejects(
    () =>
      renderTopologyGraphInDom({
        workspace,
        task: createTask({
          taskStatus: "finished",
          agents: [
            {
              id: "线索发现",
              taskId: TASK_ID,
              opencodeSessionId: "session-clue",
              opencodeAttachBaseUrl: "http://localhost:4310",
              status: "running",
              runCount: 1,
            },
          ],
          messages: [],
        }),
        openingAgentTerminalId: "",
        onToggleMaximize: () => {},
        onOpenAgentTerminal: () => {},
      }),
    /拓扑节点 线索发现 在任务状态 finished、Agent 状态 running 下缺少最终消息/u,
  );
});

test("TopologyGraph 遇到相同最终时间戳的多条消息时直接报错", async () => {
  await assert.rejects(
    () =>
      renderTopologyGraphInDom({
        workspace,
        task: createTask({
          taskStatus: "running",
          agents: [
            {
              id: "线索发现",
              taskId: TASK_ID,
              opencodeSessionId: "session-clue",
              opencodeAttachBaseUrl: "http://localhost:4310",
              status: "completed",
              runCount: 1,
            },
          ],
          messages: [
            {
              id: "runtime-final-1",
              taskId: TASK_ID,
              sender: "线索发现",
              content: "最终结果一",
              timestamp: toUtcIsoTimestamp("2026-04-29T10:00:30.000Z"),
              kind: "agent-final",
              runCount: 1,
              status: "completed",
              routingKind: "default",
              responseNote: "",
              rawResponse: "最终结果一",
            },
            {
              id: "runtime-final-2",
              taskId: TASK_ID,
              sender: "线索发现",
              content: "最终结果二",
              timestamp: toUtcIsoTimestamp("2026-04-29T10:00:30.000Z"),
              kind: "agent-final",
              runCount: 1,
              status: "completed",
              routingKind: "default",
              responseNote: "",
              rawResponse: "最终结果二",
            },
          ],
        }),
        openingAgentTerminalId: "",
        onToggleMaximize: () => {},
        onOpenAgentTerminal: () => {},
      }),
    /Agent 线索发现 存在多条相同最终时间戳的消息，无法确定最后结果/u,
  );
});
