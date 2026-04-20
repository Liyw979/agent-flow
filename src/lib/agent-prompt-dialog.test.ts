import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentPromptDialogState } from "./agent-prompt-dialog";

test("buildAgentPromptDialogState 会为普通 agent 返回 prompt 详情", () => {
  assert.deepEqual(
    buildAgentPromptDialogState({
      agentName: "CodeReview",
      prompt: "你负责审查代码改动。",
    }),
    {
      agentName: "CodeReview",
      promptSourceLabel: "System Prompt",
      content: "你负责审查代码改动。",
    },
  );
});

test("buildAgentPromptDialogState 会为空字符串 prompt 返回由 OpenCode 读取说明", () => {
  assert.deepEqual(
    buildAgentPromptDialogState({
      agentName: "Build",
      prompt: "",
    }),
    {
      agentName: "Build",
      promptSourceLabel: "由 OpenCode 读取",
      content: "当前拓扑配置里的 prompt 为空字符串，运行时会改为由 OpenCode 读取该 Agent 的提示词。",
    },
  );
});
