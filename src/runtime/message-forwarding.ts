import {
  extractAgentFinalDisplayContent,
  getActionRequiredRequestDisplayBody,
} from "../lib/chat-messages";
import {
  getMessageTargetAgentIds,
  getMessageSenderDisplayName,
  isAgentFinalMessageRecord,
  isActionRequiredRequestMessageRecord,
  type InitialMessageRouting,
  type MessageRecord,
  type TopologyEdgeMessageMode,
} from "@shared/types";

type MinimalMessage = MessageRecord;
export const NONE_MODE_PLACEHOLDER_MESSAGE = "continue";

type DownstreamForwardedContext =
  | {
      kind: "empty";
    }
  | {
      kind: "forwarded";
      agentMessage: string;
    };

function extractMention(content: string): string | undefined {
  const match = content.match(/@([^\s]+)/u);
  return match?.[1];
}

export function buildUserHistoryContent(content: string, targetAgentId: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return `@${targetAgentId}`;
  }
  if (extractMention(trimmed)) {
    return content;
  }
  return `@${targetAgentId} ${trimmed}`;
}

export function buildSourceAgentMessageSectionLabel(sourceAgentId: string): string {
  const displayName = sourceAgentId.trim() || "来源 Agent";
  return `[From ${displayName} Agent]`;
}

export function stripTargetMention(content: string, targetAgentId: string): string {
  const trimmed = stripLeadingTargetMention(content, targetAgentId);
  if (!trimmed) {
    return "";
  }

  const mentionToken = `@${targetAgentId}`;
  const trailingPattern = new RegExp(`(?:^|\\s)${escapeRegExp(mentionToken)}\\s*$`, "u");
  const strippedTrailing = trimmed.replace(trailingPattern, "").trimEnd();
  return strippedTrailing || trimmed;
}

function normalizeContentForDedup(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function buildDownstreamForwardedContextFromMessages(
  messages: MinimalMessage[],
  sourceContent: string,
  options: {
    messageMode: TopologyEdgeMessageMode;
    initialMessageRouting: InitialMessageRouting;
    sourceAgentId: string;
    initialMessageSourceAliasesByAgentId: Record<string, string[]>;
    initialMessageForwardedAgentMessageByAgentId: Record<string, string>;
    globalSourceOrder: string[];
  },
): DownstreamForwardedContext {
  const messageMode = options.messageMode;
  const latestSourceContent = sourceContent.trim();
  const agentMessage = resolveForwardedAgentMessage(
    messages,
    latestSourceContent,
    messageMode,
    options.initialMessageRouting,
    options.sourceAgentId,
    options.initialMessageSourceAliasesByAgentId,
    options.initialMessageForwardedAgentMessageByAgentId,
    options.globalSourceOrder,
  );
  if (!agentMessage) {
    return { kind: "empty" };
  }
  return {
    kind: "forwarded",
    agentMessage,
  };
}

function resolveForwardedAgentMessage(
  messages: MinimalMessage[],
  latestSourceContent: string,
  messageMode: TopologyEdgeMessageMode,
  initialMessageRouting: InitialMessageRouting,
  sourceAgentId: string,
  initialMessageSourceAliasesByAgentId: Record<string, string[]>,
  initialMessageForwardedAgentMessageByAgentId: Record<string, string>,
  globalSourceOrder: string[],
): string {
  const orderedEntries = buildOrderedForwardingEntries(
    messages,
    latestSourceContent,
    messageMode,
    initialMessageRouting,
    sourceAgentId,
    initialMessageSourceAliasesByAgentId,
    initialMessageForwardedAgentMessageByAgentId,
    globalSourceOrder,
  );
  const aggregatedSections = aggregateForwardingEntries(orderedEntries);
  if (aggregatedSections.length === 0) {
    return "";
  }
  return aggregatedSections.join("\n\n");
}

type ForwardingEntry = {
  sourceAgentId: string;
  content: string;
};

type InitialMessageEntryResolution =
  | {
      kind: "found";
      entry: ForwardingEntry;
    }
  | {
      kind: "missing";
    };

function buildDefaultForwardingEntries(
  latestSourceContent: string,
  messageMode: TopologyEdgeMessageMode,
  sourceAgentId: string,
): ForwardingEntry[] {
  if (messageMode === "none") {
    return [];
  }

  const content = latestSourceContent || "（该上游 Agent 未返回可继续流转的正文。）";
  return [{ sourceAgentId, content }];
}

function buildOrderedForwardingEntries(
  messages: MinimalMessage[],
  latestSourceContent: string,
  messageMode: TopologyEdgeMessageMode,
  initialMessageRouting: InitialMessageRouting,
  sourceAgentId: string,
  initialMessageSourceAliasesByAgentId: Record<string, string[]>,
  initialMessageForwardedAgentMessageByAgentId: Record<string, string>,
  globalSourceOrder: string[],
): ForwardingEntry[] {
  const defaultEntries = buildDefaultForwardingEntries(
    latestSourceContent,
    messageMode,
    sourceAgentId,
  );
  const initialEntries = buildInitialMessageEntries(
    messages,
    initialMessageRouting,
    initialMessageSourceAliasesByAgentId,
    initialMessageForwardedAgentMessageByAgentId,
  );
  return sortForwardingEntriesByGlobalOrder(
    [...defaultEntries, ...initialEntries],
    globalSourceOrder,
    initialMessageSourceAliasesByAgentId,
  );
}

function buildInitialMessageEntries(
  messages: MinimalMessage[],
  initialMessageRouting: InitialMessageRouting,
  initialMessageSourceAliasesByAgentId: Record<string, string[]>,
  initialMessageForwardedAgentMessageByAgentId: Record<string, string>,
): ForwardingEntry[] {
  if (initialMessageRouting.mode !== "list") {
    return [];
  }

  return initialMessageRouting.agentIds.map((agentId) => {
    const resolution = resolveInitialMessageEntryByAgentId(
      messages,
      agentId,
      initialMessageSourceAliasesByAgentId[agentId] ?? [],
      initialMessageForwardedAgentMessageByAgentId[agentId] ?? "",
    );
    if (resolution.kind === "missing") {
      throw new Error(`initialMessage 指定的来源 Agent 缺少可转发消息：${agentId}`);
    }
    return resolution.entry;
  });
}

function sortForwardingEntriesByGlobalOrder(
  entries: ForwardingEntry[],
  globalSourceOrder: string[],
  initialMessageSourceAliasesByAgentId: Record<string, string[]>,
): ForwardingEntry[] {
  const sourceOrderIndex = new Map<string, number>();
  globalSourceOrder.forEach((agentId, index) => {
    if (!sourceOrderIndex.has(agentId)) {
      sourceOrderIndex.set(agentId, index);
    }
  });
  const normalizeOrderIndex = (entry: ForwardingEntry): number => {
    const directIndex = sourceOrderIndex.get(entry.sourceAgentId);
    if (directIndex !== undefined) {
      return directIndex;
    }
    for (const [agentId, aliases] of Object.entries(initialMessageSourceAliasesByAgentId)) {
      if (!matchesAgentIdOrAliases(entry.sourceAgentId, agentId, aliases)) {
        continue;
      }
      const aliasIndex = sourceOrderIndex.get(agentId);
      if (aliasIndex !== undefined) {
        return aliasIndex;
      }
    }
    return Number.MAX_SAFE_INTEGER;
  };

  return entries
    .map((entry, index) => ({
      entry,
      index,
      orderIndex: normalizeOrderIndex(entry),
    }))
    .sort((left, right) => left.orderIndex - right.orderIndex || left.index - right.index)
    .map((item) => item.entry);
}

function aggregateForwardingEntries(entries: ForwardingEntry[]): string[] {
  const contentsBySource = new Map<string, string[]>();
  const normalizedContentBySource = new Map<string, Set<string>>();
  for (const entry of entries) {
    const normalizedSourceAgentId = entry.sourceAgentId.trim();
    const normalizedContent = normalizeContentForDedup(entry.content);
    if (!normalizedSourceAgentId || !normalizedContent) {
      continue;
    }
    const sourceContents = contentsBySource.get(normalizedSourceAgentId) ?? [];
    const sourceSeen = normalizedContentBySource.get(normalizedSourceAgentId) ?? new Set<string>();
    if (sourceSeen.has(normalizedContent)) {
      continue;
    }
    sourceSeen.add(normalizedContent);
    sourceContents.push(entry.content.trim());
    contentsBySource.set(normalizedSourceAgentId, sourceContents);
    normalizedContentBySource.set(normalizedSourceAgentId, sourceSeen);
  }
  return [...contentsBySource.entries()].map(([sourceAgentId, sourceContents]) =>
    `${buildSourceAgentMessageSectionLabel(sourceAgentId)}\n${sourceContents.join("\n\n")}`,
  );
}

function resolveInitialMessageEntryByAgentId(
  messages: MinimalMessage[],
  agentId: string,
  aliases: string[],
  forwardedAgentMessage: string,
): InitialMessageEntryResolution {
  const candidates = [...new Set([
    ...aliases.map((value) => value.trim()).filter(Boolean),
    agentId.trim(),
  ])];
  for (const candidate of candidates) {
    const matchedMessage = messages.find((message) =>
      isForwardableInitialSourceMessage(message)
      && matchesForwardingMessageAgentAlias(message, candidate),
    );
    if (!matchedMessage) {
      continue;
    }
    const content = normalizeForwardableMessageContent(matchedMessage);
    if (!content) {
      continue;
    }
    const sourceForwardedEntry = extractForwardingEntriesFromContent(
      forwardedAgentMessage.trim(),
    ).find((entry) => matchesAlias(entry.sourceAgentId, candidate));
    return {
      kind: "found",
      entry: {
        sourceAgentId: matchedMessage.sender.trim() || agentId,
        content: sourceForwardedEntry?.content.trim() || content,
      },
    };
  }
  return {
    kind: "missing",
  };
}

function extractForwardingEntriesFromContent(content: string): ForwardingEntry[] {
  const trimmed = content.trim();
  if (!trimmed.startsWith("[From ")) {
    return [];
  }

  const sectionPattern = /^\[From ([^\]]+?) Agent\]\n/gu;
  const matches = [...trimmed.matchAll(sectionPattern)];
  if (matches.length === 0) {
    return [];
  }

  const entries: ForwardingEntry[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const currentMatch = matches[index];
    const nextMatch = matches[index + 1];
    const sourceAgentId = currentMatch?.[1]?.trim() ?? "";
    const contentStart = (currentMatch?.index ?? 0) + (currentMatch?.[0]?.length ?? 0);
    const contentEnd = nextMatch?.index ?? trimmed.length;
    const sectionContent = trimmed.slice(contentStart, contentEnd).trim();
    if (!sourceAgentId || !sectionContent) {
      continue;
    }
    entries.push({
      sourceAgentId,
      content: sectionContent,
    });
  }
  return entries;
}

function matchesAlias(sourceAgentId: string, alias: string): boolean {
  const normalizedSource = sourceAgentId.trim();
  const normalizedAlias = alias.trim();
  if (!normalizedSource || !normalizedAlias) {
    return false;
  }
  return normalizedSource === normalizedAlias;
}

function matchesAgentIdOrAliases(
  sourceAgentId: string,
  agentId: string,
  aliases: string[],
): boolean {
  if (matchesAlias(sourceAgentId, agentId)) {
    return true;
  }
  return aliases.some((alias) => matchesAlias(sourceAgentId, alias));
}


function isForwardableInitialSourceMessage(message: MinimalMessage): boolean {
  if (isAgentFinalMessageRecord(message)) {
    return message.content.trim().length > 0;
  }
  if (isActionRequiredRequestMessageRecord(message)) {
    return message.content.trim().length > 0;
  }
  return false;
}

function matchesForwardingMessageAgentAlias(message: MinimalMessage, alias: string): boolean {
  const normalizedAlias = alias.trim();
  if (!normalizedAlias) {
    return false;
  }
  const candidateIds = new Set<string>([
    message.sender,
    getMessageSenderDisplayName(message) ?? "",
  ].map((value) => value.trim()).filter(Boolean));
  return candidateIds.has(normalizedAlias);
}

function normalizeForwardableMessageContent(message: MinimalMessage): string {
  if (message.sender === "user") {
    const rawUserContent = message.content.trim();
    if (!rawUserContent) {
      return "";
    }
    const targetAgentId = getMessageTargetAgentIds(message)[0]?.trim();
    const stripped = targetAgentId
      ? stripTargetMention(rawUserContent, targetAgentId)
      : rawUserContent;
    return stripTrailingStandaloneMentions(stripped);
  }
  if (isAgentFinalMessageRecord(message)) {
    return stripTrailingStandaloneMentions(
      extractAgentFinalDisplayContent(message),
    );
  }
  if (message.kind === "action-required-request") {
    return stripTrailingStandaloneMentions(
      getActionRequiredRequestDisplayBody(message),
    );
  }
  return stripTrailingStandaloneMentions(message.content.trim());
}

function stripTrailingStandaloneMentions(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  const lines = trimmed.split(/\r?\n/);
  while (lines.length > 0) {
    const lastLine = lines.at(-1)?.trim() ?? "";
    if (!/^(?:@\S+\s*)+$/u.test(lastLine)) {
      break;
    }
    lines.pop();
  }

  return lines.join("\n").trim();
}

function stripLeadingTargetMention(content: string, targetAgentId: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  const mentionToken = `@${targetAgentId}`;
  if (!trimmed.startsWith(mentionToken)) {
    return trimmed;
  }

  const nextChar = trimmed.charAt(mentionToken.length);
  if (nextChar && !/\s/u.test(nextChar)) {
    return trimmed;
  }

  const stripped = trimmed.slice(mentionToken.length).trimStart();
  return stripped || trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
