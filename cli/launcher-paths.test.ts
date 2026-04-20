import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveCliRepoRoot } = require("./launcher-paths.cjs") as {
  resolveCliRepoRoot: (scriptDir: string) => string;
};

test("resolveCliRepoRoot 会把 cli 目录解析回当前仓库根目录", () => {
  assert.equal(
    resolveCliRepoRoot("/Users/liyw/code/agent-team/cli"),
    "/Users/liyw/code/agent-team",
  );
});
