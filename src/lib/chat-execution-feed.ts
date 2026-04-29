import type {
  AgentRuntimeSnapshot,
  MessageRecord,
  TopologyRecord,
} from "@shared/types";
import { withOptionalValue } from "@shared/object-utils";
import { parseTargetAgentIds } from "@shared/chat-message-format";
import {
  buildAgentExecutionHistoryItems,
  type AgentHistoryItem,
} from "./agent-history";
import { mergeTaskChatMessages, type ChatMessageItem } from "./chat-messages";

interface ChatExecutionWindow {
  id: string;
  agentId: string;
  anchorMessageId: string;
  triggerMessageId: string;
  startedAt: string;
  finalMessageId?: string;
  finalRawMessageId?: string;
  completedAt?: string;
}

type ChatFeedMessageItem = {
  type: "message";
  id: string;
  message: ChatMessageItem;
};

export type ChatFeedExecutionItem =
  | {
      type: "execution";
      id: string;
      state: "running";
      agentId: string;
      anchorMessageId: string;
      startedAt: string;
      historyItems: AgentHistoryItem[];
    }
  | {
      type: "execution";
      id: string;
      state: "completed";
      agentId: string;
      anchorMessageId: string;
      startedAt: string;
      completedAt: string;
      message: ChatMessageItem;
    };

type ChatFeedItem =
  | ChatFeedMessageItem
  | ChatFeedExecutionItem;

function isVisibleChatExecutionTrigger(message: MessageRecord) {
  return message.kind === "user"
    || message.kind === "agent-dispatch"
    || message.kind === "action-required-request";
}

function getVisibleChatExecutionTargets(message: MessageRecord): string[] {
  if (!isVisibleChatExecutionTrigger(message)) {
    return [];
  }
  return parseTargetAgentIds(message.targetAgentIds);
}

function getMergedMessageIndexByRawMessageId(mergedMessages: ChatMessageItem[]) {
  const indexByRawMessageId = new Map<string, number>();

  for (const [index, message] of mergedMessages.entries()) {
    for (const chainedMessage of message.messageChain) {
      indexByRawMessageId.set(chainedMessage.id, index);
    }
  }

  return indexByRawMessageId;
}

function getFinalRawMessageFromMergedMessage(message: ChatMessageItem): MessageRecord | null {
  for (const chainedMessage of message.messageChain) {
    if (chainedMessage.kind === "agent-final") {
      return chainedMessage;
    }
  }
  return null;
}

function getRuntimeExecutionStartedAtHint(runtimeSnapshot: AgentRuntimeSnapshot): string {
  const timestamps = [
    runtimeSnapshot.updatedAt ?? "",
    ...runtimeSnapshot.activities.map((activity) => activity.timestamp),
  ].filter((timestamp) => timestamp.length > 0);

  if (timestamps.length === 0) {
    return "";
  }

  return timestamps.reduce((earliest, current) => (current < earliest ? current : earliest));
}

function resolveRuntimeOnlyExecutionAnchor(
  mergedMessages: ChatMessageItem[],
  startedAtHint: string,
): {
  anchorMessageId: string;
  anchorTimestamp: string;
} | null {
  if (mergedMessages.length === 0) {
    return null;
  }

  const anchorMessage = [...mergedMessages]
    .reverse()
    .find((message) => startedAtHint.length === 0 || message.timestamp <= startedAtHint)
    ?? mergedMessages.at(-1)
    ?? null;
  if (!anchorMessage) {
    return null;
  }

  return {
    anchorMessageId: anchorMessage.id,
    anchorTimestamp: anchorMessage.timestamp,
  };
}

function buildRuntimeOnlyExecutionWindows(input: {
  mergedMessages: ChatMessageItem[];
  runtimeSnapshots: Record<string, AgentRuntimeSnapshot>;
  visibleWindows: ChatExecutionWindow[];
}): ChatExecutionWindow[] {
  const visibleRunningAgentIds = new Set(
    input.visibleWindows
      .filter((window) => !window.finalMessageId)
      .map((window) => window.agentId),
  );

  return Object.entries(input.runtimeSnapshots)
    .filter(([, runtimeSnapshot]) => runtimeSnapshot.runtimeStatus === "running")
    .filter(([agentId]) => !visibleRunningAgentIds.has(agentId))
    .flatMap(([agentId, runtimeSnapshot]) => {
      const startedAtHint = getRuntimeExecutionStartedAtHint(runtimeSnapshot);
      const anchor = resolveRuntimeOnlyExecutionAnchor(input.mergedMessages, startedAtHint);
      if (!anchor) {
        return [];
      }

      return [{
        id: `runtime:${agentId}:${runtimeSnapshot.sessionId ?? "no-session"}:${runtimeSnapshot.updatedAt ?? "no-update"}`,
        agentId,
        anchorMessageId: anchor.anchorMessageId,
        triggerMessageId: "",
        startedAt: startedAtHint && startedAtHint > anchor.anchorTimestamp
          ? startedAtHint
          : anchor.anchorTimestamp,
      }];
    });
}

export function buildChatExecutionWindows(
  messages: MessageRecord[],
  mergedMessages: ChatMessageItem[],
): ChatExecutionWindow[] {
  const mergedMessageIndexByRawMessageId = getMergedMessageIndexByRawMessageId(mergedMessages);
  const windows: ChatExecutionWindow[] = messages.flatMap((message) => {
    const targets = getVisibleChatExecutionTargets(message);
    if (targets.length === 0) {
      return [];
    }

    const mergedMessageIndex = mergedMessageIndexByRawMessageId.get(message.id);
    if (mergedMessageIndex === undefined) {
      return [];
    }

    const anchorMessageId = mergedMessages[mergedMessageIndex]?.id;
    if (!anchorMessageId) {
      return [];
    }

    return targets.map((agentId, targetIndex) => ({
      id: `${message.id}:${agentId}:${targetIndex}`,
      agentId,
      anchorMessageId,
      triggerMessageId: message.id,
      startedAt: message.timestamp,
    }));
  });

  const pendingWindowsByAgent = new Map<string, ChatExecutionWindow[]>();
  for (const window of windows) {
    const agentWindows = pendingWindowsByAgent.get(window.agentId) ?? [];
    agentWindows.push(window);
    pendingWindowsByAgent.set(window.agentId, agentWindows);
  }

  for (const mergedMessage of mergedMessages) {
    const finalRawMessage = getFinalRawMessageFromMergedMessage(mergedMessage);
    if (!finalRawMessage) {
      continue;
    }

    const candidateWindows = pendingWindowsByAgent.get(finalRawMessage.sender) ?? [];
    const matchedWindow = candidateWindows.find((window) =>
      !window.finalRawMessageId
      && window.startedAt.localeCompare(finalRawMessage.timestamp) <= 0,
    );
    if (!matchedWindow) {
      continue;
    }

    matchedWindow.finalMessageId = mergedMessage.id;
    matchedWindow.finalRawMessageId = finalRawMessage.id;
    matchedWindow.completedAt = finalRawMessage.timestamp;
  }

  return windows;
}

export function buildChatFeedItems(input: {
  messages: MessageRecord[];
  topology: Pick<TopologyRecord, "edges">;
  runtimeSnapshots: Record<string, AgentRuntimeSnapshot>;
}): ChatFeedItem[] {
  const orderedMessages = [...input.messages].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const mergedMessages = mergeTaskChatMessages(orderedMessages);
  const visibleExecutionWindows = buildChatExecutionWindows(orderedMessages, mergedMessages);
  const executionWindows = [
    ...visibleExecutionWindows,
    ...buildRuntimeOnlyExecutionWindows({
      mergedMessages,
      runtimeSnapshots: input.runtimeSnapshots,
      visibleWindows: visibleExecutionWindows,
    }),
  ];
  const absorbedMergedMessageIds = new Set(
    executionWindows
      .map((window) => window.finalMessageId)
      .filter((messageId): messageId is string => typeof messageId === "string"),
  );
  const windowsByAnchorMessageId = new Map<string, ChatExecutionWindow[]>();
  const mergedMessageById = new Map(mergedMessages.map((message) => [message.id, message]));

  for (const window of executionWindows) {
    const windows = windowsByAnchorMessageId.get(window.anchorMessageId) ?? [];
    windows.push(window);
    windowsByAnchorMessageId.set(window.anchorMessageId, windows);
  }

  const feedItems: ChatFeedItem[] = [];
  for (const mergedMessage of mergedMessages) {
    if (!absorbedMergedMessageIds.has(mergedMessage.id)) {
      feedItems.push({
        type: "message",
        id: mergedMessage.id,
        message: mergedMessage,
      });
    }

    const anchoredWindows = windowsByAnchorMessageId.get(mergedMessage.id) ?? [];
    for (const window of anchoredWindows) {
      if (window.finalMessageId) {
        const finalMessage = mergedMessageById.get(window.finalMessageId);
        if (!finalMessage || !window.completedAt) {
          continue;
        }

        feedItems.push({
          type: "execution",
          id: window.id,
          state: "completed",
          agentId: window.agentId,
          anchorMessageId: window.anchorMessageId,
          startedAt: window.startedAt,
          completedAt: window.completedAt,
          message: finalMessage,
        });
        continue;
      }

      feedItems.push({
        type: "execution",
        id: window.id,
        state: "running",
        agentId: window.agentId,
        anchorMessageId: window.anchorMessageId,
        startedAt: window.startedAt,
        historyItems: buildAgentExecutionHistoryItems({
          agentId: window.agentId,
          messages: orderedMessages,
          topology: input.topology,
          startedAt: window.startedAt,
          ...withOptionalValue({}, "runtimeSnapshot", input.runtimeSnapshots[window.agentId]),
        }),
      });
    }
  }

  return feedItems;
}
