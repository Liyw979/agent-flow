import type { AgentStatus } from "@shared/types";

type ActionRequiredRequestContinuationInput = {
  continuation: {
    pendingTargets: string[];
    repairReviewerAgentId: string | null;
    redispatchTargets: string[];
  } | null;
  fallbackActionWhenNoBatch?: Extract<
    ActionRequiredRequestContinuationAction,
    "ignore" | "trigger_fallback_review"
  >;
};

type ActionRequiredRequestContinuationAction =
  | "ignore"
  | "wait_pending_reviewers"
  | "trigger_repair_review"
  | "redispatch_reviewers"
  | "trigger_fallback_review";

export function shouldStopTaskForUnhandledActionRequiredRequest(input: {
  completeTaskOnFinish: boolean;
  continuationAction: ActionRequiredRequestContinuationAction;
}): boolean {
  if (!input.completeTaskOnFinish) {
    return false;
  }

  return input.continuationAction === "ignore";
}

export function resolveAgentStatusFromReview(input: {
  reviewDecision: "approved" | "action_required" | "invalid";
  reviewAgent: boolean;
}): AgentStatus {
  if (input.reviewDecision === "invalid") {
    return "failed";
  }

  if (input.reviewDecision === "action_required") {
    return input.reviewAgent ? "action_required" : "failed";
  }

  return "completed";
}

export function resolveActionRequiredRequestContinuationAction(
  input: ActionRequiredRequestContinuationInput,
): ActionRequiredRequestContinuationAction {
  if (!input.continuation) {
    return input.fallbackActionWhenNoBatch ?? "ignore";
  }

  if (input.continuation.pendingTargets.length > 0) {
    return "wait_pending_reviewers";
  }

  if (input.continuation.repairReviewerAgentId) {
    return "trigger_repair_review";
  }

  if (input.continuation.redispatchTargets.length > 0) {
    return "redispatch_reviewers";
  }

  return "ignore";
}
