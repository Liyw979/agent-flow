import type { AgentRecord, TaskAgentRecord } from "@shared/types";

export function orderAgentsForFrontend<T extends { id: string }>(
  agents: T[],
  orderedAgentIds: readonly string[],
): T[] {
  if (orderedAgentIds.length === 0) {
    return [...agents];
  }

  const agentByName = new Map(agents.map((agent) => [agent.id, agent]));
  const consumed = new Set<string>();
  const ordered: T[] = [];

  for (const name of orderedAgentIds) {
    const matched = agentByName.get(name);
    if (!matched || consumed.has(name)) {
      continue;
    }
    ordered.push(matched);
    consumed.add(name);
  }

  for (const agent of agents) {
    if (consumed.has(agent.id)) {
      continue;
    }
    ordered.push(agent);
    consumed.add(agent.id);
  }

  return ordered;
}

export function buildAvailableAgentIdsForFrontend(
  agents: AgentRecord[],
  orderedAgentIds: readonly string[],
): string[] {
  return orderAgentsForFrontend(agents, orderedAgentIds).map((agent) => agent.id);
}

export function resolveDefaultSelectedAgentIdForFrontend(input: {
  selectedAgentId: string;
  workspaceAgents: AgentRecord[];
  taskAgents: TaskAgentRecord[];
  orderedAgentIds: readonly string[];
}): string {
  const preserved = input.taskAgents.find((agent) => agent.id === input.selectedAgentId);
  if (preserved) {
    return preserved.id;
  }
  const orderedAgents = orderAgentsForFrontend(input.workspaceAgents, input.orderedAgentIds);
  const firstAgent = orderedAgents[0];
  return firstAgent ? firstAgent.id : "";
}
