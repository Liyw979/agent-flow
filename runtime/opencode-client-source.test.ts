import { expect, test } from "bun:test";
import fs from "node:fs";

const OPENCODE_CLIENT_SOURCE = fs.readFileSync(new URL("./opencode-client.ts", import.meta.url), "utf8");

test("OpenCode serve 启动进程时会把目标工作区作为 cwd 传入", () => {
  expect(OPENCODE_CLIENT_SOURCE).toMatch(/spawn\(\s*[\s\S]*?\{\s*cwd: state\.projectPath,/);
});

test("OpenCode serve 启动进程时不再注入 OPENCODE_CONFIG_DIR，避免 /session 卡死", () => {
  expect(OPENCODE_CLIENT_SOURCE).not.toMatch(/serverEnv\.OPENCODE_CONFIG_DIR\s*=/);
});

test("OpenCode serve 启动进程时不再显式传入 --port，改为解析实际监听地址", () => {
  expect(OPENCODE_CLIENT_SOURCE).not.toMatch(/["']--port["']/);
});

test("配置变化时不再触发 scheduleShutdown 重启链路", () => {
  expect(OPENCODE_CLIENT_SOURCE).not.toMatch(/scheduleShutdown\s*\(/);
});

test("createSession 超时后不再 shutdown 后自动重试", () => {
  expect(OPENCODE_CLIENT_SOURCE).not.toMatch(/create_session_timed_out/);
  expect(OPENCODE_CLIENT_SOURCE).not.toMatch(/await this\.shutdown\(normalized\.runtimeKey\)/);
  expect(OPENCODE_CLIENT_SOURCE).not.toMatch(/isRequestTimeoutError\s*\(/);
});
