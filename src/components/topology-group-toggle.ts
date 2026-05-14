import {
  DEFAULT_TOPOLOGY_TRIGGER,
  createTopologyFlowRecord,
  getTopologyNodeRecords,
  normalizeTopologyEdgeTrigger,
  type GroupRule,
  type TopologyEdge,
  type TopologyRecord,
} from "@shared/types";

const REQUIRED_MAX_TRIGGER_ROUNDS = 4;

type DownstreamMode =
  | "group"
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

function buildGroupRuleFromReachable(topology: TopologyRecord, sourceNodeId: string, targetNodeId: string): GroupRule {
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
    id: `group-rule:${targetNodeId}`,
    groupNodeName: targetNodeId,
    sourceTemplateName: sourceNodeId,
    entryRole: "entry",
    members: targetTemplates.map((item, index) => ({
      role: index === 0 ? "entry" : item.nodeId,
      templateName: item.templateName,
    })),
    edges: targetTemplates.slice(0, -1).map((item, index) => ({
      sourceRole: index === 0 ? "entry" : item.nodeId,
      targetRole: targetTemplates[index + 1]?.nodeId ?? "entry",
      trigger: "<default>" as const,
      messageMode: "last" as const,
      maxTriggerRounds: REQUIRED_MAX_TRIGGER_ROUNDS,
    })),
    exitWhen: "one_side_agrees",
    report: {
      sourceRole: "summary",
      templateName: reportTarget,
      trigger: DEFAULT_TOPOLOGY_TRIGGER,
      messageMode: "last",
      maxTriggerRounds: REQUIRED_MAX_TRIGGER_ROUNDS,
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

function setGroupNodeState(
  topology: TopologyRecord,
  targetNodeId: string,
  enabled: boolean,
): Pick<TopologyRecord, "nodeRecords" | "groupRules"> {
  const nodeRecords = getTopologyNodeRecords(topology);
  const groupRuleId = `group-rule:${targetNodeId}`;
  const nextNodeRecords = nodeRecords.map((node) =>
    node.id === targetNodeId
      ? (() => {
          const { groupRuleId: _groupRuleId, groupEnabled: _groupEnabled, ...rest } = node;
          return {
            ...rest,
            kind: enabled ? ("group" as const) : ("agent" as const),
            ...(enabled ? { groupEnabled: true, groupRuleId } : { groupEnabled: false }),
          };
        })()
      : node,
  );
  const nextGroupRules = (topology.groupRules ?? []).filter((rule) => rule.id !== groupRuleId);

  return {
    nodeRecords: nextNodeRecords,
    groupRules: nextGroupRules,
  };
}

export function getDownstreamMode(input: {
  topology: Pick<TopologyRecord, "nodes" | "edges" | "nodeRecords">;
  sourceNodeId: string;
  targetNodeId: string;
}): DownstreamMode | null {
  const topology: TopologyRecord = {
    ...input.topology,
    flow: createTopologyFlowRecord({
      nodes: input.topology.nodes,
      edges: input.topology.edges,
    }),
  };
  const targetNode = getTopologyNodeRecords(topology).find((node) => node.id === input.targetNodeId);
  if (targetNode?.groupEnabled) {
    return "group";
  }

  const trigger = topology.edges.find(
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

export function setGroupEnabledForDownstream(input: {
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
          maxTriggerRounds: REQUIRED_MAX_TRIGGER_ROUNDS,
        })
        .map((edge) => ({ ...edge }))
    : input.topology.edges.map((edge) => ({ ...edge }));
  const groupState = setGroupNodeState(input.topology, input.targetNodeId, input.enabled);
  const nextGroupRules = input.enabled
    ? (groupState.groupRules ?? []).concat(
        buildGroupRuleFromReachable(input.topology, input.sourceNodeId, input.targetNodeId),
      )
    : groupState.groupRules ?? [];

  return {
    ...input.topology,
    nodeRecords: groupState.nodeRecords,
    groupRules: nextGroupRules,
    edges: nextEdges,
  };
}

export function setDownstreamMode(input: {
  topology: TopologyRecord;
  sourceNodeId: string;
  targetNodeId: string;
  mode: DownstreamMode | null;
}): TopologyRecord {
  if (input.mode === "group") {
    return setGroupEnabledForDownstream({
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
  const groupState = setGroupNodeState(input.topology, input.targetNodeId, false);
  const nextEdges =
    input.mode === null
      ? clearedEdges
      : clearedEdges.concat({
          source: input.sourceNodeId,
          target: input.targetNodeId,
          trigger: normalizeTopologyEdgeTrigger(input.mode),
          messageMode: "last" as const,
          maxTriggerRounds: REQUIRED_MAX_TRIGGER_ROUNDS,
        });

  return {
    ...input.topology,
    nodeRecords: groupState.nodeRecords,
    groupRules: groupState.groupRules ?? [],
    edges: nextEdges,
  };
}
