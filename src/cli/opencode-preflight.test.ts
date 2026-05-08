import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureOpencodePreflightPassed } from "./opencode-preflight";

function createFakeOpencodeExecutable(scriptBody: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-team-opencode-"));
  const fileName = process.platform === "win32" ? "opencode.cmd" : "opencode";
  const filePath = path.join(tempDir, fileName);
  fs.writeFileSync(filePath, scriptBody, "utf8");
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o755);
  }
  return tempDir;
}

test("ensureOpencodePreflightPassed 在 opencode 可执行时直接通过", async () => {
  const scriptBody = process.platform === "win32"
    ? "@echo off\r\necho OpenCode help\r\nexit /b 0\r\n"
    : "#!/bin/sh\necho 'OpenCode help'\nexit 0\n";
  const tempDir = createFakeOpencodeExecutable(scriptBody);
  const originalPath = process.env["PATH"] || "";
  process.env["PATH"] = `${tempDir}${path.delimiter}${originalPath}`;
  try {
    await ensureOpencodePreflightPassed();
  } finally {
    process.env["PATH"] = originalPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ensureOpencodePreflightPassed 在 opencode 返回非零退出码时抛出固定文案", async () => {
  const scriptBody = process.platform === "win32"
    ? "@echo off\r\necho fake preflight failure 1>&2\r\nexit /b 17\r\n"
    : "#!/bin/sh\necho 'fake preflight failure' >&2\nexit 17\n";
  const tempDir = createFakeOpencodeExecutable(scriptBody);
  const originalPath = process.env["PATH"] || "";
  process.env["PATH"] = `${tempDir}${path.delimiter}${originalPath}`;
  try {
    await assert.rejects(
      ensureOpencodePreflightPassed(),
      new Error("`opencode --help` 执行失败（fake preflight failure），说明 opencode 无法正常使用，无法启动本应用"),
    );
  } finally {
    process.env["PATH"] = originalPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
