import assert from "node:assert/strict";
import test from "node:test";

import { buildUiUrl } from "./ui-host-launch";

test("buildUiUrl 只把 taskId 编进浏览器 URL，不再暴露 cwd", () => {
  assert.equal(
    buildUiUrl({
      port: 4310,
      taskId: "task 123",
    }),
    "http://127.0.0.1:4310/?taskId=task+123",
  );
});
