import test from "node:test";
import assert from "node:assert/strict";

import { renderTaskAttachCommands } from "./task-attach-display";

test("renderTaskAttachCommands 在 CLI 里只展示底层 opencode attach 命令", () => {
  const output = renderTaskAttachCommands([
    {
      agentName: "Build",
      opencodeAttachCommand: "opencode attach 'http://127.0.0.1:4096' --session 'session-1'",
    },
  ]);

  assert.match(output, /attach:\n/);
  assert.match(output, /- Build \| opencode attach 'http:\/\/127\.0\.0\.1:4096' --session 'session-1'/);
  assert.doesNotMatch(output, /opencode attach:/);
  assert.doesNotMatch(output, /task attach/);
});
