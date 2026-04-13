import { OpenCodeClient, type OpenCodeExecutionResult, type SubmitMessagePayload } from "./opencode-client";

export interface RunAgentPayload extends SubmitMessagePayload {
  projectPath: string;
  sessionId: string;
}

export class OpenCodeRunner {
  constructor(private readonly client: OpenCodeClient) {}

  async run(payload: RunAgentPayload): Promise<OpenCodeExecutionResult> {
    const submitted = await this.client.submitMessage(payload.projectPath, payload.sessionId, payload);
    return this.client.resolveExecutionResult(payload.projectPath, payload.sessionId, submitted);
  }
}
