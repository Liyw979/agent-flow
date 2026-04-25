import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("./opencode-preflight.ts", import.meta.url), "utf8");

test("ensureOpencodePreflightPassed 不再保留额外包装函数", () => {
  assert.doesNotMatch(SOURCE, /buildOpenCodePreflightErrorMessage/);
  assert.doesNotMatch(SOURCE, /isOpencodeHelpCommandSuccessful/);
  assert.doesNotMatch(SOURCE, /buildOpencodePreflightFailureMessage/);
  assert.doesNotMatch(SOURCE, /runOpenCodeHelpCheck/);
});

test("ensureOpencodePreflightPassed 直接根据 spawnSync 的 error 决定是否抛错", () => {
  assert.match(SOURCE, /const result = spawnSync\("opencode", \["--help"\], \{/);
  assert.match(SOURCE, /const errorMessage = result\.error \? result\.error\.message : null;/);
  assert.match(SOURCE, /if \(!errorMessage\) \{\s*return;\s*\}/);
});

test("ensureOpencodePreflightPassed 在失败时直接抛出固定文案", () => {
  assert.match(
    SOURCE,
    /throw new Error\(`\\`opencode --help\\` 执行失败（\$\{errorMessage\.trim\(\) \|\| "未知原因"\}），说明 opencode 无法正常使用，无法启动本应用`\);/,
  );
});
