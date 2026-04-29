import test from "node:test";
import assert from "node:assert/strict";

import { shouldAcceptRuntimeRefresh } from "./runtime-refresh-gate";

test("较新的 runtime 响应可以覆盖已接受的旧响应", () => {
  assert.equal(shouldAcceptRuntimeRefresh({
    latestAcceptedRequestId: 2,
    requestId: 3,
  }), true);
});

test("晚到的旧 runtime 响应不会覆盖已接受的新响应", () => {
  assert.equal(shouldAcceptRuntimeRefresh({
    latestAcceptedRequestId: 3,
    requestId: 2,
  }), false);
});
