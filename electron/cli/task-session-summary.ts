import { buildCliTaskShowCommand } from "@shared/terminal-commands";

interface TaskSessionSummaryInput {
  logFilePath: string;
  taskId: string;
  cwd?: string;
}

export function renderTaskSessionSummary(input: TaskSessionSummaryInput): string {
  return [
    `日志: ${input.logFilePath}`,
    `taskId: ${input.taskId}`,
    `show: ${buildCliTaskShowCommand(input.taskId, input.cwd)}`,
  ].join("\n");
}
