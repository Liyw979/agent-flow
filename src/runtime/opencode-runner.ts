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

const RETRYABLE_EXECUTION_MAX_ATTEMPTS = 3;

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
  constructor(private readonly client: OpenCodeClient) {}

  async run(payload: RunAgentPayload): Promise<OpenCodeExecutionResult> {
    const runtimeTarget = payload.runtimeTarget ?? payload.projectPath;
    if (!runtimeTarget) {
      throw new Error("OpenCode runner 缺少 runtimeTarget/projectPath");
    }

    let attempt = 1;
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
      if (attempt < RETRYABLE_EXECUTION_MAX_ATTEMPTS) {
        attempt += 1;
        continue;
      }
      if (recoveryAttempt.kind === "error-result") {
        return recoveryAttempt.result;
      }
      if (attemptResult.kind === "error-result") {
        return attemptResult.result;
      }
      if (recoveryAttempt.kind === "throw") {
        throw recoveryAttempt.error;
      }
      throw attemptResult.error;
    }
  }

  private async executeAttempt(
    runtimeTarget: OpenCodeRuntimeTarget | string,
    payload: RunAgentPayload,
  ): Promise<OpenCodeExecutionResult | AttemptFailure> {
    try {
      const submitted = await this.client.submitMessage(runtimeTarget, payload.sessionId, payload);
      const result = await this.client.resolveExecutionResult(runtimeTarget, payload.sessionId, submitted);
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
