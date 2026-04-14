import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Orchestrator } from "../electron/main/orchestrator";
import { buildZellijMissingMessage, buildZellijMissingReminder } from "../shared/zellij";

async function main() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-zellij-reminder-"));
  const orchestrator = new Orchestrator({ userDataPath, autoOpenTaskSession: false });

  (orchestrator as any).zellijManager.isAvailable = async () => false;
  (orchestrator as any).zellijManager.assertAvailable = async (action: string) => {
    throw new Error(buildZellijMissingMessage(action));
  };
  (orchestrator as any).zellijManager.createTaskSession = async (_projectId: string, taskId: string) =>
    `missing-zellij-${taskId.slice(0, 8)}`;
  (orchestrator as any).zellijManager.materializePanelBindings = async (options: {
    projectId: string;
    taskId: string;
    sessionName: string;
    cwd: string;
    agents: Array<{ name: string; opencodeSessionId: string | null }>;
  }) => (orchestrator as any).zellijManager.createPanelBindings(options);
  (orchestrator as any).zellijManager.dispatchTaskToPane = async () => undefined;
  (orchestrator as any).opencodeClient.createSession = async (
    _projectPath: string,
    title: string,
  ) => `session-${title.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  (orchestrator as any).opencodeClient.reloadConfig = async () => undefined;
  (orchestrator as any).opencodeClient.ensureServer = async () => ({
    process: null,
    port: 0,
    mock: true,
  });
  (orchestrator as any).opencodeClient.connectEvents = async () => undefined;

  try {
    await orchestrator.initialize();
    const [project] = await orchestrator.bootstrap();
    assert(project, "bootstrap 后未发现默认 Project");

    const snapshot = await orchestrator.initializeTask({
      projectId: project.project.id,
      title: "zellij missing reminder",
    });

    const reminderMessage = snapshot.messages.find((message) => message.meta?.kind === "zellij-missing");
    assert(reminderMessage, "Task 初始化后未写入 zellij 缺失提醒");
    assert.equal(
      reminderMessage.content,
      buildZellijMissingReminder(),
      "zellij 缺失提醒文案不符合预期",
    );

    await assert.rejects(
      () =>
        orchestrator.openTaskSession({
          projectId: project.project.id,
          taskId: snapshot.task.id,
        }),
      (error) =>
        error instanceof Error &&
        error.message === buildZellijMissingMessage("无法打开 Zellij Session"),
      "打开 Task session 时未返回明确的 zellij 缺失报错",
    );

    console.log(
      JSON.stringify(
        {
          projectId: project.project.id,
          taskId: snapshot.task.id,
          reminder: reminderMessage.content,
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
