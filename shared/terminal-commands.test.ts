import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCliOpencodeAttachCommand,
} from "./terminal-commands";

test("CLI 支持直接构造 OpenCode attach agent session 命令", () => {
  assert.equal(
    buildCliOpencodeAttachCommand("http://127.0.0.1:43127", "session-123", {
      platform: "win32",
    }),
    'opencode attach "http://127.0.0.1:43127" --session "session-123"',
  );
});

test("POSIX attach 命令仍会安全引用 baseUrl 与 session", () => {
  assert.equal(
    buildCliOpencodeAttachCommand("http://127.0.0.1:43127", "session-123", {
      platform: "darwin",
    }),
    "opencode attach 'http://127.0.0.1:43127' --session 'session-123'",
  );
});
