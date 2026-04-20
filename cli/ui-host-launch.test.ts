import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBrowserOpenSpec,
  buildUiHostLaunchSpec,
  buildUiUrl,
} from "./ui-host-launch";

test("buildUiHostLaunchSpec 在源码运行时会复用当前 Node + tsx CLI 链路拉起内部 web-host", () => {
  const spec = buildUiHostLaunchSpec({
    mode: "source",
    nodeBinary: "/usr/local/bin/node",
    repoRoot: "/repo/agent-team",
    taskId: "task-123",
    port: 4310,
  });

  assert.equal(spec.command, "/usr/local/bin/node");
  assert.equal(spec.cwd, "/repo/agent-team");
  assert.match(spec.args.join(" "), /internal web-host/);
  assert.match(spec.args.join(" "), /--task-id task-123/);
  assert.doesNotMatch(spec.args.join(" "), /--cwd \/tmp\/project/);
  assert.match(spec.args.join(" "), /--port 4310/);
});

test("buildUiHostLaunchSpec 在单 exe 运行时会直接复用当前可执行文件拉起内部 web-host", () => {
  const spec = buildUiHostLaunchSpec({
    mode: "compiled",
    executablePath: "C:\\AgentTeam\\agent-team.exe",
    taskId: "task-123",
    port: 4310,
  });

  assert.equal(spec.command, "C:\\AgentTeam\\agent-team.exe");
  assert.deepEqual(spec.args, [
    "internal",
    "web-host",
    "--task-id",
    "task-123",
    "--port",
    "4310",
  ]);
});

test("buildUiUrl 只把 taskId 编进浏览器 URL，不再暴露 cwd", () => {
  assert.equal(
    buildUiUrl({
      port: 4310,
      taskId: "task 123",
    }),
    "http://127.0.0.1:4310/?taskId=task+123",
  );
});

test("buildBrowserOpenSpec 在 Windows 使用 start 打开浏览器", () => {
  const spec = buildBrowserOpenSpec({
    url: "http://127.0.0.1:4310/?taskId=task-123",
    platform: "win32",
  });

  assert.equal(spec.command, "cmd.exe");
  assert.deepEqual(spec.args, [
    "/d",
    "/s",
    "/c",
    "start",
    "",
    "\"http://127.0.0.1:4310/?taskId=task-123\"",
  ]);
});

test("buildBrowserOpenSpec 在 macOS 与 Linux 使用系统默认浏览器命令", () => {
  assert.deepEqual(
    buildBrowserOpenSpec({
      url: "http://127.0.0.1:4310/",
      platform: "darwin",
    }),
    {
      command: "open",
      args: ["http://127.0.0.1:4310/"],
    },
  );

  assert.deepEqual(
    buildBrowserOpenSpec({
      url: "http://127.0.0.1:4310/",
      platform: "linux",
    }),
    {
      command: "xdg-open",
      args: ["http://127.0.0.1:4310/"],
    },
  );
});
