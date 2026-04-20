import assert from "node:assert/strict";
import test from "node:test";

import { buildUiLaunchSpec } from "./ui-launch-spec";

test("buildUiLaunchSpec 在任务工作区之外启动前端进程，避免目标 cwd 缺少 package.json 导致 UI 拉起失败", () => {
  const spec = buildUiLaunchSpec({
    repoRoot: "/repo/agent-team",
    taskId: "task-123",
    taskCwd: "/Users/demo/code/empty",
  });

  assert.equal(spec.command, process.platform === "win32" ? "npm.cmd" : "npm");
  assert.deepEqual(spec.args, ["run", "electron:dev"]);
  assert.equal(spec.cwd, "/repo/agent-team");
  assert.equal(spec.env.AGENTFLOW_TASK_ID, "task-123");
  assert.equal(spec.env.AGENTFLOW_CWD, "/Users/demo/code/empty");
  assert.equal(spec.env.PATH, process.env.PATH);
});
