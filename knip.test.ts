import assert from "node:assert/strict";
import test from "node:test";

import { createKnipConfig } from "./knip";

test("Knip 配置会忽略由 tsx --test 直接发现的 TSX 测试文件", () => {
  assert.deepEqual(createKnipConfig(), {
    entry: ["**/*.test.ts", "**/*.test.tsx"],
  });
});
