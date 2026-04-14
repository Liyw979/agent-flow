import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  getRepoBundledZellijPath,
  resolveZellijExecutable,
} from "./zellij-executable";

test("非 Windows 继续使用系统 zellij", () => {
  const resolved = resolveZellijExecutable({
    platform: "linux",
  });

  assert.deepEqual(resolved, {
    command: "zellij",
    available: true,
    bundled: false,
    candidates: ["zellij"],
  });
});

test("Windows 优先使用 resources/bin/zellij.exe", () => {
  const resourcesPath = "C:\\AgentFlow\\resources";
  const repoPath = getRepoBundledZellijPath();
  const bundledPath = path.join(resourcesPath, "bin", "zellij.exe");
  const resolved = resolveZellijExecutable({
    platform: "win32",
    resourcesPath,
    existsSync: (target) => target === repoPath || target === bundledPath,
  });

  assert.deepEqual(resolved, {
    command: bundledPath,
    available: true,
    bundled: true,
    candidates: [bundledPath, repoPath],
  });
});

test("Windows 在 resources/bin 缺失时回退到仓库内置 zellij.exe", () => {
  const resourcesPath = "C:\\AgentFlow\\resources";
  const repoPath = getRepoBundledZellijPath();
  const bundledPath = path.join(resourcesPath, "bin", "zellij.exe");
  const resolved = resolveZellijExecutable({
    platform: "win32",
    resourcesPath,
    existsSync: (target) => target === repoPath,
  });

  assert.deepEqual(resolved, {
    command: repoPath,
    available: true,
    bundled: true,
    candidates: [bundledPath, repoPath],
  });
});

test("Windows 找不到任何候选时返回 available=false", () => {
  const resourcesPath = "C:\\AgentFlow\\resources";
  const repoPath = getRepoBundledZellijPath();
  const bundledPath = path.join(resourcesPath, "bin", "zellij.exe");
  const resolved = resolveZellijExecutable({
    platform: "win32",
    resourcesPath,
    existsSync: () => false,
  });

  assert.deepEqual(resolved, {
    command: bundledPath,
    available: false,
    bundled: true,
    candidates: [bundledPath, repoPath],
  });
});
