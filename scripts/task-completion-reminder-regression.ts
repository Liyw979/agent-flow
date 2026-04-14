import assert from "node:assert/strict";
import {
  acknowledgeTaskCompletionReminder,
  countVisibleTaskCompletionReminders,
  pruneTaskCompletionReminderAcks,
  shouldShowTaskCompletionReminder,
} from "../src/lib/task-completion-reminders";
import type { TaskRecord } from "../shared/types";

function createTask(
  overrides: Partial<Pick<TaskRecord, "id" | "status" | "completedAt">>,
): Pick<TaskRecord, "id" | "status" | "completedAt"> {
  return {
    id: "task-1",
    status: "pending",
    completedAt: null,
    ...overrides,
  };
}

async function main() {
  const completedAt = "2026-04-14T07:20:00.000Z";
  const rerunCompletedAt = "2026-04-14T07:25:00.000Z";

  const successTask = createTask({
    id: "task-success",
    status: "success",
    completedAt,
  });
  const failedTask = createTask({
    id: "task-failed",
    status: "failed",
    completedAt,
  });
  const runningTask = createTask({
    id: "task-running",
    status: "running",
    completedAt: null,
  });

  assert.equal(
    shouldShowTaskCompletionReminder(successTask, {}),
    true,
    "完成后的成功 Task 应显示左侧提醒",
  );
  assert.equal(
    shouldShowTaskCompletionReminder(failedTask, {}),
    true,
    "完成后的失败 Task 也应显示左侧提醒",
  );
  assert.equal(
    shouldShowTaskCompletionReminder(runningTask, {}),
    false,
    "运行中的 Task 不应显示完成提醒",
  );

  const acknowledged = acknowledgeTaskCompletionReminder({}, successTask);
  assert.deepEqual(
    acknowledged,
    {
      "task-success": completedAt,
    },
    "查看过完成 Task 后应记录本次 completedAt 作为已读标记",
  );
  assert.equal(
    shouldShowTaskCompletionReminder(successTask, acknowledged),
    false,
    "已读的完成 Task 不应继续显示提醒",
  );

  const rerunTask = createTask({
    id: "task-success",
    status: "success",
    completedAt: rerunCompletedAt,
  });
  assert.equal(
    shouldShowTaskCompletionReminder(rerunTask, acknowledged),
    true,
    "同一 Task 再次完成且 completedAt 变化后，提醒应重新出现",
  );

  const reminderCount = countVisibleTaskCompletionReminders(
    [successTask, failedTask, runningTask],
    acknowledged,
  );
  assert.equal(reminderCount, 1, "项目级提醒计数应只统计当前仍未读的完成 Task");

  const pruned = pruneTaskCompletionReminderAcks(
    {
      "task-success": completedAt,
      "task-stale": completedAt,
    },
    [rerunTask, failedTask],
  );
  assert.deepEqual({}, pruned, "过期 completedAt 或已不存在的 Task 标记应被清理");

  console.log(
    JSON.stringify(
      {
        acknowledged,
        rerunVisible: shouldShowTaskCompletionReminder(rerunTask, acknowledged),
        reminderCount,
        pruned,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
