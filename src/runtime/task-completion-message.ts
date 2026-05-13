import type { TaskRecord } from "@shared/types";

export function buildTaskRoundFinishedMessageContent(): string {
  return "本轮已完成，可继续 @Agent 发起下一轮。";
}

export function buildTaskCompletionMessageContent(input: {
  status: TaskRecord["status"];
  taskTitle: string;
  failureReason?: string | null;
}): string {
  const failureReason = input.failureReason?.trim();
  if (failureReason) {
    return failureReason;
  }

  return `Task「${input.taskTitle}」已结束。本轮存在失败或中断，请直接查看群聊中最近一条失败消息，并检查状态为“执行失败”的 Agent。`;
}
