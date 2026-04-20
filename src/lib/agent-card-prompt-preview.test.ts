import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentCardPromptPreview } from "./agent-card-prompt-preview";

test("buildAgentCardPromptPreview 会把普通 agent 的 prompt 压成单行缩略", () => {
  assert.equal(
    buildAgentCardPromptPreview({
      agentName: "CodeReview",
      prompt: "你负责\n审查代码改动。",
    }),
    "你负责审查代码改动。",
  );
});

test("buildAgentCardPromptPreview 会把空拓扑配置显示成由 OpenCode 读取", () => {
  assert.equal(
    buildAgentCardPromptPreview({
      agentName: "Build",
      prompt: "",
    }),
    "由 OpenCode 读取",
  );

  assert.equal(
    buildAgentCardPromptPreview({
      agentName: "CodeReview",
      prompt: "",
    }),
    "由 OpenCode 读取",
  );
});
