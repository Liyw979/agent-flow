export function buildMockAgentReply(agent: string, content: string): string {
  const cleaned = content
    .replace(/\bSESSION_REF:\s*.+$/gim, "")
    .replace(/在你完成本轮所有工作后[\s\S]*$/m, "")
    .trim();
  const revisionFeedback =
    "【DECISION】需要修改\n具体修改意见：请补齐缺失实现、补充验证步骤，并确保最终回复只保留对用户有意义的高层结果。";
  const reviewPassed = "【DECISION】检查通过";
  const completed = "【DECISION】已完成";

  const withDecision = (body: string, decision: string = completed) => `${body}\n${decision}`;

  if (/需要修改|返工|rework|revise/i.test(cleaned)) {
    return withDecision(
      "我已重新检查当前上下文，确认这一轮需要继续返工后再继续推进。",
      revisionFeedback,
    );
  }

  switch (agent) {
    case "BA":
      if (/验收|review|审查|复核/i.test(cleaned)) {
        return withDecision("我已经完成业务验收与体验复核，当前交付满足主流程要求。", reviewPassed);
      }
      return withDecision("我已整理当前 Task 的目标、范围与交付标准，并给出审查结论。", reviewPassed);
    case "Code":
    case "build":
    case "Build":
      return "我已完成主要实现与本地自检，当前代码、验证步骤和交付说明已经整理完成。";
    case "UnitTest":
      return withDecision("单元测试覆盖与结构检查完成，未发现阻塞问题。", reviewPassed);
    case "IntegrationTest":
      return withDecision("集成测试链路检查完成，关键流程可以继续进入业务复核。", reviewPassed);
    case "CodeReview":
      return withDecision("代码审查完成，当前实现没有发现需要阻塞交付的缺陷。", reviewPassed);
    case "DocsReview":
      return withDecision("文档审查完成，README.md 与 AGENTS.md 的同步情况已经核对。", reviewPassed);
    default:
      return withDecision("当前阶段审查完成，未发现阻塞问题。", reviewPassed);
  }
}
