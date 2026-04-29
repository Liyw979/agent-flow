import test from "node:test";
import assert from "node:assert/strict";

import {
  extractTrailingDecisionSignalBlock,
  stripDecisionResponseMarkup,
} from "./decision-response";

const APPROVED = "<approved>";
const APPROVED_END = "</approved>";
const REVISE = "<revise>";
const REVISE_END = "</revise>";

test("extractTrailingDecisionSignalBlock 不再识别错拼的 chalenge", () => {
  const content =
    "目前缺少测试文件，无法完成单测判定。"
    + "<chalenge>请把 temp_add.js 和对应测试文件一起发出来。</chalenge>";

  const parsed = extractTrailingDecisionSignalBlock(content, [APPROVED, REVISE]);
  assert.equal(parsed, null);
});

test("extractTrailingDecisionSignalBlock 支持识别示例结束 trigger", () => {
  const content =
    "证据链已经完整，漏洞定性成立。"
    + `${APPROVED}结束当前分支。${APPROVED_END}`;

  const parsed = extractTrailingDecisionSignalBlock(content, [APPROVED, REVISE]);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.body, "证据链已经完整，漏洞定性成立。");
  assert.equal(parsed?.response, "结束当前分支。");
  assert.equal(parsed?.trigger, APPROVED);
  assert.equal(
    parsed?.rawBlock,
    `${APPROVED}结束当前分支。${APPROVED_END}`,
  );
});

test("extractTrailingDecisionSignalBlock 支持识别示例回流 trigger", () => {
  const content =
    `判定未通过。${REVISE}请继续补测试。${REVISE_END}`;

  const parsed = extractTrailingDecisionSignalBlock(content, [APPROVED, REVISE]);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.body, "判定未通过。");
  assert.equal(parsed?.response, "请继续补测试。");
  assert.equal(parsed?.trigger, REVISE);
  assert.equal(
    parsed?.rawBlock,
    `${REVISE}请继续补测试。${REVISE_END}`,
  );
});

test("extractTrailingDecisionSignalBlock 支持识别开头裸 trigger", () => {
  const parsed = extractTrailingDecisionSignalBlock(`${APPROVED}结束当前分支。`, [APPROVED, REVISE]);

  assert.notEqual(parsed, null);
  assert.equal(parsed?.body, "结束当前分支。");
  assert.equal(parsed?.response, "结束当前分支。");
  assert.equal(parsed?.trigger, APPROVED);
  assert.equal(parsed?.rawBlock, `${APPROVED}结束当前分支。`);
});

test("extractTrailingDecisionSignalBlock 开头只有 trigger 没有正文时返回 null", () => {
  const parsed = extractTrailingDecisionSignalBlock(APPROVED, [APPROVED, REVISE]);

  assert.equal(parsed, null);
});

test("extractTrailingDecisionSignalBlock 会移除开头裸 trigger 后多余的结束标签", () => {
  const parsed = extractTrailingDecisionSignalBlock(`${REVISE}\n请继续补充实现依据。\n${REVISE_END}`, [
    APPROVED,
    REVISE,
  ]);

  assert.notEqual(parsed, null);
  assert.equal(parsed?.body, "请继续补充实现依据。");
  assert.equal(parsed?.response, "请继续补充实现依据。");
  assert.equal(parsed?.trigger, REVISE);
  assert.equal(parsed?.rawBlock, `${REVISE}\n请继续补充实现依据。\n${REVISE_END}`);
});

test("extractTrailingDecisionSignalBlock 不再兼容开头 trigger 与尾部裸 trigger 的混合格式", () => {
  const parsed = extractTrailingDecisionSignalBlock(
    `${REVISE}\n请继续补充实现依据。\n\n${REVISE}`,
    [APPROVED, REVISE],
  );

  assert.equal(parsed, null);
});

test("extractTrailingDecisionSignalBlock 缺少结束标签时返回 null", () => {
  const parsed = extractTrailingDecisionSignalBlock(`请继续补充。${REVISE}还有内容`, [APPROVED, REVISE]);
  assert.equal(parsed, null);
});

test("extractTrailingDecisionSignalBlock 正文后只保留裸 trigger 时返回 null", () => {
  const parsed = extractTrailingDecisionSignalBlock(`请继续补充实现依据。\n\n${REVISE}`, [APPROVED, REVISE]);
  assert.equal(parsed, null);
});

test("extractTrailingDecisionSignalBlock 在缺少标签时返回 null", () => {
  assert.equal(extractTrailingDecisionSignalBlock("这是普通正文。"), null);
});

test("extractTrailingDecisionSignalBlock 支持按允许的 trigger 集合解析自定义标签", () => {
  const parsed = extractTrailingDecisionSignalBlock(
    "漏洞挑战需要继续回应。\n\n<abcd>请继续补充反驳。</abcd>",
    ["<abcd>"],
  );

  assert.notEqual(parsed, null);
  assert.equal(parsed?.body, "漏洞挑战需要继续回应。");
  assert.equal(parsed?.response, "请继续补充反驳。");
  assert.equal(parsed?.trigger, "<abcd>");
  assert.equal(parsed?.rawBlock, "<abcd>请继续补充反驳。</abcd>");
});

test("extractTrailingDecisionSignalBlock 支持解析正文后跟成对自定义标签块", () => {
  const parsed = extractTrailingDecisionSignalBlock(
    "aaaaa<trigger> bbbbb</trigger>",
    ["<trigger>"],
  );

  assert.notEqual(parsed, null);
  assert.equal(parsed?.body, "aaaaa");
  assert.equal(parsed?.response, "bbbbb");
  assert.equal(parsed?.trigger, "<trigger>");
  assert.equal(parsed?.rawBlock, "<trigger> bbbbb</trigger>");
});

test("stripDecisionResponseMarkup 会去掉示例 trigger 标签并保留正文", () => {
  assert.equal(
    stripDecisionResponseMarkup(`继续处理。\n\n${REVISE}请继续补充实现依据。`, [APPROVED, REVISE]),
    `继续处理。\n\n${REVISE}请继续补充实现依据。`,
  );
  assert.equal(
    stripDecisionResponseMarkup(`${REVISE}\n请继续补充实现依据。`, [APPROVED, REVISE]),
    "请继续补充实现依据。",
  );
  assert.equal(
    stripDecisionResponseMarkup(`${REVISE}\n请继续补充实现依据。\n${REVISE_END}`, [APPROVED, REVISE]),
    "请继续补充实现依据。",
  );
  assert.equal(
    stripDecisionResponseMarkup(
      `继续处理。\n\n${REVISE}请继续补充实现依据。${REVISE_END}`,
      [APPROVED, REVISE],
    ),
    "继续处理。\n\n请继续补充实现依据。",
  );
  assert.equal(
    stripDecisionResponseMarkup(`当前分支可以结束。\n\n${APPROVED}结束当前分支。${APPROVED_END}`, [APPROVED, REVISE]),
    "当前分支可以结束。\n\n结束当前分支。",
  );
  assert.equal(
    stripDecisionResponseMarkup(`继续处理。\n\n${REVISE_END}请继续补充实现依据。`, [APPROVED, REVISE]),
    `继续处理。\n\n${REVISE_END}请继续补充实现依据。`,
  );
  assert.equal(
    stripDecisionResponseMarkup(`请继续补充实现依据。\n\n${REVISE}`, [APPROVED, REVISE]),
    `请继续补充实现依据。\n\n${REVISE}`,
  );
  assert.equal(
    stripDecisionResponseMarkup("继续处理。\n\n<chalenge>请继续补充实现依据。</chalenge>"),
    "继续处理。\n\n<chalenge>请继续补充实现依据。</chalenge>",
  );
  assert.equal(
    stripDecisionResponseMarkup("aaaaa<trigger> bbbbb</trigger>", ["<trigger>"]),
    "aaaaa\n\nbbbbb",
  );
});
