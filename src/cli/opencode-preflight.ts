import { spawnSync } from "node:child_process";

export async function ensureOpencodePreflightPassed() {
  const result = spawnSync("opencode", ["--help"], {
    encoding: "utf8",
    windowsHide: true,
  });

  const errorMessage = result.error ? result.error.message : null;
  if (!errorMessage) {
    return;
  }
  throw new Error(`\`opencode --help\` 执行失败（${errorMessage.trim() || "未知原因"}），说明 opencode 无法正常使用，无法启动本应用`);
}
