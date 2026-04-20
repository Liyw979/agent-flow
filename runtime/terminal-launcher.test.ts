import test from "node:test";
import assert from "node:assert/strict";

import { buildTerminalLaunchSpec } from "./terminal-launcher";

test("buildTerminalLaunchSpec 在 Windows 里通过 cmd start 拉起 attach 终端", () => {
  const spec = buildTerminalLaunchSpec({
    cwd: "C:\\work\\agent-team",
    command: 'opencode attach "http://127.0.0.1:4310" --session "session-1" --dir "C:\\work\\agent-team"',
    platform: "win32",
  });

  assert.deepEqual(spec, {
    command: "cmd.exe",
    args: [
      "/d",
      "/s",
      "/c",
      'start "" cmd.exe /k opencode attach "http://127.0.0.1:4310" --session "session-1" --dir "C:\\work\\agent-team"',
    ],
    cwd: "C:\\work\\agent-team",
  });
});

test("buildTerminalLaunchSpec 在 macOS 里通过 osascript 拉起 Terminal attach 会话", () => {
  const spec = buildTerminalLaunchSpec({
    cwd: "/tmp/agent team",
    command: 'opencode attach "http://127.0.0.1:4310" --session "session-1" --dir "/tmp/agent team"',
    platform: "darwin",
  });

  assert.deepEqual(spec, {
    command: "osascript",
    args: [
      "-e",
      'tell application "Terminal" to do script "opencode attach \\"http://127.0.0.1:4310\\" --session \\"session-1\\" --dir \\"/tmp/agent team\\""',
      "-e",
      'tell application "Terminal" to activate',
    ],
    cwd: "/tmp/agent team",
  });
});

test("buildTerminalLaunchSpec 在 Linux 里通过系统终端执行 attach 命令", () => {
  const spec = buildTerminalLaunchSpec({
    cwd: "/tmp/agent-team",
    command: 'opencode attach "http://127.0.0.1:4310" --session "session-1" --dir "/tmp/agent-team"',
    platform: "linux",
  });

  assert.deepEqual(spec, {
    command: "x-terminal-emulator",
    args: [
      "-e",
      "/bin/sh",
      "-lc",
      'opencode attach "http://127.0.0.1:4310" --session "session-1" --dir "/tmp/agent-team"',
    ],
    cwd: "/tmp/agent-team",
  });
});
