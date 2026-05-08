import test from "node:test";
import assert from "node:assert/strict";
import {
  formatActionRequiredRequestContent,
  parseTargetAgentIds,
} from "./chat-message-format";

test("聊天消息格式化会清理目标列表里的空白项，并追加规范化的 @ 提及", () => {
  assert.deepEqual(parseTargetAgentIds([" Build ", "", "  QA  "]), ["Build", "QA"]);
  assert.equal(
    formatActionRequiredRequestContent("@Build\n\n请继续推进", [" Build ", "", "QA "]),
    "请继续推进\n\n@Build @QA",
  );
});
