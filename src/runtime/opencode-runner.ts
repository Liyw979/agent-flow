import {
  OpenCodeClient,
  type OpenCodeExecutionResult,
  type OpenCodeRuntimeTarget,
  type SubmitMessagePayload,
} from "./opencode-client";

interface RunAgentPayload extends SubmitMessagePayload {
  runtimeTarget?: OpenCodeRuntimeTarget;
  projectPath?: string;
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
    const runtimeTarget = payload.runtimeTarget ?? payload.projectPath;
    if (!runtimeTarget) {
      throw new Error("OpenCode runner 缺少 runtimeTarget/projectPath");
    }

    while (true) {
      const startedAt = new Date().toISOString();
      const attemptResult = await this.executeAttempt(runtimeTarget, payload);
      if ("status" in attemptResult) {
        return attemptResult;
      }

      const recoveryAttempt = await this.recoverAttempt(
        runtimeTarget,
        payload.sessionId,
        startedAt,
        attemptResult.errorMessage,
      );
      if (recoveryAttempt.kind === "completed") {
        return recoveryAttempt.result;
      }
      await this.clock.sleep(RETRYABLE_EXECUTION_INTERVAL_MS);
    }
  }

  private async executeAttempt(
    runtimeTarget: OpenCodeRuntimeTarget | string,
    payload: RunAgentPayload,
  ): Promise<OpenCodeExecutionResult | AttemptFailure> {
    try {
      const submitted = await this.client.submitMessage(runtimeTarget, payload.sessionId, payload);
      const result = await this.client.resolveExecutionResult(
        runtimeTarget,
        payload.sessionId,
        submitted,
        payload.agent,
      );
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
    runtimeTarget: OpenCodeRuntimeTarget | string,
    sessionId: string,
    startedAt: string,
    errorMessage: string,
  ): Promise<RecoveryAttempt> {
    try {
      const recovered = await this.client.recoverExecutionResultAfterTransportError(
        runtimeTarget,
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
