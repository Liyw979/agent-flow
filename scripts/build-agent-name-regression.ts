import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OpenCodeClient } from "../electron/main/opencode-client";

async function main() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-build-agent-name-"));
  const client = new OpenCodeClient(userDataPath);
  let capturedAgent: string | null = null;

  (client as any).ensureServer = async () => ({
    process: null,
    port: 0,
    mock: false,
  });
  (client as any).request = async (_pathname: string, options: { body?: string }) => {
    const body = options.body ? (JSON.parse(options.body) as { agent?: string }) : {};
    capturedAgent = typeof body.agent === "string" ? body.agent : null;
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          id: "mock-message-id",
          content: "",
          parts: [],
          info: {
            id: "mock-message-id",
            role: "assistant",
            time: {
              created: new Date().toISOString(),
              completed: new Date().toISOString(),
            },
          },
        }),
    } as Response;
  };

  try {
    await client.submitMessage("/tmp/project", "session-1", {
      content: "请开始实现。",
      agent: "Build",
      system: "system prompt",
    });

    assert.equal(capturedAgent, "build", `提交给 OpenCode 的 agent 应为小写 build，实际为 ${capturedAgent}`);
    console.log(JSON.stringify({ capturedAgent }, null, 2));
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
