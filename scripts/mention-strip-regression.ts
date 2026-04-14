import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { OpenCodeExecutionResult } from "../electron/main/opencode-client";
import { Orchestrator } from "../electron/main/orchestrator";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const timeout = setTimeout(() => {
    console.error("mention-strip regression timeout");
    process.exit(1);
  }, 30000);

  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-mention-strip-userdata-"));
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-mention-strip-project-"));
  const orchestrator = new Orchestrator({ userDataPath });
  const dispatchedContents: string[] = [];
  let runCount = 0;

  fs.mkdirSync(path.join(projectPath, ".opencode", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, ".opencode", "agents", "BA.md"),
    `---
mode: primary
role: business_analyst
permission:
  write: allow
  bash: allow
  edit: allow
---

你是 BA。
`,
    "utf8",
  );

  const originalListAgentFiles = (orchestrator as any).agentFiles.listAgentFiles.bind(
    (orchestrator as any).agentFiles,
  );
  (orchestrator as any).agentFiles.listAgentFiles = (...args: unknown[]) =>
    originalListAgentFiles(...args).filter((agent: { name: string }) => agent.name === "BA");

  (orchestrator as any).zellijManager.openTaskSession = async () => undefined;
  (orchestrator as any).zellijManager.focusAgentPANEL = async () => undefined;
  (orchestrator as any).zellijManager.createTaskSession = async (_projectId: string, taskId: string) =>
    `mention-${taskId.slice(0, 8)}`;
  (orchestrator as any).zellijManager.materializePanelBindings = async (options: {
    projectId: string;
    taskId: string;
    sessionName: string;
    cwd: string;
    agents: Array<{ name: string; opencodeSessionId: string | null; status?: string }>;
  }) => (orchestrator as any).zellijManager.createPanelBindings(options);
  (orchestrator as any).zellijManager.dispatchTaskToPane = async () => undefined;
  (orchestrator as any).opencodeClient.ensureServer = async () => ({
    process: null,
    port: 0,
    mock: true,
  });
  (orchestrator as any).opencodeClient.connectEvents = async () => undefined;
  (orchestrator as any).opencodeRunner.run = async (payload: {
    content: string;
    agent: string;
  }): Promise<OpenCodeExecutionResult> => {
    runCount += 1;
    dispatchedContents.push(payload.content);
    await sleep(runCount === 1 ? 200 : 20);
    const timestamp = new Date(Date.now() + runCount).toISOString();
    return {
      status: "completed",
      finalMessage: `第 ${runCount} 轮处理完成。\n\n【DECISION】检查通过`,
      fallbackMessage: null,
      messageId: `mention-strip-${runCount}-${randomUUID()}`,
      timestamp,
      rawMessage: {
        id: `mention-strip-${runCount}`,
        content: `第 ${runCount} 轮处理完成。\n\n【DECISION】检查通过`,
        sender: payload.agent,
        timestamp,
        completedAt: timestamp,
        error: null,
        raw: {},
      },
    };
  };

  try {
    await orchestrator.initialize();
    const project = await orchestrator.ensureProjectForPath(projectPath);
    await orchestrator.saveTopology({
      projectId: project.project.id,
      topology: {
        ...project.topology,
        startAgentId: "BA",
        agentOrderIds: ["BA"],
        nodes: [{ id: "BA", label: "BA", kind: "agent" }],
        edges: [],
      },
    });

    const first = await orchestrator.submitTask({
      projectId: project.project.id,
      content: "@BA 请先分析需求。",
      mentionAgent: "BA",
    });

    await orchestrator.submitTask({
      projectId: project.project.id,
      taskId: first.task.id,
      content: "@BA 请补充验收结论。",
      mentionAgent: "BA",
    });

    let settled = first;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      settled = await orchestrator.getTaskSnapshot(first.task.id);
      const baRunCount = settled.agents.find((agent) => agent.name === "BA")?.runCount ?? 0;
      if (settled.task.status === "success" && baRunCount >= 2) {
        break;
      }
      await sleep(100);
    }

    assert.equal(dispatchedContents.length, 2, `期望 BA 被实际派发 2 次，实际为 ${dispatchedContents.length}`);
    assert.equal(dispatchedContents[0], "请先分析需求。", "首条直发消息仍然带着 @BA");
    assert.match(dispatchedContents[1] ?? "", /请补充验收结论。/, "排队补发消息缺少新增正文");
    assert.doesNotMatch(
      dispatchedContents[1] ?? "",
      /@BA 请补充验收结论。/,
      "排队补发消息仍然把 @BA 传给了 agent",
    );

    console.log(
      JSON.stringify(
        {
          taskId: settled.task.id,
          taskStatus: settled.task.status,
          dispatchedContents,
        },
        null,
        2,
      ),
    );
    clearTimeout(timeout);
  } finally {
    await orchestrator.dispose().catch(() => undefined);
    fs.rmSync(userDataPath, { recursive: true, force: true });
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
