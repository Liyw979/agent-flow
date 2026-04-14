import type { MessageRecord } from "@shared/types";

export interface ChatMessageItem {
  id: string;
  sender: string;
  timestamp: string;
  content: string;
  kinds: string[];
}

function shouldMergeMessages(
  previousSender: string | undefined,
  previousKind: string | undefined,
  current: MessageRecord,
) {
  return (
    previousSender === current.sender &&
    previousSender !== "user" &&
    previousSender !== "system" &&
    previousKind === "high-level-trigger" &&
    current.meta?.kind === "high-level-trigger"
  );
}

export function mergeTaskChatMessages(messages: MessageRecord[]): ChatMessageItem[] {
  const merged: ChatMessageItem[] = [];

  for (const message of messages) {
    const last = merged.at(-1);
    const previousKind = last?.kinds.at(-1);

    if (last && shouldMergeMessages(last.sender, previousKind, message)) {
      last.id = `${last.id}:${message.id}`;
      last.timestamp = message.timestamp;
      last.content = [last.content, message.content].filter(Boolean).join("\n\n");
      last.kinds.push(message.meta?.kind ?? "");
      continue;
    }

    merged.push({
      id: message.id,
      sender: message.sender,
      timestamp: message.timestamp,
      content: message.content,
      kinds: message.meta?.kind ? [message.meta.kind] : [],
    });
  }

  return merged;
}
