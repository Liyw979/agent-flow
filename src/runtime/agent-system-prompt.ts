export function buildAgentSystemPrompt(allowedTriggers: readonly string[]): string {
  const normalizedTriggers = [...new Set(allowedTriggers.map((item) => item.trim()).filter(Boolean))];
  if (normalizedTriggers.length === 0) {
    throw new Error("decisionAgent 缺少可用 trigger，无法构造系统提示词。");
  }

  return [
    "回复必须使用当前允许的 trigger 之一作为标签。",
    `允许的 trigger：${normalizedTriggers.join(" / ")}`,
    "先输出 trigger 标签，再输出正文。",
  ].join("\n");
}
