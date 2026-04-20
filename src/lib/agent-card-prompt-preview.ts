export function buildAgentCardPromptPreview(input: {
  agentName: string;
  prompt: string | null | undefined;
}): string {
  const promptPreview = (input.prompt ?? "").trim();
  if (promptPreview) {
    return promptPreview.replace(/\s+/gu, "");
  }

  if (typeof input.prompt === "string") {
    return "由 OpenCode 读取";
  }

  return "-";
}
