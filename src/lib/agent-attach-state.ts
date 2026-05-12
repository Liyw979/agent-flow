type AttachSessionState =
  | {
      kind: "present";
      sessionId: string;
    }
  | {
      kind: "absent";
    };

interface AgentAttachButtonState {
  disabled: boolean;
  title: string;
  label: "attach";
}

export function resolveSessionStateFromSessionIdText(sessionIdText: string): AttachSessionState {
  return sessionIdText.length > 0
    ? {
        kind: "present",
        sessionId: sessionIdText,
      }
    : {
        kind: "absent",
      };
}

export function resolveAgentAttachButtonState(input: {
  agentId: string;
  sessionState: AttachSessionState;
}): AgentAttachButtonState {
  const hasSession = input.sessionState.kind === "present";
  return {
    disabled: !hasSession,
    title: hasSession
      ? `attach 到 ${input.agentId}`
      : `${input.agentId} 当前还没有可 attach 的 OpenCode session。`,
    label: "attach",
  };
}
