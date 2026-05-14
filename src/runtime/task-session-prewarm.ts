import type { TaskAgentRecord, TopologyRecord } from "@shared/types";

export function resolveTaskAgentIdsToPrewarm(
  topology: Pick<TopologyRecord, "edges" | "flow" | "groupRules">,
  taskAgents: ReadonlyArray<Pick<TaskAgentRecord, "id">>,
): string[] {
  const parentReachableAgentIds = new Set<string>([
    ...topology.flow.start.targets,
    ...topology.edges.flatMap((edge) => [edge.source, edge.target]),
  ]);
  const spawnTemplateAgentIds = new Set(
    topology.groupRules?.flatMap((rule) => rule.members.map((agent) => agent.templateName)) ?? [],
  );

  return taskAgents
    .map((agent) => agent.id)
    .filter((agentId) => !spawnTemplateAgentIds.has(agentId) || parentReachableAgentIds.has(agentId));
}
