import assert from "node:assert/strict";
import test from "node:test";

import { resolveCliTaskStreamingPlan } from "./task-streaming-policy";

test("task headless 默认只打印 attach 调试信息，不展示消息记录", () => {
  assert.deepEqual(
    resolveCliTaskStreamingPlan({
      command: {
        kind: "task.headless",
        showMessage: false,
      },
      isResume: false,
    }),
    {
      enabled: true,
      includeHistory: false,
      printAttach: true,
      printMessages: false,
    },
  );
});

test("task headless 传 --show-message 后会打印完整群聊", () => {
  assert.deepEqual(
    resolveCliTaskStreamingPlan({
      command: {
        kind: "task.headless",
        showMessage: true,
      },
      isResume: false,
    }),
    {
      enabled: true,
      includeHistory: true,
      printAttach: true,
      printMessages: true,
    },
  );
});

test("task ui 新建任务时也会打印完整群聊，避免终端静默", () => {
  assert.deepEqual(
    resolveCliTaskStreamingPlan({
      command: {
        kind: "task.ui",
      },
      isResume: false,
    }),
    {
      enabled: true,
      includeHistory: true,
      printAttach: true,
      printMessages: true,
    },
  );
});
