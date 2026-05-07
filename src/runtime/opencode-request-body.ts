import { toOpenCodeAgentId } from "./opencode-agent-id";

interface SubmitMessageBodyInput {
  agent: string;
  content: string;
}

export function buildSubmitMessageBody(payload: SubmitMessageBodyInput): Record<string, unknown> {
  return {
    agent: toOpenCodeAgentId(payload.agent),
    parts: [
      {
        type: "text",
        text: payload.content,
      },
    ],
  };
}
