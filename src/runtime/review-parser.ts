import { extractTrailingReviewSignalBlock } from "@shared/review-response";
import type { ReviewDecision } from "@shared/types";

export interface ParsedReview {
  cleanContent: string;
  decision: ReviewDecision;
  opinion: string | null;
}

export function stripStructuredSignals(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*(NEXT_AGENTS:|TASK_DONE\b|SESSION_REF:)/i.test(line))
    .join("\n")
    .trim();
}

export function parseReview(content: string, reviewAgent: boolean): ParsedReview {
  const signalMatch = extractTrailingReviewSignalBlock(content);
  if (signalMatch) {
    return {
      cleanContent: stripStructuredSignals(signalMatch.body),
      decision: signalMatch.kind === "complete" ? "complete" : "continue",
      opinion: signalMatch.response,
    };
  }

  const cleanContent = stripStructuredSignals(content);
  if (!reviewAgent) {
    return {
      cleanContent,
      decision: "complete",
      opinion: null,
    };
  }

  return {
    cleanContent,
    decision: "continue",
    opinion: cleanContent || null,
  };
}
