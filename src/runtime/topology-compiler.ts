import type { TopologyEdgeTrigger, TopologyRecord } from "@shared/types";

interface TopologyIndex {
  handoffTargetsBySource: Record<string, string[]>;
  approvedTargetsBySource: Record<string, string[]>;
  actionRequiredTargetsBySource: Record<string, string[]>;
}

export function compileTopology(topology: TopologyRecord): TopologyIndex {
  return {
    handoffTargetsBySource: buildTargets(topology, "handoff"),
    approvedTargetsBySource: buildTargets(topology, "approved"),
    actionRequiredTargetsBySource: buildTargets(topology, "action_required"),
  };
}

function buildTargets(
  topology: TopologyRecord,
  triggerOn: TopologyEdgeTrigger,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const edge of topology.edges) {
    if (edge.triggerOn !== triggerOn) {
      continue;
    }
    const current = result[edge.source] ?? [];
    if (!current.includes(edge.target)) {
      current.push(edge.target);
    }
    result[edge.source] = current;
  }
  return result;
}
