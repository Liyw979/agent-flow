export const REVIEW_CHALLENGE_LABEL = "<challenge>";
export const REVIEW_CHALLENGE_END_LABEL = "</challenge>";
export const REVIEW_AGREE_LABEL = "<agree>";
export const REVIEW_AGREE_END_LABEL = "</agree>";

export type ReviewSignalKind = "challenge" | "agree";

const REVIEW_SIGNAL_TAG_PATTERN = /<\/?(?:challenge|agree)>/gu;

const REVIEW_SIGNAL_TOKENS: Record<ReviewSignalKind, { start: string; end: string }> = {
  challenge: {
    start: REVIEW_CHALLENGE_LABEL,
    end: REVIEW_CHALLENGE_END_LABEL,
  },
  agree: {
    start: REVIEW_AGREE_LABEL,
    end: REVIEW_AGREE_END_LABEL,
  },
};

export function formatReviewResponseBlock(
  content: string,
  kind: ReviewSignalKind = "challenge",
): string {
  const normalized = content.trim();
  const token = REVIEW_SIGNAL_TOKENS[kind];
  return `${token.start}${normalized}${token.end}`;
}

export function stripLeadingReviewResponseLabel(content: string): string {
  return content.replace(REVIEW_SIGNAL_TAG_PATTERN, "").trim();
}

export function extractLastReviewResponse(content: string): string {
  return extractTrailingReviewSignalBlock(content)?.response ?? "";
}

export function extractTrailingReviewSignalBlock(content: string): {
  body: string;
  response: string;
  rawBlock: string;
  kind: ReviewSignalKind;
} | null {
  const trimmed = content.trim();
  const pattern = /<(challenge|agree)>([\s\S]*?)<\/\1>/gu;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null = pattern.exec(trimmed);

  while (match) {
    lastMatch = match;
    match = pattern.exec(trimmed);
  }

  if (lastMatch && typeof lastMatch.index === "number") {
    const kind = lastMatch[1] === "agree" ? "agree" : "challenge";
    const rawBlock = lastMatch[0].trim();
    const response = (lastMatch[2] ?? "").trim();
    const markerIndex = lastMatch.index;

    return {
      body: trimmed.slice(0, markerIndex).trim(),
      response,
      rawBlock,
      kind,
    };
  }

  const trailingStart = findLastSignalStart(trimmed);
  if (!trailingStart) {
    return null;
  }

  const rawBlock = trimmed.slice(trailingStart.index).trim();
  const response = stripLeadingReviewResponseLabel(rawBlock);
  if (!response) {
    return null;
  }

  return {
    body: trimmed.slice(0, trailingStart.index).trim(),
    response,
    rawBlock,
    kind: trailingStart.kind,
  };
}

export function stripReviewResponseMarkup(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  const parsed = extractTrailingReviewSignalBlock(trimmed);
  if (!parsed) {
    return stripLeadingReviewResponseLabel(trimmed);
  }

  return [parsed.body, parsed.response].filter(Boolean).join("\n\n").trim();
}

function findLastSignalStart(content: string): { index: number; kind: ReviewSignalKind } | null {
  let last: { index: number; kind: ReviewSignalKind } | null = null;

  const tokens: Array<{ kind: ReviewSignalKind; start: string }> = [
    { kind: "challenge", start: REVIEW_CHALLENGE_LABEL },
    { kind: "agree", start: REVIEW_AGREE_LABEL },
  ];

  for (const token of tokens) {
    const index = content.lastIndexOf(token.start);
    if (index < 0) {
      continue;
    }
    if (!last || index > last.index) {
      last = { index, kind: token.kind };
    }
  }

  return last;
}
