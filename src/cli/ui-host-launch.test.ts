import assert from "node:assert/strict";
import { test } from "bun:test";

import { buildUiUrl } from "./ui-host-launch";

test("buildUiUrl 只输出当前进程的浏览器入口地址", () => {
  assert.equal(
    buildUiUrl({
      port: 4310,
    }),
    "http://localhost:4310/",
  );
});
