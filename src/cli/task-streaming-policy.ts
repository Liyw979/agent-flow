import type { ParsedCliCommand } from "./cli-command";

interface ResolveCliTaskStreamingPlanInput {
  command: Extract<ParsedCliCommand, { kind: "task.headless" | "task.ui" }>;
  isResume: boolean;
}

interface CliTaskStreamingPlan {
  enabled: boolean;
  includeHistory: boolean;
  printAttach: boolean;
  printMessages: boolean;
}

export function resolveCliTaskStreamingPlan(
  input: ResolveCliTaskStreamingPlanInput,
): CliTaskStreamingPlan {
  if (!input.isResume) {
    return {
      enabled: true,
      includeHistory: input.command.showMessage,
      printAttach: true,
      printMessages: input.command.showMessage,
    };
  }

  return {
    enabled: true,
    includeHistory: false,
    printAttach: false,
    printMessages: input.command.showMessage,
  };
}
