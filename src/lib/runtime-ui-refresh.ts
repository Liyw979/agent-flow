import type { AgentRuntimeSnapshot, MessageRecord, TaskSnapshot } from "@shared/types";

type RuntimeGapReason =
  | "aligned"
  | "missing-agent"
  | "session-lagging"
  | "status-lagging"
  | "message-lagging";

interface RuntimeGapInspection {
  agentId: string;
  reason: RuntimeGapReason;
}

function getSessionIdText(sessionId: string) {
  return sessionId;
}

function getRuntimeSessionIdText(snapshot: AgentRuntimeSnapshot) {
  return typeof snapshot.sessionId === "string" ? getSessionIdText(snapshot.sessionId) : "";
}

function getLatestAgentMessageTimestamp(messages: MessageRecord[], agentId: string): string {
  let latestTimestamp = "";
  for (const message of messages) {
    if (message.sender !== agentId) {
      continue;
    }
    if (message.timestamp > latestTimestamp) {
      latestTimestamp = message.timestamp;
    }
  }
  return latestTimestamp;
}

function shouldRequireFreshAgentMessage(snapshot: AgentRuntimeSnapshot): boolean {
  return snapshot.runtimeStatus === "completed"
    || snapshot.runtimeStatus === "action_required"
    || snapshot.runtimeStatus === "failed";
}

function resolveRuntimeGapReason(input: {
  task: TaskSnapshot;
  agentId: string;
  runtimeSnapshot: AgentRuntimeSnapshot;
}): RuntimeGapReason {
  const taskAgent = input.task.agents.find((agent) => agent.id === input.agentId);
  if (!taskAgent) {
    return "missing-agent";
  }
  if ((taskAgent.opencodeSessionId ?? "") !== getRuntimeSessionIdText(input.runtimeSnapshot)) {
    return "session-lagging";
  }
  if (taskAgent.status !== input.runtimeSnapshot.runtimeStatus) {
    return "status-lagging";
  }
  if (!shouldRequireFreshAgentMessage(input.runtimeSnapshot)) {
    return "aligned";
  }
  if (input.runtimeSnapshot.messageCount === 0 || !input.runtimeSnapshot.updatedAt) {
    return "aligned";
  }
  if (getLatestAgentMessageTimestamp(input.task.messages, input.agentId) < input.runtimeSnapshot.updatedAt) {
    return "message-lagging";
  }
  return "aligned";
}

export function inspectRuntimeGap(input: {
  task: TaskSnapshot;
  runtimeSnapshots: Record<string, AgentRuntimeSnapshot>;
}): RuntimeGapInspection {
  for (const [agentId, runtimeSnapshot] of Object.entries(input.runtimeSnapshots)) {
    const gapReason = resolveRuntimeGapReason({
      task: input.task,
      agentId,
      runtimeSnapshot,
    });
    if (gapReason !== "aligned") {
      return {
        agentId,
        reason: gapReason,
      };
    }
  }
  return {
    agentId: "",
    reason: "aligned",
  };
}

export function shouldRefreshUiSnapshotFromRuntimeGap(input: {
  task: TaskSnapshot;
  runtimeSnapshots: Record<string, AgentRuntimeSnapshot>;
}): boolean {
  return inspectRuntimeGap(input).reason !== "aligned";
}
