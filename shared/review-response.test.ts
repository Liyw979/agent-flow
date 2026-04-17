import test from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_AGREE_END_LABEL,
  REVIEW_AGREE_LABEL,
  REVIEW_CHALLENGE_END_LABEL,
  REVIEW_CHALLENGE_LABEL,
  extractTrailingReviewSignalBlock,
  stripReviewResponseMarkup,
} from "./review-response";

test("extractTrailingReviewSignalBlock 不再识别错拼的 chalenge", () => {
  const content =
    "目前缺少测试文件，无法完成单测审查。"
    + "<chalenge>请把 temp_add.js 和对应测试文件一起发出来。</chalenge>";

  const parsed = extractTrailingReviewSignalBlock(content);
  assert.equal(parsed, null);
});

test("extractTrailingReviewSignalBlock 支持识别 agree", () => {
  const content =
    "证据链已经完整，漏洞定性成立。"
    + `${REVIEW_AGREE_LABEL}我同意这是漏洞。${REVIEW_AGREE_END_LABEL}`;

  const parsed = extractTrailingReviewSignalBlock(content);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.body, "证据链已经完整，漏洞定性成立。");
  assert.equal(parsed?.response, "我同意这是漏洞。");
  assert.equal(parsed?.kind, "agree");
  assert.equal(
    parsed?.rawBlock,
    `${REVIEW_AGREE_LABEL}我同意这是漏洞。${REVIEW_AGREE_END_LABEL}`,
  );
});

test("extractTrailingReviewSignalBlock 支持识别正确拼写的 challenge", () => {
  const content =
    `审查未通过。${REVIEW_CHALLENGE_LABEL}请继续补测试。${REVIEW_CHALLENGE_END_LABEL}`;

  const parsed = extractTrailingReviewSignalBlock(content);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.body, "审查未通过。");
  assert.equal(parsed?.response, "请继续补测试。");
  assert.equal(parsed?.kind, "challenge");
  assert.equal(
    parsed?.rawBlock,
    `${REVIEW_CHALLENGE_LABEL}请继续补测试。${REVIEW_CHALLENGE_END_LABEL}`,
  );
});

test("extractTrailingReviewSignalBlock 支持识别前置 agree 标签", () => {
  const parsed = extractTrailingReviewSignalBlock(`${REVIEW_AGREE_LABEL}我同意这是漏洞。`);

  assert.notEqual(parsed, null);
  assert.equal(parsed?.body, "");
  assert.equal(parsed?.response, "我同意这是漏洞。");
  assert.equal(parsed?.kind, "agree");
  assert.equal(parsed?.rawBlock, `${REVIEW_AGREE_LABEL}我同意这是漏洞。`);
});

test("extractTrailingReviewSignalBlock 缺少结束标签时也能识别尾部 challenge", () => {
  const parsed = extractTrailingReviewSignalBlock(`请继续补充。${REVIEW_CHALLENGE_LABEL}还有内容`);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.body, "请继续补充。");
  assert.equal(parsed?.response, "还有内容");
  assert.equal(parsed?.kind, "challenge");
  assert.equal(parsed?.rawBlock, `${REVIEW_CHALLENGE_LABEL}还有内容`);
});

test("extractTrailingReviewSignalBlock 在缺少标签时返回 null", () => {
  assert.equal(extractTrailingReviewSignalBlock("这是普通正文。"), null);
});

test("stripReviewResponseMarkup 会去掉 challenge 和 agree 标签并保留正文", () => {
  assert.equal(
    stripReviewResponseMarkup(`审视不通过。\n\n${REVIEW_CHALLENGE_LABEL}请继续补充实现依据。`),
    "审视不通过。\n\n请继续补充实现依据。",
  );
  assert.equal(
    stripReviewResponseMarkup(
      `审视不通过。\n\n${REVIEW_CHALLENGE_LABEL}请继续补充实现依据。${REVIEW_CHALLENGE_END_LABEL}`,
    ),
    "审视不通过。\n\n请继续补充实现依据。",
  );
  assert.equal(
    stripReviewResponseMarkup(`审视通过。\n\n${REVIEW_AGREE_LABEL}我同意当前结论。${REVIEW_AGREE_END_LABEL}`),
    "审视通过。\n\n我同意当前结论。",
  );
  assert.equal(
    stripReviewResponseMarkup(`审视不通过。\n\n${REVIEW_CHALLENGE_END_LABEL}请继续补充实现依据。`),
    "审视不通过。\n\n请继续补充实现依据。",
  );
  assert.equal(
    stripReviewResponseMarkup("审视不通过。\n\n<chalenge>请继续补充实现依据。</chalenge>"),
    "审视不通过。\n\n<chalenge>请继续补充实现依据。</chalenge>",
  );
});
