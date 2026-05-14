import { test } from "bun:test";
import assert from "node:assert/strict";

import { getAgentPanelColorToken } from "./agent-panel-colors";

test("getAgentPanelColorToken 使用 Electron 成员面板同款角色配色", () => {
  assert.deepEqual(getAgentPanelColorToken("BA"), {
    background: "#F4EED4",
    border: "#B8A64B",
  });
  assert.deepEqual(getAgentPanelColorToken("Build"), {
    background: "#DDD7EE",
    border: "#B7AFE8",
  });
  assert.deepEqual(getAgentPanelColorToken("CodeReview"), {
    background: "#F4E0D4",
    border: "#E4B18F",
  });
  assert.deepEqual(getAgentPanelColorToken("UnitTest"), {
    background: "#DCDDFA",
    border: "#AEB7F2",
  });
  assert.deepEqual(getAgentPanelColorToken("TaskReview"), {
    background: "#F4E0D4",
    border: "#E4B18F",
  });
});

test("getAgentPanelColorToken 对未知 Agent 仍返回稳定兜底配色", () => {
  assert.deepEqual(getAgentPanelColorToken("Unknown Agent"), getAgentPanelColorToken("Unknown Agent"));
});
