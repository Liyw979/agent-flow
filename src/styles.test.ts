import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const STYLES_SOURCE = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("运行时 chat markdown 的 strong 样式必须显式加粗，不能继续继承正文权重", () => {
  assert.match(STYLES_SOURCE, /\.chat-markdown strong \{[\s\S]*font-weight: 700;/);
  assert.doesNotMatch(STYLES_SOURCE, /\.chat-markdown strong \{[\s\S]*font-weight: inherit;/);
});
