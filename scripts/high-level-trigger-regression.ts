import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MessageRecord } from "../shared/types";
import { mergeTaskChatMessages } from "../src/lib/chat-messages";
import { Orchestrator } from "../electron/main/orchestrator";

async function main() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-high-level-trigger-"));
  const orchestrator = new Orchestrator({ userDataPath });

  try {
    const summary = (orchestrator as any).extractDisplaySummary(`已完成需求澄清：实现一个加法工具。\n\n---`);
    assert.equal(summary, "已完成需求澄清：实现一个加法工具。", `摘要不应退化成分隔线，实际为 ${summary}`);

    const triggerContent = (orchestrator as any).buildHighLevelTriggerMessageContent(
      ["Build"],
      `已完成需求澄清：实现一个加法工具，调用后传入 a 和 b，返回 c。\n\n---`,
    );
    assert.equal(
      triggerContent,
      "@Build\n上游摘要：已完成需求澄清：实现一个加法工具，调用后传入 a 和 b，返回 c。",
      `高层触发文案异常，实际为 ${triggerContent}`,
    );
    assert.ok(
      !triggerContent.includes("请基于我刚刚完成的结果继续处理"),
      "高层触发消息仍然包含硬编码空话",
    );

    const forwardedMessage = (orchestrator as any).buildDownstreamForwardedMessage(
      "BA",
      `我注意到当前项目中已经存在一个加法工具的实现：
现有实现
文件路径: /Users/liyw/code/agent-team/src/lib/add.ts
export function add(a: number, b: number): number {
  return a + b;
}`,
      "以下是你尚未收到的群聊历史，请按时间顺序阅读：",
    );
    assert.ok(
      forwardedMessage.includes("以下是上游 Agent BA 本轮最新完成结果："),
      "下游 prompt 没有保底拼上 source agent 本轮最新结果",
    );
    assert.ok(
      forwardedMessage.includes("/Users/liyw/code/agent-team/src/lib/add.ts"),
      "下游 prompt 没有携带 BA 的完整实现说明",
    );

    const now = new Date().toISOString();
    const messages: MessageRecord[] = [
      {
        id: "m1",
        projectId: "p1",
        taskId: "t1",
        sender: "BA",
        timestamp: now,
        content: "已完成需求澄清：实现一个加法工具。",
        meta: {
          kind: "agent-final",
        },
      },
      {
        id: "m2",
        projectId: "p1",
        taskId: "t1",
        sender: "BA",
        timestamp: now,
        content: "@Build\n上游摘要：已完成需求澄清：实现一个加法工具。",
        meta: {
          kind: "high-level-trigger",
        },
      },
    ];
    const merged = mergeTaskChatMessages(messages);
    assert.equal(merged.length, 2, `agent-final 不应与 high-level-trigger 合并，实际数量为 ${merged.length}`);

    console.log(
      JSON.stringify(
        {
          summary,
          triggerContent,
          forwardedMessage,
          mergedCount: merged.length,
        },
        null,
        2,
      ),
    );
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
