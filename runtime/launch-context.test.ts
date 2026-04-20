import assert from "node:assert/strict";
import test from "node:test";

import { resolveLaunchContext } from "./launch-context";

test("resolveLaunchContext 在启动入口没有透传自定义 CLI 参数时，会回退读取环境变量", () => {
  const launch = resolveLaunchContext({
    argv: ["node", "cli/index.ts"],
    env: {
      AGENT_TEAM_TASK_ID: "task-123",
      AGENT_TEAM_CWD: "/Users/demo/code/empty",
    },
    defaultCwd: "/repo/agent-team",
  });

  assert.deepEqual(launch, {
    launchTaskId: "task-123",
    launchCwd: "/Users/demo/code/empty",
  });
});

test("resolveLaunchContext 只识别新的 agent-team 启动参数", () => {
  const launch = resolveLaunchContext({
    argv: ["node", "cli/index.ts", "--agent-team-task-id", "task-456", "--agent-team-cwd", "/tmp/agent-team"],
    env: {},
    defaultCwd: "/repo/agent-team",
  });

  assert.deepEqual(launch, {
    launchTaskId: "task-456",
    launchCwd: "/tmp/agent-team",
  });
});
