import assert from "node:assert/strict";
import test from "node:test";

import { parseDecision, stripStructuredSignals } from "./decision-parser";

test("decision agent 未返回合法标签时必须判为 invalid", () => {
  const parsedDecision = parseDecision(
    "这是普通判定正文，标签写错了。\n\n<chalenge>请继续补充实现依据。</chalenge>",
    true,
  );

  assert.deepEqual(parsedDecision, {
    cleanContent: "这是普通判定正文，标签写错了。\n\n<chalenge>请继续补充实现依据。</chalenge>",
    opinion: "这是普通判定正文，标签写错了。\n\n<chalenge>请继续补充实现依据。</chalenge>",
    kind: "invalid",
    validationError: "当前 Agent 未配置任何可用 trigger",
  });
});

test("非判定 agent 未返回标签时仍按普通通过处理", () => {
  const parsedDecision = parseDecision("普通执行结果正文", false);

  assert.deepEqual(parsedDecision, {
    cleanContent: "普通执行结果正文",
    kind: "valid",
    trigger: "<default>",
    opinion: "",
  });
});

test("decision agent 返回允许的结束 trigger 时应按该 trigger 解析", () => {
  const parsedDecision = parseDecision(
    "结论已经稳定。\n\n<complete>结束当前分支。</complete>",
    true,
    [{ trigger: "<complete>" }],
  );

  assert.deepEqual(parsedDecision, {
    cleanContent: "结论已经稳定。",
    kind: "valid",
    trigger: "<complete>",
    opinion: "结束当前分支。",
    rawDecisionBlock: "<complete>结束当前分支。</complete>",
  });
});

test("decision agent 支持开头裸 trigger label", () => {
  const parsedDecision = parseDecision(
    "<continue>\n下一步还需要补的证据\n\n上传目录是否被部署到了 Tomcat webroot。",
    true,
    [{ trigger: "<continue>" }],
  );

  assert.deepEqual(parsedDecision, {
    cleanContent: "下一步还需要补的证据\n\n上传目录是否被部署到了 Tomcat webroot。",
    kind: "valid",
    trigger: "<continue>",
    opinion: "下一步还需要补的证据\n\n上传目录是否被部署到了 Tomcat webroot。",
    rawDecisionBlock: "<continue>\n下一步还需要补的证据\n\n上传目录是否被部署到了 Tomcat webroot。",
  });
});

test("decision agent 开头只有 trigger 没有正文时必须判为 invalid", () => {
  const parsedDecision = parseDecision(
    "<complete>",
    true,
    [{ trigger: "<continue>" }, { trigger: "<complete>" }],
  );

  assert.deepEqual(parsedDecision, {
    cleanContent: "<complete>",
    kind: "invalid",
    opinion: "<complete>",
    validationError: "当前 Agent 必须返回以下 trigger 之一：<continue> / <complete>",
  });
});

test("decision agent 原文以 trigger label 开头且末尾重复裸 trigger 时必须判为 invalid", () => {
  const parsedDecision = parseDecision(
    "<continue>\n下一步还需要补的证据\n\n上传目录是否被部署到了 Tomcat webroot。\n\n<continue>",
    true,
    [{ trigger: "<continue>" }],
  );

  assert.deepEqual(parsedDecision, {
    cleanContent: "<continue>\n下一步还需要补的证据\n\n上传目录是否被部署到了 Tomcat webroot。\n\n<continue>",
    kind: "invalid",
    opinion: "<continue>\n下一步还需要补的证据\n\n上传目录是否被部署到了 Tomcat webroot。\n\n<continue>",
    validationError: "当前 Agent 必须返回以下 trigger 之一：<continue>",
  });
});

test("decision agent 会移除开头裸 trigger 后多余的结束标签", () => {
  const parsedDecision = parseDecision(
    "<complete>\n当前分支已经完成判定，可以结束。\n</complete>",
    true,
    [{ trigger: "<continue>" }, { trigger: "<complete>" }],
  );

  assert.deepEqual(parsedDecision, {
    cleanContent: "当前分支已经完成判定，可以结束。",
    kind: "valid",
    trigger: "<complete>",
    opinion: "当前分支已经完成判定，可以结束。",
    rawDecisionBlock: "<complete>\n当前分支已经完成判定，可以结束。\n</complete>",
  });
});

test("decision agent 支持根据允许的 trigger 解析自定义标签", () => {
  const parsedDecision = parseDecision(
    "证据已经补齐。\n\n<abcd>请漏洞挑战继续回应。</abcd>",
    true,
    [{ trigger: "<abcd>" }],
  );

  assert.deepEqual(parsedDecision, {
    cleanContent: "证据已经补齐。",
    kind: "valid",
    trigger: "<abcd>",
    opinion: "请漏洞挑战继续回应。",
    rawDecisionBlock: "<abcd>请漏洞挑战继续回应。</abcd>",
  });
});

test("decision agent 支持解析正文后跟成对自定义标签块", () => {
  const parsedDecision = parseDecision(
    "aaaaa<trigger> bbbbb</trigger>",
    true,
    [{ trigger: "<trigger>" }],
  );

  assert.deepEqual(parsedDecision, {
    cleanContent: "aaaaa",
    kind: "valid",
    trigger: "<trigger>",
    opinion: "bbbbb",
    rawDecisionBlock: "<trigger> bbbbb</trigger>",
  });
});

test("存在自定义 trigger 时，未命中允许标签会直接判为 invalid", () => {
  const parsedDecision = parseDecision(
    "证据已经补齐，但忘记返回约定标签。",
    true,
    [{ trigger: "<abcd>" }],
  );

  assert.deepEqual(parsedDecision, {
    cleanContent: "证据已经补齐，但忘记返回约定标签。",
    kind: "invalid",
    opinion: "证据已经补齐，但忘记返回约定标签。",
    validationError: "当前 Agent 必须返回以下 trigger 之一：<abcd>",
  });
});

test("存在自定义 trigger 时，返回未声明的示例 label 也会判为 invalid", () => {
  const parsedDecision = parseDecision(
    "<continue>请继续回应。</continue>",
    true,
    [{ trigger: "<abcd>" }],
  );

  assert.deepEqual(parsedDecision, {
    cleanContent: "<continue>请继续回应。</continue>",
    kind: "invalid",
    opinion: "<continue>请继续回应。</continue>",
    validationError: "当前 Agent 必须返回以下 trigger 之一：<abcd>",
  });
});

test("存在自定义 trigger 时，返回未声明的结束示例 label 也会判为 invalid", () => {
  const parsedDecision = parseDecision(
    "<complete>当前分支可以结束。</complete>",
    true,
    [{ trigger: "<abcd>" }],
  );

  assert.deepEqual(parsedDecision, {
    cleanContent: "<complete>当前分支可以结束。</complete>",
    kind: "invalid",
    opinion: "<complete>当前分支可以结束。</complete>",
    validationError: "当前 Agent 必须返回以下 trigger 之一：<abcd>",
  });
});

test("stripStructuredSignals 会移除运行时结构化控制信号", () => {
  assert.equal(
    stripStructuredSignals("正文\nTASK_DONE\nNEXT_AGENTS: Build\nSESSION_REF: abc"),
    "正文",
  );
});
