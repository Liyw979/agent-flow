import type { AgentRoutingKind, AgentStatus } from "@shared/types";

export function resolveAgentStatusFromRouting(input: {
  routingKind: AgentRoutingKind;
}): AgentStatus {
  if (input.routingKind === "invalid") {
    return "failed";
  }

  return "completed";
}
