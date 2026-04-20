import test from "node:test";
import assert from "node:assert/strict";

import { renderAgentHistoryDetailToStaticHtml } from "./agent-history-markdown";

test("拓扑历史详情会把 Markdown 渲染成 HTML", () => {
  const html = renderAgentHistoryDetailToStaticHtml("**已验证**\n\n- 补充断言");

  assert.match(html, /<span data-chat-markdown-role="strong">已验证<\/span>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>补充断言<\/li>/);
});

test("拓扑历史 Markdown 保留拓扑自身字号，而不是被聊天 Markdown 的内联字号覆盖", () => {
  const html = renderAgentHistoryDetailToStaticHtml("已验证");

  assert.doesNotMatch(html, /--chat-markdown-font-size:/);
  assert.doesNotMatch(html, /--chat-markdown-line-height:/);
});
