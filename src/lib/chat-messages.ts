import type { MessageRecord, UtcIsoTimestamp } from "@shared/types";
import { withOptionalString } from "@shared/object-utils";
import {
  getMessageSenderDisplayName,
  isAgentDispatchMessageRecord,
  isAgentFinalMessageRecord,
} from "@shared/types";
import {
  buildMentionSuffix,
  parseTargetAgentIds,
} from "@shared/chat-message-format";
import {
  stripDecisionResponseMarkup,
} from "@shared/decision-response";

export interface ChatMessageItem {
  id: string;
  sender: string;
  senderDisplayName?: string;
  timestamp: UtcIsoTimestamp;
  content: string;
  kinds: string[];
  messageChain: MessageRecord[];
}

function isNonSystemAgent(sender: string | undefined) {
  return sender !== undefined && sender !== "user" && sender !== "system";
}

function stripTrailingMentions(content: string): string {
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

function extractTrailingMentionAgentIds(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  const lines = trimmed.split(/\r?\n/);
  const mentions: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      if (mentions.length > 0) {
        continue;
      }
      continue;
    }
    if (!/^(?:@\S+\s*)+$/u.test(line)) {
      break;
    }
    mentions.unshift(
      ...line
        .split(/\s+/u)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.replace(/^@/u, "")),
    );
  }

  return parseTargetAgentIds(mentions);
}

const TRAILING_FOLLOW_UP_OFFER_PATTERN =
  /\n\n(?<tail>(?:如果你(?:愿意|希望|需要)|若你(?:愿意|希望|需要)|如需)[\s\S]*)$/u;

export function stripTrailingFollowUpOffer(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  const match = TRAILING_FOLLOW_UP_OFFER_PATTERN.exec(trimmed);
  if (!match || typeof match.index !== "number") {
    return trimmed;
  }

  const tail = typeof match.groups?.["tail"] === "string"
    ? match.groups["tail"].trim()
    : "";
  if (!tail) {
    return trimmed;
  }
  if (!/(?:我(?:也)?可以|可继续|下一步可以)/u.test(tail)) {
    return trimmed;
  }

  return trimmed.slice(0, match.index).trimEnd();
}

function getMessageAllowedDecisionTriggers(message: MessageRecord): string[] {
  if (message.kind === "agent-final" && message.routingKind === "triggered") {
    return [message.trigger];
  }
  return [];
}

function hasMeaningfulText(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

const FINAL_DELIVERY_HEADING_PATTERN =
  /^(正式结果|正式回复|最终结果|最终回复|最终交付|交付结果|交付内容|结论|答案|输出)$/u;

function extractTrailingTopLevelSection(content: string): string {
  const headingPattern = /(^|\n)(#{1,2}\s+[^\n]+)\n/g;
  let lastHeadingIndex = -1;
  let match: RegExpExecArray | null = headingPattern.exec(content);
  while (match) {
    const headingLine = match[2]?.trim() ?? "";
    const headingTitle = headingLine.replace(/^#{1,2}\s+/u, "").trim();
    if (FINAL_DELIVERY_HEADING_PATTERN.test(headingTitle)) {
      lastHeadingIndex = match.index + (match[1]?.length ?? 0);
    }
    match = headingPattern.exec(content);
  }

  if (lastHeadingIndex < 0) {
    return content;
  }

  const trailingSection = content.slice(lastHeadingIndex).trim();
  return trailingSection || content;
}

export function extractAgentFinalDisplayContent(message: MessageRecord): string {
  const rawContent = message.content.trim();
  if (!rawContent) {
    return "";
  }

  if (isAgentFinalMessageRecord(message)) {
    const normalized = rawContent
      .replace(/\n(?:---|\*\*\*)(?:\s*\n?)*$/u, "")
      .trim();
    return hasMeaningfulText(normalized) ? normalized : message.content.trim();
  }

  const normalizedRawContent = stripDecisionResponseMarkup(
    rawContent,
    getMessageAllowedDecisionTriggers(message),
  );
  const trailingSection = extractTrailingTopLevelSection(normalizedRawContent);
  const normalized = trailingSection
    .replace(/\n(?:---|\*\*\*)(?:\s*\n?)*$/u, "")
    .trim();
  return hasMeaningfulText(normalized) ? normalized : message.content.trim();
}

function buildMergedAgentFinalTriggerContent(previous: ChatMessageItem, current: MessageRecord): string {
  const base = stripTrailingFollowUpOffer(previous.content.trim());
  const targets = extractTrailingMentionAgentIds(current.content);
  const resolvedTargets = targets.length > 0
    ? targets
    : (isAgentDispatchMessageRecord(current) ? parseTargetAgentIds(current.targetAgentIds) : []);

  if (resolvedTargets.length === 0) {
    return [base, current.content.trim()].filter(Boolean).join("\n\n");
  }

  const mergedTargets = [...new Set([
    ...extractTrailingMentionAgentIds(previous.content),
    ...resolvedTargets,
  ])];
  return [stripTrailingMentions(base), buildMentionSuffix(mergedTargets)].filter(Boolean).join("\n\n");
}

function buildMergedAgentDispatchContent(previous: ChatMessageItem, current: MessageRecord): string {
  const previousBody = stripTrailingMentions(stripTrailingFollowUpOffer(previous.content.trim()));
  const previousTargets = extractTrailingMentionAgentIds(previous.content);
  const currentDisplayContent = getDisplayContent(current);
  const currentBody = stripTrailingMentions(currentDisplayContent);
  const currentTargets = extractTrailingMentionAgentIds(currentDisplayContent);
  const mergedTargets = [...new Set([...previousTargets, ...currentTargets])];
  const bodyParts: string[] = [];
  const normalizedPreviousBody = previousBody.replace(/\s+/g, " ").trim();
  const normalizedCurrentBody = currentBody.replace(/\s+/g, " ").trim();

  if (previousBody) {
    bodyParts.push(previousBody);
  }
  if (currentBody && normalizedCurrentBody !== normalizedPreviousBody) {
    bodyParts.push(currentBody);
  }

  return [bodyParts.join("\n\n").trim(), buildMentionSuffix(mergedTargets)].filter(Boolean).join("\n\n");
}

function shouldMergeAgentDispatch(previous: ChatMessageItem, current: MessageRecord) {
  return (
    previous.kinds.at(-1) === "agent-dispatch" &&
    current.kind === "agent-dispatch"
  );
}

function shouldMergeAgentFinalWithDispatch(previous: ChatMessageItem, current: MessageRecord) {
  return (
    previous.kinds.at(-1) === "agent-final" &&
    current.kind === "agent-dispatch"
  );
}

function shouldMergeMessages(previous: ChatMessageItem | undefined, current: MessageRecord) {
  if (!previous || previous.sender !== current.sender || !isNonSystemAgent(previous.sender)) {
    return false;
  }

  return (
    shouldMergeAgentDispatch(previous, current) ||
    shouldMergeAgentFinalWithDispatch(previous, current)
  );
}

function getDisplayContent(message: MessageRecord): string {
  if (message.kind === "agent-final") {
    return extractAgentFinalDisplayContent(message);
  }
  if (message.kind === "agent-dispatch") {
    return message.content.trim();
  }
  return message.content;
}

export function mergeTaskChatMessages(messages: MessageRecord[]): ChatMessageItem[] {
  const merged: ChatMessageItem[] = [];

  for (const message of messages) {
    const last = merged.at(-1);
    const senderDisplayName = getMessageSenderDisplayName(message)?.trim();

    if (last && shouldMergeMessages(last, message)) {
      last.id = `${last.id}:${message.id}`;
      last.timestamp = message.timestamp;
      last.content =
        message.kind === "agent-dispatch" && last.kinds.at(-1) === "agent-final"
          ? buildMergedAgentFinalTriggerContent(last, message)
          : message.kind === "agent-dispatch" && last.kinds.at(-1) === "agent-dispatch"
            ? buildMergedAgentDispatchContent(last, message)
            : [last.content, getDisplayContent(message)].filter(Boolean).join("\n\n");
      last.kinds.push(message.kind);
      last.messageChain.push(message);
      continue;
    }

    merged.push(withOptionalString({
      id: message.id,
      sender: senderDisplayName
        ? senderDisplayName
        : message.sender,
      timestamp: message.timestamp,
      content: getDisplayContent(message),
      kinds: [message.kind],
      messageChain: [message],
    }, "senderDisplayName", senderDisplayName));
  }

  return merged;
}
