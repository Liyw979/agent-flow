import test from "node:test";
import assert from "node:assert/strict";
import { resolveChatMessageAttachButtonState } from "./chat-attach-button";

test("resolveChatMessageAttachButtonState 会为 agent 消息生成可点击的 attach 状态", () => {
  const state = resolveChatMessageAttachButtonState({
    sender: "漏洞挑战-3",
    openingAgentTerminalId: "",
    runtimeSnapshots: {},
    taskAgents: [
      {
        id: "漏洞挑战-3",
        opencodeSessionId: "session-3",
      },
    ],
  });

  assert.deepEqual(state, {
    visible: true,
    agentId: "漏洞挑战-3",
    disabled: false,
    title: "attach 到 漏洞挑战-3",
    label: "attach",
  });
});

test("resolveChatMessageAttachButtonState 会在 session 缺失时保留禁用态文案", () => {
  const state = resolveChatMessageAttachButtonState({
    sender: "漏洞挑战-3",
    openingAgentTerminalId: "",
    runtimeSnapshots: {},
    taskAgents: [
      {
        id: "漏洞挑战-3",
        opencodeSessionId: null,
      },
    ],
  });

  assert.deepEqual(state, {
    visible: true,
    agentId: "漏洞挑战-3",
    disabled: true,
    title: "漏洞挑战-3 当前还没有可 attach 的 OpenCode session。",
    label: "attach",
  });
});

test("resolveChatMessageAttachButtonState 会优先采用 runtime snapshot 的 sessionId，避免必须手动刷新页面后 attach 才可点击", () => {
  const state = resolveChatMessageAttachButtonState({
    sender: "漏洞挑战-3",
    openingAgentTerminalId: "",
    taskAgents: [
      {
        id: "漏洞挑战-3",
        opencodeSessionId: null,
      },
    ],
    runtimeSnapshots: {
      "漏洞挑战-3": {
        sessionId: "session-3",
      },
    },
  });

  assert.deepEqual(state, {
    visible: true,
    agentId: "漏洞挑战-3",
    disabled: false,
    title: "attach 到 漏洞挑战-3",
    label: "attach",
  });
});

test("resolveChatMessageAttachButtonState 不会给 user 或 system 消息渲染 attach", () => {
  assert.deepEqual(resolveChatMessageAttachButtonState({
    sender: "user",
    openingAgentTerminalId: "",
    runtimeSnapshots: {},
    taskAgents: [],
  }), {
    visible: false,
  });

  assert.deepEqual(resolveChatMessageAttachButtonState({
    sender: "system",
    openingAgentTerminalId: "",
    runtimeSnapshots: {},
    taskAgents: [],
  }), {
    visible: false,
  });
});

test("resolveChatMessageAttachButtonState 会为正在打开的 agent 显示打开中文案", () => {
  const state = resolveChatMessageAttachButtonState({
    sender: "漏洞挑战-3",
    openingAgentTerminalId: "漏洞挑战-3",
    runtimeSnapshots: {},
    taskAgents: [
      {
        id: "漏洞挑战-3",
        opencodeSessionId: "session-3",
      },
    ],
  });

  assert.deepEqual(state, {
    visible: true,
    agentId: "漏洞挑战-3",
    disabled: true,
    title: "正在打开 漏洞挑战-3 的 attach 终端",
    label: "打开中",
  });
});
