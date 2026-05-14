import { test } from "bun:test";
import assert from "node:assert/strict";

import { buildTerminalLaunchSpec } from "./terminal-launcher";

test("buildTerminalLaunchSpec uses cmd start to launch a visible Windows attach terminal", () => {
  const spec = buildTerminalLaunchSpec({
    command: "opencode attach http://127.0.0.1:4310 --session session-1",
    platform: "win32",
    env: {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    },
  });

  assert.deepEqual(spec, {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: [
      "/d",
      "/c",
      "start",
      "",
      "C:\\Windows\\System32\\cmd.exe",
      "/d",
      "/s",
      "/k",
      "opencode attach http://127.0.0.1:4310 --session session-1",
    ],
  });
});

test("buildTerminalLaunchSpec still avoids a plain bare start target path on Windows", () => {
  const spec = buildTerminalLaunchSpec({
    command: "opencode attach http://127.0.0.1:4310 --session session-1",
    platform: "win32",
    env: {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    },
  });

  assert.match(
    spec.args.join("\n"),
    /^\/d\n\/c\nstart\n\nC:\\Windows\\System32\\cmd\.exe\n\/d\n\/s\n\/k/m,
  );
  assert.equal(spec.args[3], "");
});

test("buildTerminalLaunchSpec keeps the inner attach command clean on Windows", () => {
  const spec = buildTerminalLaunchSpec({
    command: "opencode attach http://127.0.0.1:4310 --session session-1",
    platform: "win32",
    env: {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    },
  });

  assert.match(
    spec.args[8] ?? "",
    /opencode attach http:\/\/127\.0\.0\.1:4310 --session session-1/,
  );
  assert.doesNotMatch(spec.args[8] ?? "", /pause >nul/);
  assert.doesNotMatch(spec.args[8] ?? "", /Attach command exited/);
});

test("buildTerminalLaunchSpec keeps the PowerShell fallback attach command clean on Windows", () => {
  const spec = buildTerminalLaunchSpec({
    command: "opencode attach http://127.0.0.1:4310 --session session-1",
    platform: "win32",
    env: {
      AGENT_TEAM_WINDOWS_TERMINAL: "powershell",
    },
  });

  assert.equal(spec.command, "powershell.exe");
  assert.match(spec.args[5] ?? "", /Start-Process -FilePath 'powershell\.exe'/);
  assert.match(spec.args[5] ?? "", /@\('-NoExit', '-Command', 'opencode attach http:\/\/127\.0\.0\.1:4310 --session session-1'\)/);
});

test("buildTerminalLaunchSpec prefers the ComSpec cmd path on Windows", () => {
  const spec = buildTerminalLaunchSpec({
    command: "opencode attach http://127.0.0.1:4310 --session session-1",
    platform: "win32",
    env: {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    },
  } as never);

  assert.equal(spec.command, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(spec.args[4], "C:\\Windows\\System32\\cmd.exe");
});

test("buildTerminalLaunchSpec opens a single Terminal attach window on macOS", () => {
  const spec = buildTerminalLaunchSpec({
    command: 'opencode attach "http://127.0.0.1:4310" --session "session-1"',
    platform: "darwin",
    env: {},
  });

  assert.deepEqual(spec, {
    command: "osascript",
    args: [
      "-e",
      'if application "Terminal" is running then',
      "-e",
      'tell application "Terminal" to do script "opencode attach \\"http://127.0.0.1:4310\\" --session \\"session-1\\""',
      "-e",
      "else",
      "-e",
      'tell application "Terminal"',
      "-e",
      "activate",
      "-e",
      "repeat until (count of windows) > 0",
      "-e",
      "delay 0.05",
      "-e",
      "end repeat",
      "-e",
      'set attachTab to do script "opencode attach \\"http://127.0.0.1:4310\\" --session \\"session-1\\"" in window 1',
      "-e",
      "set selected tab of window 1 to attachTab",
      "-e",
      "end tell",
      "-e",
      "end if",
      "-e",
      'tell application "Terminal" to activate',
    ],
  });
});

test("buildTerminalLaunchSpec focuses the attach tab on first macOS launch", () => {
  const spec = buildTerminalLaunchSpec({
    command: 'opencode attach "http://127.0.0.1:4310" --session "session-1"',
    platform: "darwin",
    env: {},
  });

  assert.match(
    spec.args.join("\n"),
    /set attachTab to do script "opencode attach \\"http:\/\/127\.0\.0\.1:4310\\" --session \\"session-1\\"" in window 1/,
  );
  assert.match(spec.args.join("\n"), /set selected tab of window 1 to attachTab/);
});

test("buildTerminalLaunchSpec uses the system terminal on Linux", () => {
  const spec = buildTerminalLaunchSpec({
    command: 'opencode attach "http://127.0.0.1:4310" --session "session-1"',
    platform: "linux",
    env: {},
  });

  assert.deepEqual(spec, {
    command: "x-terminal-emulator",
    args: [
      "-e",
      "/bin/sh",
      "-lc",
      'opencode attach "http://127.0.0.1:4310" --session "session-1"',
    ],
  });
});
