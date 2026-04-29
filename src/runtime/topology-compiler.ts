import {
  collectTopologyTriggerShapes,
  DEFAULT_TOPOLOGY_TRIGGER,
  type TopologyRecord,
} from "@shared/types";

interface TopologyIndex {
  handoffTargetsBySource: Record<string, string[]>;
  actionRequiredTargetsBySource: Record<string, string[]>;
}

export function compileTopology(topology: TopologyRecord): TopologyIndex {
  const triggerRouteKindMap = new Map(
    collectTopologyTriggerShapes({
      edges: topology.edges,
      endIncoming: topology.langgraph?.end?.incoming ?? [],
    }).map((item) => [`${item.source}__${item.trigger}`, item.routeKind] as const),
  );
  return {
    handoffTargetsBySource: buildTargets(topology, DEFAULT_TOPOLOGY_TRIGGER),
    actionRequiredTargetsBySource: buildTargets(topology, (_trigger, edge) =>
      triggerRouteKindMap.get(`${edge.source}__${edge.trigger}`) === "action_required"),
  };
}

function buildTargets(
  topology: TopologyRecord,
  matcher: string | ((trigger: string, edge: TopologyRecord["edges"][number]) => boolean),
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const edge of topology.edges) {
    const matched = typeof matcher === "string"
      ? edge.trigger === matcher
      : matcher(edge.trigger, edge);
    if (!matched) {
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
