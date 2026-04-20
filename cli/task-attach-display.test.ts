import test from "node:test";
import assert from "node:assert/strict";

import { renderTaskAttachCommands } from "./task-attach-display";

test("renderTaskAttachCommands 会在 CLI 里同时展示 task attach 和底层 opencode attach 命令", () => {
  const output = renderTaskAttachCommands([
    {
      agentName: "Build",
      taskAttachCommand: "bun run cli -- task attach 'task-1' 'Build'",
      opencodeAttachCommand: "opencode attach 'http://127.0.0.1:4096' --session 'session-1' --dir '/tmp/demo'",
    },
  ]);

  assert.match(output, /attach:\n/);
  assert.match(output, /- Build \| attach: bun run cli -- task attach 'task-1' 'Build'/);
  assert.match(output, /opencode attach: opencode attach 'http:\/\/127\.0\.0\.1:4096' --session 'session-1' --dir '\/tmp\/demo'/);
});
