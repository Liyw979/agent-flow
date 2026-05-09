import {
  DEFAULT_TOPOLOGY_TRIGGER,
  getTopologyNodeRecords,
  normalizeTopologyEdgeTrigger,
  type SpawnRule,
  type TopologyEdge,
  type TopologyRecord,
} from "@shared/types";

type DownstreamMode =
  | "spawn"
  | typeof DEFAULT_TOPOLOGY_TRIGGER
  | TopologyEdge["trigger"];

function buildReachableTargets(topology: TopologyRecord, startNodeId: string): string[] {
  const queue = [startNodeId];
  const visited = new Set<string>();
  const ordered: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    ordered.push(current);
    for (const edge of topology.edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  return ordered;
}

function buildSpawnRuleFromReachable(topology: TopologyRecord, sourceNodeId: string, targetNodeId: string): SpawnRule {
  const reachable = buildReachableTargets(topology, targetNodeId);
  const nodeRecords = getTopologyNodeRecords(topology);
  const targetTemplates = reachable.map((nodeId) => {
    const matched = nodeRecords.find((node) => node.id === nodeId);
    return {
      nodeId,
      templateName: matched?.templateName ?? nodeId,
    };
  });
  const reportTarget = targetTemplates.at(-1)?.templateName ?? targetNodeId;

  return {
    id: `spawn-rule:${targetNodeId}`,
    spawnNodeName: targetNodeId,
    sourceTemplateName: sourceNodeId,
    entryRole: "entry",
    spawnedAgents: targetTemplates.map((item, index) => ({
      role: index === 0 ? "entry" : item.nodeId,
      templateName: item.templateName,
    })),
    edges: targetTemplates.slice(0, -1).map((item, index) => ({
      sourceRole: index === 0 ? "entry" : item.nodeId,
      targetRole: targetTemplates[index + 1]?.nodeId ?? "entry",
      trigger: "<default>" as const,
      messageMode: "last" as const,
    })),
    exitWhen: "one_side_agrees",
    report: {
      templateName: reportTarget,
      trigger: DEFAULT_TOPOLOGY_TRIGGER,
      messageMode: "last",
      maxTriggerRounds: false,
    },
  };
}

function clearEdgesForPair(
  edges: TopologyEdge[],
  sourceNodeId: string,
  targetNodeId: string,
): TopologyEdge[] {
  return edges.filter(
    (edge) =>
      !(
        edge.source === sourceNodeId &&
        edge.target === targetNodeId
      ),
  );
}

function setSpawnNodeState(
  topology: TopologyRecord,
  targetNodeId: string,
  enabled: boolean,
): Pick<TopologyRecord, "nodeRecords" | "spawnRules"> {
  const nodeRecords = getTopologyNodeRecords(topology);
  const spawnRuleId = `spawn-rule:${targetNodeId}`;
  const nextNodeRecords = nodeRecords.map((node) =>
    node.id === targetNodeId
      ? (() => {
          const { spawnRuleId: _spawnRuleId, spawnEnabled: _spawnEnabled, ...rest } = node;
          return {
            ...rest,
            kind: enabled ? ("spawn" as const) : ("agent" as const),
            ...(enabled ? { spawnEnabled: true, spawnRuleId } : { spawnEnabled: false }),
          };
        })()
      : node,
  );
  const nextSpawnRules = (topology.spawnRules ?? []).filter((rule) => rule.id !== spawnRuleId);

  return {
    nodeRecords: nextNodeRecords,
    spawnRules: nextSpawnRules,
  };
}

export function getDownstreamMode(input: {
  topology: Pick<TopologyRecord, "nodes" | "edges" | "nodeRecords">;
  sourceNodeId: string;
  targetNodeId: string;
}): DownstreamMode | null {
  const targetNode = getTopologyNodeRecords(input.topology).find((node) => node.id === input.targetNodeId);
  if (targetNode?.spawnEnabled) {
    return "spawn";
  }

  const trigger = input.topology.edges.find(
    (edge) =>
      edge.source === input.sourceNodeId &&
      edge.target === input.targetNodeId,
  )?.trigger;

  const normalizedTrigger = trigger ? normalizeTopologyEdgeTrigger(trigger) : null;
  if (normalizedTrigger) {
    return normalizedTrigger;
  }
  return null;
}

export function setSpawnEnabledForDownstream(input: {
  topology: TopologyRecord;
  sourceNodeId: string;
  targetNodeId: string;
  enabled: boolean;
}): TopologyRecord {
  const nextEdges = input.enabled
    ? clearEdgesForPair(input.topology.edges, input.sourceNodeId, input.targetNodeId)
        .concat({
          source: input.sourceNodeId,
          target: input.targetNodeId,
          trigger: "<default>" as const,
          messageMode: "last" as const,
        })
        .map((edge) => ({ ...edge }))
    : input.topology.edges.map((edge) => ({ ...edge }));
  const spawnState = setSpawnNodeState(input.topology, input.targetNodeId, input.enabled);
  const nextSpawnRules = input.enabled
    ? (spawnState.spawnRules ?? []).concat(
        buildSpawnRuleFromReachable(input.topology, input.sourceNodeId, input.targetNodeId),
      )
    : spawnState.spawnRules ?? [];

  return {
    ...input.topology,
    nodeRecords: spawnState.nodeRecords,
    spawnRules: nextSpawnRules,
    edges: nextEdges,
  };
}

export function setDownstreamMode(input: {
  topology: TopologyRecord;
  sourceNodeId: string;
  targetNodeId: string;
  mode: DownstreamMode | null;
}): TopologyRecord {
  if (input.mode === "spawn") {
    return setSpawnEnabledForDownstream({
      topology: input.topology,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      enabled: true,
    });
  }

  const clearedEdges = clearEdgesForPair(
    input.topology.edges,
    input.sourceNodeId,
    input.targetNodeId,
  );
  const spawnState = setSpawnNodeState(input.topology, input.targetNodeId, false);
  const nextEdges =
    input.mode === null
      ? clearedEdges
      : clearedEdges.concat({
          source: input.sourceNodeId,
          target: input.targetNodeId,
          trigger: normalizeTopologyEdgeTrigger(input.mode),
          messageMode: "last" as const,
        });

  return {
    ...input.topology,
    nodeRecords: spawnState.nodeRecords,
    spawnRules: spawnState.spawnRules ?? [],
    edges: nextEdges,
  };
}
