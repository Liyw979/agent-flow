import test from "node:test";
import assert from "node:assert/strict";

import { act } from "react";

import type { AgentRuntimeSnapshot, TaskSnapshot, TopologyRecord, WorkspaceSnapshot } from "@shared/types";

import { renderTopologyGraphInDom } from "./topology-graph.test-helpers";

const TASK_ID = "task-runtime-refresh";
const WORKSPACE_CWD = "/tmp/agent-team-topology-runtime-refresh";

type SessionFixtureState =
  | {
      kind: "present";
      sessionId: string;
    }
  | {
      kind: "absent";
    };

const topology: TopologyRecord = {
  nodes: ["线索发现", "漏洞挑战"],
  edges: [],
  nodeRecords: [
    { id: "线索发现", kind: "agent", templateName: "线索发现" },
    { id: "漏洞挑战", kind: "agent", templateName: "漏洞挑战" },
    { id: "疑点辩论", kind: "spawn", templateName: "漏洞挑战", spawnRuleId: "spawn-rule:疑点辩论" },
  ],
  spawnRules: [
    {
      id: "spawn-rule:疑点辩论",
      spawnNodeName: "疑点辩论",
      sourceTemplateName: "线索发现",
      entryRole: "challenge",
      spawnedAgents: [
        { role: "challenge", templateName: "漏洞挑战" },
      ],
      edges: [],
      exitWhen: "all_completed",
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
  agents: TaskSnapshot["agents"];
}): TaskSnapshot {
  return {
    task: {
      id: TASK_ID,
      title: "runtime refresh",
      status: "running",
      cwd: WORKSPACE_CWD,
      opencodeSessionId: null,
      agentCount: input.agents.length,
      createdAt: "2026-04-29T10:00:00.000Z",
      completedAt: null,
      initializedAt: "2026-04-29T10:00:00.000Z",
    },
    agents: input.agents,
    messages: [],
    topology,
  };
}

function createRuntimeSnapshots(input: Record<string, SessionFixtureState>): Record<string, AgentRuntimeSnapshot> {
  return Object.fromEntries(
    Object.entries(input).map(([agentId, session]) => [
      agentId,
      {
        taskId: TASK_ID,
        agentId,
        sessionId: session.kind === "present" ? session.sessionId : null,
        status: "running",
        runtimeStatus: "running",
        messageCount: 1,
        updatedAt: "2026-04-29T10:00:01.000Z",
        headline: `${agentId} 正在处理`,
        activeToolNames: [],
        activities: [
          {
            id: `${agentId}-thinking`,
            kind: "thinking",
            label: "思考",
            detail: `${agentId} 正在处理当前输入`,
            timestamp: "2026-04-29T10:00:01.000Z",
          },
        ],
      },
    ]),
  );
}

function findAttachButton(agentId: string) {
  return document.querySelector(`button[aria-label="打开 ${agentId} 的 attach 终端"]`);
}

test("TopologyGraph 会把静态模板节点刷新成最新 runtime agent，并保持 attach 可点击", async () => {
  const firstRoundTask = createTask({
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
  });
  const secondRoundTask = createTask({
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
  });

  const rendered = await renderTopologyGraphInDom({
    workspace,
    task: firstRoundTask,
    selectedAgentId: null,
    openingAgentTerminalId: "",
    runtimeSnapshots: createRuntimeSnapshots({
      "漏洞挑战-1": {
        kind: "present",
        sessionId: "session-challenge-1",
      },
    }),
    onSelectAgent: () => {},
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
      selectedAgentId: null,
      openingAgentTerminalId: "",
      runtimeSnapshots: createRuntimeSnapshots({
        "漏洞挑战-2": {
          kind: "present",
          sessionId: "session-challenge-2",
        },
      }),
      onSelectAgent: () => {},
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

test("task snapshot 尚未带上 session 时，TopologyGraph 仍会采用 runtime snapshot 的结果启用 attach", async () => {
  const task = createTask({
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
        opencodeSessionId: null,
        opencodeAttachBaseUrl: null,
        status: "running",
        runCount: 1,
      },
    ],
  });

  const rendered = await renderTopologyGraphInDom({
    workspace,
    task,
    selectedAgentId: null,
    openingAgentTerminalId: "",
    runtimeSnapshots: createRuntimeSnapshots({
      "漏洞挑战-2": {
        kind: "present",
        sessionId: "session-challenge-2",
      },
    }),
    onSelectAgent: () => {},
    onToggleMaximize: () => {},
    onOpenAgentTerminal: () => {},
  });

  try {
    await act(async () => {
      await rendered.flushAnimationFrames();
    });

    const attachButton = findAttachButton("漏洞挑战-2");
    assert.ok(attachButton instanceof HTMLButtonElement, "应展示 runtime snapshot 驱动的 attach 按钮");
    assert.equal(attachButton.disabled, false);
    assert.equal(attachButton.title, "attach 到 漏洞挑战-2");
  } finally {
    await rendered.cleanup();
  }
});
