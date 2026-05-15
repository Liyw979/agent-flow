import { test } from "bun:test";
import assert from "node:assert/strict";

import { fetchUiSnapshot } from "./web-api";

test("fetchUiSnapshot 会按 JSON 解析响应体", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      workspace: null,
      task: null,
      launchCwd: "/tmp/demo",
      taskLogFilePath: "/tmp/demo.log",
      taskUrl: "http://localhost:4310/",
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const payload = await fetchUiSnapshot();
    assert.equal(requestedUrl, "/api/ui-snapshot");
    assert.equal(payload.launchCwd, "/tmp/demo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
