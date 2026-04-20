import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildCliLauncherSpec } = require("./launcher-spec.cjs") as {
  buildCliLauncherSpec: (input: {
    nodeBinary: string;
    repoRoot: string;
    argv: string[];
    env: Record<string, string | undefined>;
    platform?: NodeJS.Platform;
  }) => {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
  };
};

test("buildCliLauncherSpec 直接使用当前 Node 进程启动 CLI 入口", () => {
  const spec = buildCliLauncherSpec({
    nodeBinary: "/opt/homebrew/bin/node",
    repoRoot: "/repo/agent-team",
    argv: ["task", "run", "--message", "hello"],
    env: {
      PATH: "/usr/bin",
    },
  });

  assert.equal(spec.command, "/opt/homebrew/bin/node");
  assert.deepEqual(spec.args, [
    "--require",
    "/repo/agent-team/node_modules/tsx/dist/preflight.cjs",
    "--import",
    "file:///repo/agent-team/node_modules/tsx/dist/loader.mjs",
    "/repo/agent-team/cli/index.ts",
    "task",
    "run",
    "--message",
    "hello",
  ]);
  assert.equal(spec.cwd, "/repo/agent-team");
  assert.equal(spec.env.PATH, "/usr/bin");
});

test("buildCliLauncherSpec 在 Windows 仓库路径下也会生成合法的 loader file URL", () => {
  const spec = buildCliLauncherSpec({
    nodeBinary: "C:\\Program Files\\nodejs\\node.exe",
    repoRoot: "C:\\repo\\agent-team",
    argv: ["task", "attach", "Build"],
    platform: "win32",
    env: {
      PATH: "C:\\Windows\\System32",
    },
  });

  assert.equal(
    spec.args[3],
    "file:///C:/repo/agent-team/node_modules/tsx/dist/loader.mjs",
  );
});
