import { normalizeTopologyEdgeTrigger } from "./types";

const EMPTY_ALLOWED_TRIGGERS: readonly string[] = [];

function buildDecisionEndLabel(label: string): string {
  return `</${label.slice(1, -1)}>`;
}

interface DecisionSignalToken {
  start: string;
  end: string;
}

function normalizeDecisionSignalTokens(
  allowedTriggers: readonly string[] = EMPTY_ALLOWED_TRIGGERS,
): DecisionSignalToken[] {
  const labels = allowedTriggers.length > 0 ? allowedTriggers : [];
  const normalized = [...new Set(labels.map((label) => normalizeTopologyEdgeTrigger(label)))];
  return normalized.map((label) => ({
    start: label,
    end: buildDecisionEndLabel(label),
  }));
}

function stripKnownDecisionSignalTokens(
  content: string,
  allowedTriggers: readonly string[] = EMPTY_ALLOWED_TRIGGERS,
): string {
  return normalizeDecisionSignalTokens(allowedTriggers).reduce(
    (current, token) => current.split(token.start).join("").split(token.end).join(""),
    content,
  );
}

export function stripLeadingDecisionResponseLabel(
  content: string,
  allowedTriggers: readonly string[] = EMPTY_ALLOWED_TRIGGERS,
): string {
  return stripKnownDecisionSignalTokens(content, allowedTriggers).trim();
}

export function extractLastDecisionResponse(
  content: string,
  allowedTriggers: readonly string[] = EMPTY_ALLOWED_TRIGGERS,
): string {
  return extractTrailingDecisionSignalBlock(content, allowedTriggers)?.response ?? "";
}

export function extractTrailingDecisionSignalBlock(
  content: string,
  allowedTriggers: readonly string[] = EMPTY_ALLOWED_TRIGGERS,
): {
  body: string;
  response: string;
  rawBlock: string;
  trigger: string;
} | null {
  const trimmed = content.trim();
  const tokens = normalizeDecisionSignalTokens(allowedTriggers);
  let lastMatch: {
    trigger: string;
    rawBlock: string;
    body: string;
    response: string;
    index: number;
  } | null = null;

  for (const token of tokens) {
    const pattern = new RegExp(`${escapeForRegex(token.start)}([\\s\\S]*?)${escapeForRegex(token.end)}`, "gu");
    let match: RegExpExecArray | null = pattern.exec(trimmed);
    while (match) {
      if (!lastMatch || match.index > lastMatch.index) {
        lastMatch = {
          trigger: token.start,
          rawBlock: match[0].trim(),
          body: trimmed.slice(0, match.index).trim(),
          response: (match[1] ?? "").trim(),
          index: match.index,
        };
      }
      match = pattern.exec(trimmed);
    }
  }

  if (lastMatch) {
    return {
      body: lastMatch.body,
      response: lastMatch.response,
      rawBlock: lastMatch.rawBlock,
      trigger: lastMatch.trigger,
    };
  }
  return null;
}

export function stripDecisionResponseMarkup(
  content: string,
  allowedTriggers: readonly string[] = EMPTY_ALLOWED_TRIGGERS,
): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  const parsed = extractTrailingDecisionSignalBlock(trimmed, allowedTriggers);
  if (!parsed) {
    return trimmed;
  }

  const normalizedBody = parsed.body.replace(/\s+/g, " ").trim();
  const normalizedResponse = parsed.response.replace(/\s+/g, " ").trim();
  if (normalizedBody && normalizedBody === normalizedResponse) {
    return parsed.body.trim();
  }

  return [parsed.body, parsed.response].filter(Boolean).join("\n\n").trim();
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
