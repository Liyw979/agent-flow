import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("GraphTaskState 与 createGraphTaskState 不再暴露无意义的 projectId 参数", () => {
  const gatingStateSource = fs.readFileSync(new URL("./gating-state.ts", import.meta.url), "utf8");
  const gatingRouterSource = fs.readFileSync(new URL("./gating-router.ts", import.meta.url), "utf8");

  assert.equal(gatingStateSource.includes("  projectId: string;"), false);
  assert.equal(gatingStateSource.includes("projectId: input.projectId"), false);
  assert.equal(gatingRouterSource.includes("  projectId: string;"), false);
});
