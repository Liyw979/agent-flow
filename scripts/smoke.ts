import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Orchestrator } from "../electron/main/orchestrator";

async function main() {
  const timeout = setTimeout(() => {
    console.error("smoke timeout");
    process.exit(1);
  }, 30000);
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-smoke-"));
  const cwd = process.cwd();
  const orchestrator = new Orchestrator({ userDataPath });

  // 避免冒烟时拉起额外终端窗口，其他运行时逻辑仍保持真实执行。
  (orchestrator as any).zellijManager.openTaskSession = async () => undefined;
  (orchestrator as any).zellijManager.focusAgentPANEL = async () => undefined;
  (orchestrator as any).zellijManager.createTaskSession = async (_projectId: string, taskId: string) =>
    `smoke-${taskId.slice(0, 8)}`;
  (orchestrator as any).zellijManager.materializePanelBindings = async (options: {
    projectId: string;
    taskId: string;
    sessionName: string;
    cwd: string;
    agentNames: string[];
  }) => (orchestrator as any).zellijManager.createPanelBindings(options);
  (orchestrator as any).zellijManager.dispatchTaskToPane = async () => undefined;
  (orchestrator as any).opencodeClient.ensureServer = async () => ({
    process: null,
    port: 0,
    mock: true,
  });
  (orchestrator as any).opencodeClient.connectEvents = async () => undefined;

  try {
    console.log("smoke: initialize");
    await orchestrator.initialize();
    console.log("smoke: bootstrap");
    const projects = await orchestrator.bootstrap();
    const project = projects[0];
    if (!project) {
      throw new Error("bootstrap 后未发现默认项目");
    }

    const entryAgent =
      project.agentFiles.find((agent) => agent.mode === "primary" && !agent.relativePath.startsWith("builtin://")) ??
      project.agentFiles[0];
    if (!entryAgent) {
      throw new Error("未找到可作为入口的 Agent");
    }
    const docsReviewAgent = project.agentFiles.find((agent) => agent.role === "docs_review");
    const integrationTestAgent = project.agentFiles.find((agent) => agent.role === "integration_test");

    console.log("smoke: submitTask");
    const created = await orchestrator.submitTask({
      projectId: project.project.id,
      content: `@${entryAgent.name} 请围绕当前仓库做一次完整实现并推进到最终交付。`,
      mentionAgent: entryAgent.name,
    });

    if (created.task.status !== "success") {
      throw new Error(`Task 未成功完成，当前状态为 ${created.task.status}`);
    }

    if (created.agents.length < 6) {
      throw new Error(`Task Agent 数量异常，当前仅有 ${created.agents.length} 个`);
    }

    const hasDecisionLeak = created.messages.some((message) => message.content.includes("【DECISION】"));
    if (hasDecisionLeak) {
      throw new Error("Task 群聊中泄露了自检 DECISION 文本");
    }

    const hasHighLevelTrigger = created.messages.some(
      (message) => message.meta?.kind === "high-level-trigger",
    );
    if (!hasHighLevelTrigger) {
      throw new Error("Task 群聊中未出现 Agent -> Agent 高层触发消息");
    }

    if (docsReviewAgent) {
      const hasDocsReview = created.messages.some((message) => message.sender === docsReviewAgent.name);
      if (!hasDocsReview) {
        throw new Error(`未看到 ${docsReviewAgent.name} 的文档审查消息`);
      }
    }

    if (integrationTestAgent) {
      const integrationRun = created.agents.find((agent) => agent.name === integrationTestAgent.name)?.runCount ?? 0;
      const entryRun = created.agents.find((agent) => agent.name === entryAgent.name)?.runCount ?? 0;
      if (integrationRun < 1 || entryRun < 2) {
        throw new Error("未形成“集成测试通过后回流 BA 验证”的链路");
      }
    }

    const nonIdleAgents = created.agents.filter((agent) => agent.runCount > 0);
    if (nonIdleAgents.length < 2) {
      throw new Error("流水线未实际推进到多个 Agent");
    }

    const summary = {
      projectId: project.project.id,
      taskId: created.task.id,
      taskStatus: created.task.status,
      agentRuns: created.agents.map((agent) => ({
        name: agent.name,
        status: agent.status,
        runCount: agent.runCount,
        sessionId: agent.opencodeSessionId,
      })),
      messageKinds: created.messages.map((message) => ({
        sender: message.sender,
        kind: message.meta?.kind ?? "plain",
      })),
    };

    console.log(JSON.stringify(summary, null, 2));
    clearTimeout(timeout);
    process.exit(0);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
