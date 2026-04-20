import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCliSignalPlan,
  shouldTreatAttachSignalAsExpected,
} from "./cli-signal-policy";

test("Ctrl+C 会为当前 CLI 会话触发 opencode 清理并快速退出", () => {
  assert.deepEqual(
    resolveCliSignalPlan({
      commandKind: "task.attach",
      signal: "SIGINT",
    }),
    {
      shouldCleanupOpencode: true,
      awaitPendingTaskRuns: false,
      exitCode: 130,
    },
  );
});

test("attach 子进程收到与 CLI 相同的中断信号时，不应再当成额外异常", () => {
  assert.equal(
    shouldTreatAttachSignalAsExpected({
      childExitCode: null,
      childSignal: "SIGINT",
      activeSignal: "SIGINT",
    }),
    true,
  );
});

test("attach 子进程把 Ctrl+C 映射成 130 退出码时，也应视为当前中断链路的一部分", () => {
  assert.equal(
    shouldTreatAttachSignalAsExpected({
      childExitCode: 130,
      childSignal: null,
      activeSignal: "SIGINT",
    }),
    true,
  );
});
