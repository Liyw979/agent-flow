import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdownToStaticHtml } from "./chat-markdown";

test("renderMarkdownToStaticHtml 会把标题列表和代码块渲染成 HTML", () => {
  const html = renderMarkdownToStaticHtml("## 已完成\n\n- 补充测试\n- 修复渲染\n\n```ts\nconst done = true;\n```");

  assert.match(html, /<p data-chat-markdown-role="heading">已完成<\/p>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>补充测试<\/li>/);
  assert.match(html, /<pre>/);
  assert.match(html, /<code/);
  assert.match(html, /--chat-markdown-block-spacing:0\.1625em/);
  assert.match(html, /--chat-markdown-list-item-spacing:0\.06rem/);
  assert.match(html, /--chat-markdown-font-size:0\.875rem/);
  assert.match(html, /--chat-markdown-heading-font-size:1em/);
  assert.match(html, /--chat-markdown-code-font-size:1em/);
});

test("renderMarkdownToStaticHtml 会内联统一字号和压缩后的行高规则", () => {
  const html = renderMarkdownToStaticHtml("## 标题\n\n- 列表项\n\n`code`");

  assert.match(html, /--chat-markdown-line-height:1\.36em/);
  assert.match(html, /<style>/);
  assert.match(html, /\.chat-markdown :is\(h1, h2, h3, h4, h5, h6, p, li, blockquote, th, td\)\s*\{\s*font-size: var\(--chat-markdown-font-size\);/);
  assert.match(html, /\.chat-markdown :is\(h1, h2, h3, h4, h5, h6, p, li, blockquote, th, td\)\s*\{[^}]*line-height: var\(--chat-markdown-line-height\);/);
});

test("renderMarkdownToStaticHtml 会压缩代码块上下内边距，避免代码块内部留白过大", () => {
  const html = renderMarkdownToStaticHtml("```py\ndef add(a, b):\n    return a + b\n```");

  assert.match(html, /\.chat-markdown pre \{[^}]*padding: 0\.3rem 0\.65rem;/);
});

test("renderMarkdownToStaticHtml 会把标题降级成普通文本，但保留 strong 的加粗语义", () => {
  const html = renderMarkdownToStaticHtml("## 按标准看\n\n- **一个功能点一个测试**：基本符合");

  assert.doesNotMatch(html, /<h2>/);
  assert.match(html, /<p data-chat-markdown-role="heading">按标准看<\/p>/);
  assert.match(html, /<strong data-chat-markdown-role="strong">一个功能点一个测试<\/strong>/);
  assert.match(html, /\.chat-markdown strong \{[^}]*font-weight: 700;/);
});

test("renderMarkdownToStaticHtml 会给代码块文字增加字形留白修剪规则，而不是继续只改字号", () => {
  const html = renderMarkdownToStaticHtml("```bash\npython3 -m pytest -q\n....   [100%]\n4 passed in 0.01s\n```");

  assert.match(html, /\.chat-markdown pre > code \{[^}]*display: block;[^}]*margin: -0\.08em 0 -0\.1em;/);
});
