import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { toUtcIsoTimestamp } from "@shared/types";

const INVALID_LOG_FILE_SEGMENT_PATTERN = /[\\/:*?"<>|]/;

let appLogRootPath: string | null = null;
const taskLogScope = new AsyncLocalStorage<string>();

export function buildTaskLogFilePath(userDataPath: string, taskId: string) {
  return path.join(userDataPath, "logs", "tasks", `${taskId}.log`);
}

function isTaskLogId(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0
    && normalized !== "."
    && normalized !== ".."
    && !INVALID_LOG_FILE_SEGMENT_PATTERN.test(normalized);
}

function resolveTaskLogId(): string | null {
  const currentTaskId = taskLogScope.getStore();
  if (typeof currentTaskId === "string" && isTaskLogId(currentTaskId)) {
    return currentTaskId.trim();
  }
  return null;
}

export function initAppFileLogger(userDataPath: string) {
  const taskLogDir = path.join(userDataPath, "logs", "tasks");
  fs.mkdirSync(taskLogDir, { recursive: true });
  appLogRootPath = userDataPath;
  return taskLogDir;
}

export function runWithTaskLogScope<T>(taskId: string, action: () => T): T {
  return taskLogScope.run(taskId, action);
}

export function appendAppLog(
  level: "info" | "warn" | "error",
  event: string,
  payload: Record<string, unknown>,
) {
  if (!appLogRootPath) {
    return;
  }
  const taskId = resolveTaskLogId();
  if (!taskId) {
    return;
  }
  const appLogFilePath = buildTaskLogFilePath(appLogRootPath, taskId);

  const record = {
    timestamp: toUtcIsoTimestamp(new Date().toISOString()),
    level,
    event,
    taskId,
    ...payload,
  };

  try {
    fs.mkdirSync(path.dirname(appLogFilePath), { recursive: true });
    fs.appendFileSync(appLogFilePath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Never let log write failures block the main flow.
  }
}
