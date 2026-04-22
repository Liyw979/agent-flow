import { extractTrailingReviewSignalBlock } from "@shared/review-response";

export type ReviewDecision = "approved" | "action_required" | "invalid";

export interface ParsedReview {
  cleanContent: string;
  decision: ReviewDecision;
  opinion: string | null;
  rawDecisionBlock: string | null;
  validationError: string | null;
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
      decision: signalMatch.kind === "approved" ? "approved" : "action_required",
      opinion: signalMatch.response,
      rawDecisionBlock: signalMatch.rawBlock,
      validationError: null,
    };
  }

  const cleanContent = stripStructuredSignals(content);
  if (!reviewAgent) {
    return {
      cleanContent,
      decision: "approved",
      opinion: null,
      rawDecisionBlock: null,
      validationError: null,
    };
  }

  return {
    cleanContent,
    decision: "invalid",
    opinion: null,
    rawDecisionBlock: null,
    validationError: "审查 Agent 必须用 <approved> 或 <continue> 标签明确给出结论。",
  };
}
