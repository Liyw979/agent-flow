export interface UiLaunchSpecInput {
  repoRoot: string;
  taskId: string;
  taskCwd: string;
}

export interface UiLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function buildUiLaunchSpec(input: UiLaunchSpecInput): UiLaunchSpec {
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "electron:dev"],
    cwd: input.repoRoot,
    env: {
      ...process.env,
      AGENTFLOW_TASK_ID: input.taskId,
      AGENTFLOW_CWD: input.taskCwd,
    },
  };
}
