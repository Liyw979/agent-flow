import {
  OpenCodeClient,
  type OpenCodeExecutionResult,
  type SubmitMessagePayload,
} from "./opencode-client";
import { runWithTaskLogScope } from "./app-log";

interface RunAgentPayload extends SubmitMessagePayload {
  cwd: string;
  taskId: string;
  sessionId: string;
}

const RETRYABLE_EXECUTION_INTERVAL_MS = 60_000;

interface RunnerClock {
  sleep(ms: number): Promise<void>;
}

const defaultRunnerClock: RunnerClock = {
  sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

type AttemptFailure =
  | {
      kind: "error-result";
      result: OpenCodeExecutionResult;
      errorMessage: string;
    }
  | {
      kind: "throw";
      error: Error;
      errorMessage: string;
    };

type RecoveryAttempt =
  | {
      kind: "none";
    }
  | {
      kind: "completed";
      result: OpenCodeExecutionResult;
    }
  | {
      kind: "error-result";
      result: OpenCodeExecutionResult;
    }
  | {
      kind: "throw";
      error: Error;
    };

export class OpenCodeRunner {
  constructor(
    private readonly client: OpenCodeClient,
    private readonly clock: RunnerClock = defaultRunnerClock,
  ) {}

  async run(payload: RunAgentPayload): Promise<OpenCodeExecutionResult> {
    return runWithTaskLogScope(payload.taskId, async () => {
      const { cwd } = payload;

      while (true) {
        const startedAt = new Date().toISOString();
        const attemptResult = await this.executeAttempt(cwd, payload);
        if ("status" in attemptResult) {
          return attemptResult;
        }

        const recoveryAttempt = await this.recoverAttempt(
          cwd,
          payload.sessionId,
          startedAt,
          attemptResult.errorMessage,
        );
        if (recoveryAttempt.kind === "completed") {
          return recoveryAttempt.result;
        }
        await this.clock.sleep(RETRYABLE_EXECUTION_INTERVAL_MS);
      }
    });
  }

  private async executeAttempt(
    cwd: string,
    payload: RunAgentPayload,
  ): Promise<OpenCodeExecutionResult | AttemptFailure> {
    try {
      const submitted = await this.client.submitMessage(cwd, payload.sessionId, payload);
      const result = await this.client.resolveExecutionResult(cwd, payload.sessionId, submitted);
      if (result.status === "completed") {
        return result;
      }
      return {
        kind: "error-result",
        result,
        errorMessage: result.rawMessage.error || result.finalMessage,
      };
    } catch (error) {
      const normalizedError = this.normalizeError(error);
      return {
        kind: "throw",
        error: normalizedError,
        errorMessage: normalizedError.message,
      };
    }
  }

  private async recoverAttempt(
    cwd: string,
    sessionId: string,
    startedAt: string,
    errorMessage: string,
  ): Promise<RecoveryAttempt> {
    try {
      const recovered = await this.client.recoverExecutionResultAfterTransportError(
        cwd,
        sessionId,
        startedAt,
        errorMessage,
      );
      if (!recovered) {
        return {
          kind: "none",
        };
      }
      if (recovered.status === "completed") {
        return {
          kind: "completed",
          result: recovered,
        };
      }
      return {
        kind: "error-result",
        result: recovered,
      };
    } catch (error) {
      return {
        kind: "throw",
        error: this.normalizeError(error),
      };
    }
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    return new Error(String(error));
  }
}
