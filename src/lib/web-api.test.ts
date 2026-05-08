import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchUiSnapshot,
  readLaunchTaskIdFromSearch,
} from "./web-api";

test("readLaunchTaskIdFromSearch 会把缺失或空白 taskId 统一归一成 null", () => {
  assert.equal(readLaunchTaskIdFromSearch(""), null);
  assert.equal(readLaunchTaskIdFromSearch("?taskId="), null);
  assert.equal(readLaunchTaskIdFromSearch("?taskId=%20%20%20"), null);
  assert.equal(readLaunchTaskIdFromSearch("?taskId=task-123"), "task-123");
});

test("fetchUiSnapshot 会按 JSON5 解析响应体", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(`{
    workspace: null,
    task: null,
    launchTaskId: "task-123",
    launchCwd: "/tmp/demo",
    taskLogFilePath: "/tmp/demo.log",
    taskUrl: "http://localhost:4310/?taskId=task-123",
  }`, { status: 200 });
  }) as typeof fetch;

  try {
    const payload = await fetchUiSnapshot({ taskId: "task-123" });
    assert.equal(requestedUrl, "/api/ui-snapshot?taskId=task-123");
    assert.equal(payload.launchTaskId, "task-123");
    assert.equal(payload.launchCwd, "/tmp/demo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
