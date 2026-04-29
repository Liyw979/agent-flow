import type { AgentRuntimeSnapshot, TaskSnapshot } from "@shared/types";
import {
  resolveAgentAttachButtonState,
  resolveRuntimePreferredSessionState,
  resolveSessionStateFromSessionIdText,
} from "./agent-attach-state";

type ChatTaskAgentEntry = Pick<TaskSnapshot["agents"][number], "id" | "opencodeSessionId">;
type ChatRuntimeSnapshotMap = Record<string, Pick<AgentRuntimeSnapshot, "sessionId">>;

type HiddenChatAttachButtonState = {
  visible: false;
};

type VisibleChatAttachButtonState = {
  visible: true;
  agentId: string;
  disabled: boolean;
  title: string;
  label: "attach" | "打开中";
};

type ChatAttachButtonState =
  | HiddenChatAttachButtonState
  | VisibleChatAttachButtonState;

export function resolveChatMessageAttachButtonState(input: {
  sender: string;
  taskAgents: ReadonlyArray<ChatTaskAgentEntry>;
  runtimeSnapshots: ChatRuntimeSnapshotMap;
  openingAgentTerminalId: string;
}): ChatAttachButtonState {
  if (input.sender === "user" || input.sender === "system") {
    return {
      visible: false,
    };
  }

  const taskAgent = input.taskAgents.find((entry) => entry.id === input.sender);
  const runtimeSnapshot = Object.hasOwn(input.runtimeSnapshots, input.sender)
    ? input.runtimeSnapshots[input.sender]
    : undefined;
  const attachState = resolveAgentAttachButtonState({
    agentId: input.sender,
    sessionState: resolveRuntimePreferredSessionState({
      taskSessionState: resolveSessionStateFromSessionIdText(taskAgent?.opencodeSessionId ?? ""),
      runtimeSnapshotState: runtimeSnapshot
        ? {
            kind: "known",
            sessionState: resolveSessionStateFromSessionIdText(runtimeSnapshot.sessionId ?? ""),
          }
        : {
            kind: "unknown",
          },
    }),
    openingState: input.openingAgentTerminalId === input.sender ? "opening" : "idle",
  });

  return {
    visible: true,
    agentId: input.sender,
    disabled: attachState.disabled,
    title: attachState.title,
    label: attachState.label,
  };
}
