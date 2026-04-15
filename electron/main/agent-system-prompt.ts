import type { AgentFileRecord } from "../../shared/types";

export function buildAgentSystemPrompt(
  agent: Pick<AgentFileRecord, "name">,
  reviewAgent: boolean,
): string {
  if (reviewAgent) {
    return "你需要对 `[@来源 Agent Message]` 做出回应。\n\n"
      + "如果你认同这条消息，并且没有需要继续补充、质疑、反驳或澄清的内容，就直接给出正常回复，不要追加结构化尾段。\n\n"
      + "如果你不认同这条消息，或者你认为还需要继续补充、质疑、反驳、澄清、推动实现或推动讨论，就在最后追加一个结构化尾段，格式如下：\n"
      + "回应：（此处写你希望对这条消息继续响应的内容）";
  }

  return "";
}
