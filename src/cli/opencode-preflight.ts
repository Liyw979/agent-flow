import * as childProcess from "node:child_process";

export async function ensureOpencodePreflightPassed() {
  const result = childProcess.spawnSync("opencode", ["--help"], {
    encoding: "utf8",
    windowsHide: true,
    shell: true,
    env: process.env,
  });

  const exitStatus = typeof result.status === "number" ? result.status : -1;
  if (!result.error && exitStatus === 0) {
    return;
  }
  const stderrMessage = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const stdoutMessage = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const errorMessage = result.error
    ? result.error.message.trim()
    : stderrMessage || stdoutMessage || `退出码 ${exitStatus}`;
  throw new Error(`\`opencode --help\` 执行失败（${errorMessage}），说明 opencode 无法正常使用，无法启动本应用`);
}
