import test from "node:test";
import assert from "node:assert/strict";

import { getOpenCodeRequestTimeoutMs, shouldTimeboxOpenCodeRequest } from "./opencode-request-timeout";

test("create session 请求继续使用短超时，避免再次挂成整分钟", () => {
  assert.equal(shouldTimeboxOpenCodeRequest({
    pathname: "/session",
    method: "POST",
  }), true);
  assert.equal(getOpenCodeRequestTimeoutMs(), 12_000);
});

test("session message 请求不设置超时，避免长执行任务被请求层提前中断", () => {
  assert.equal(shouldTimeboxOpenCodeRequest({
    pathname: "/session/ses_demo/message",
    method: "POST",
  }), false);
});
