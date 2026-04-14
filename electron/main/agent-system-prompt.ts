import type { AgentFileRecord } from "../../shared/types";
import { isReviewAgentName } from "../../shared/types";

export function buildAgentSystemPrompt(
  agent: Pick<AgentFileRecord, "name" | "role">,
): string {
  if (isReviewAgentName(agent.name)) {
    return "请只关注你当前负责的工作本身，不要假设还有其他 Agent，也不要描述任何调度链路。先输出对用户有意义的高层结果。无论收到的正文是否带额外格式或补充要求，你在完成本轮工作后都必须用中文输出最终的【DECISION】结论，格式如下：\n"
      + `在你完成本轮所有工作后，必须用中文严格按照以下格式给出最终决策，不要有任何其他解释或额外文字：
- 如果你确认自己负责的审查已经严格通过，请直接输出：【DECISION】检查通过
- 如果存在问题需要修改，请直接输出：【DECISION】需要修改
具体修改意见：（此处详细列出需要修改的点，越具体越好）`;
  }

  return "";
}
