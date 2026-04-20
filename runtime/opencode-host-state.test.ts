import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOpenCodeHostConfigDigest,
  isOpenCodeHostStateReusable,
  normalizeOpenCodeHostStateRecord,
} from "./opencode-host-state";

test("normalizeOpenCodeHostStateRecord 会拒绝缺字段记录", () => {
  assert.equal(normalizeOpenCodeHostStateRecord({
    pid: 123,
    port: 4096,
    cwd: "/tmp/demo",
    startedAt: "2026-04-20T00:00:00.000Z",
  }), null);
});

test("isOpenCodeHostStateReusable 只有 cwd 和 configDigest 都匹配时才返回 true", () => {
  const configDigest = buildOpenCodeHostConfigDigest("{\"agent\":{}}");
  const otherDigest = buildOpenCodeHostConfigDigest("{\"agent\":{\"mode\":\"build\"}}");
  const record = normalizeOpenCodeHostStateRecord({
    pid: 123,
    port: 4096,
    cwd: "/tmp/demo",
    startedAt: "2026-04-20T00:00:00.000Z",
    configDigest,
    version: "1",
  });

  assert.notEqual(record, null);
  assert.equal(isOpenCodeHostStateReusable(record, {
    cwd: "/tmp/demo",
    configDigest,
  }), true);
  assert.equal(isOpenCodeHostStateReusable(record, {
    cwd: "/tmp/other",
    configDigest,
  }), false);
  assert.equal(isOpenCodeHostStateReusable(record, {
    cwd: "/tmp/demo",
    configDigest: otherDigest,
  }), false);
});
