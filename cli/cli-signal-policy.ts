import type { ParsedCliCommand } from "./cli-command";

interface ResolveCliSignalPlanInput {
  commandKind: ParsedCliCommand["kind"];
  signal: NodeJS.Signals;
}

interface CliSignalPlan {
  shouldCleanupOpencode: boolean;
  awaitPendingTaskRuns: boolean;
  exitCode: number;
}

interface AttachSignalMatchInput {
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  activeSignal: NodeJS.Signals | null;
}

export function resolveCliSignalPlan(
  input: ResolveCliSignalPlanInput,
): CliSignalPlan {
  const exitCode = resolveSignalExitCode(input.signal);
  return {
    shouldCleanupOpencode: true,
    awaitPendingTaskRuns: false,
    exitCode,
  };
}

export function shouldTreatAttachSignalAsExpected(
  input: AttachSignalMatchInput,
): boolean {
  if (!input.activeSignal) {
    return false;
  }

  if (input.childSignal === input.activeSignal) {
    return true;
  }

  return input.childExitCode === resolveSignalExitCode(input.activeSignal);
}

function resolveSignalExitCode(signal: NodeJS.Signals): number {
  if (signal === "SIGINT") {
    return 130;
  }
  if (signal === "SIGTERM") {
    return 143;
  }
  return 1;
}
