import type { AgentRoutingKind, AgentStatus } from "@shared/types";
import type { GatingBatchContinuation, GatingRepairBatchContinuation } from "./gating-scheduler";

type ActionRequiredRequestContinuationInput = {
  continuation: GatingBatchContinuation | GatingRepairBatchContinuation | null;
};

type ActionRequiredRequestContinuationAction =
  | "ignore"
  | "wait_pending_decision_agents"
  | "trigger_repair_decision"
  | "redispatch_decision_agents";

export function shouldStopTaskForUnhandledActionRequiredRequest(input: {
  completeTaskOnFinish: boolean;
  continuationAction: ActionRequiredRequestContinuationAction;
}): boolean {
  if (!input.completeTaskOnFinish) {
    return false;
  }

  return input.continuationAction === "ignore";
}

export function resolveAgentStatusFromRouting(input: {
  routingKind: AgentRoutingKind;
  decisionAgent: boolean;
  enteredActionRequired: boolean;
}): AgentStatus {
  if (input.routingKind === "invalid") {
    return "failed";
  }

  if (input.enteredActionRequired) {
    return input.decisionAgent ? "action_required" : "failed";
  }

  return "completed";
}

export function resolveActionRequiredRequestContinuationAction(
  input: ActionRequiredRequestContinuationInput,
): ActionRequiredRequestContinuationAction {
  if (!input.continuation) {
    return "ignore";
  }

  switch (input.continuation.kind) {
    case "pending_targets":
      return "wait_pending_decision_agents";
    case "repair":
      return "trigger_repair_decision";
    case "redispatch":
      return "redispatch_decision_agents";
    case "settled":
      return "ignore";
  }
}
