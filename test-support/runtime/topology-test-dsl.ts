import {
  buildTopologyNodeRecords,
  DEFAULT_TOPOLOGY_TRIGGER,
  LANGGRAPH_END_NODE_ID,
  LANGGRAPH_START_NODE_ID,
  normalizeActionRequiredMaxRounds,
  normalizeTopologyEdgeTrigger,
  type SpawnRule,
  type TopologyEdge,
  type TopologyEdgeTrigger,
  type TopologyNodeRecord,
  type TopologyLangGraphRecord,
  type TopologyRecord,
} from "@shared/types";

type TriggerConfig =
  | TopologyEdgeTrigger
  | {
      trigger: TopologyEdgeTrigger;
      maxTriggerRounds?: number;
    };
type DownstreamMode = TriggerConfig | "spawn";

type DownstreamMap = Record<string, Record<string, DownstreamMode>>;

interface SpawnTemplateInput {
  reportTo: string;
}

interface CreateTopologyInput {
  extraNodes?: string[];
  downstream: DownstreamMap;
  spawn?: Record<string, SpawnTemplateInput>;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function collectNodes(input: CreateTopologyInput): string[] {
  const nodes = [...(input.extraNodes ?? [])];
  const spawn = input.spawn ?? {};

  for (const [source, targets] of Object.entries(input.downstream)) {
    pushUnique(nodes, source);
    for (const target of Object.keys(targets)) {
      if (target === LANGGRAPH_END_NODE_ID) {
        continue;
      }
      pushUnique(nodes, target);
    }
  }

  for (const [target, config] of Object.entries(spawn)) {
    pushUnique(nodes, target);
    if (config.reportTo) {
      pushUnique(nodes, config.reportTo);
    }
  }

  return nodes;
}

function buildEdges(input: CreateTopologyInput): TopologyEdge[] {
  const edges: TopologyEdge[] = [];

  for (const [source, targets] of Object.entries(input.downstream)) {
    for (const [target, mode] of Object.entries(targets)) {
      if (target === LANGGRAPH_END_NODE_ID) {
        continue;
      }
      if (mode === "spawn") {
        edges.push({
          source,
          target,
          trigger: DEFAULT_TOPOLOGY_TRIGGER,
          messageMode: "last",
        });
        continue;
      }
      edges.push({
        source,
        target,
        trigger: normalizeTopologyEdgeTrigger(
          typeof mode === "string" ? mode : mode.trigger,
        ),
        messageMode: "last",
        ...(typeof mode === "object" && typeof mode.maxTriggerRounds === "number"
          ? { maxTriggerRounds: normalizeActionRequiredMaxRounds(mode.maxTriggerRounds) }
          : {}),
      });
    }
  }

  return edges;
}

function buildNodeRecords(
  nodes: string[],
  input: CreateTopologyInput,
): TopologyNodeRecord[] {
  const spawnTargets = new Set<string>();

  for (const targets of Object.values(input.downstream)) {
    for (const [target, mode] of Object.entries(targets)) {
      if (mode === "spawn") {
        spawnTargets.add(target);
      }
    }
  }
  const spawnRuleIdByNodeId = new Map<string, string>();
  for (const nodeId of spawnTargets) {
    spawnRuleIdByNodeId.set(nodeId, `spawn-rule:${nodeId}`);
  }

  return buildTopologyNodeRecords({
    nodes,
    spawnNodeIds: spawnTargets,
    templateNameByNodeId: new Map(),
    initialMessageRoutingByNodeId: new Map(),
    spawnRuleIdByNodeId,
    spawnEnabledNodeIds: spawnTargets,
    promptByNodeId: new Map(),
    writableNodeIds: new Set(),
  });
}

function findSpawnSource(
  downstream: DownstreamMap,
  targetNodeId: string,
): string {
  const matches: string[] = [];

  for (const [source, targets] of Object.entries(downstream)) {
    if (targets[targetNodeId] === "spawn") {
      matches.push(source);
    }
  }

  if (matches.length !== 1) {
    throw new Error(`测试 DSL 要求 spawn 节点 ${targetNodeId} 只能有且仅有一个上游来源。`);
  }

  return matches[0]!;
}

function buildSpawnRules(input: CreateTopologyInput): SpawnRule[] {
  const spawnTargets: string[] = [];

  for (const targets of Object.values(input.downstream)) {
    for (const [target, mode] of Object.entries(targets)) {
      if (mode === "spawn") {
        spawnTargets.push(target);
      }
    }
  }

  return spawnTargets.map((target) => {
    const config = input.spawn?.[target];
    const sourceTemplateName = findSpawnSource(input.downstream, target);
    if (!config) {
      throw new Error(`测试 DSL 要求 spawn 节点 ${target} 必须显式声明 reportTo。`);
    }

    return {
      id: `spawn-rule:${target}`,
      spawnNodeName: target,
      sourceTemplateName,
      entryRole: "entry",
      spawnedAgents: [{
        role: "entry",
        templateName: target,
      }],
      edges: [],
      exitWhen: "one_side_agrees",
      report: {
        templateName: config.reportTo,
        trigger: DEFAULT_TOPOLOGY_TRIGGER,
        messageMode: "last",
        maxTriggerRounds: false,
      },
    };
  });
}

function buildLangGraphFromDownstream(input: CreateTopologyInput): TopologyLangGraphRecord | undefined {
  const incoming = Object.entries(input.downstream).flatMap(([source, targets]) => {
    const mode = targets[LANGGRAPH_END_NODE_ID];
    if (!mode || mode === "spawn") {
      return [];
    }
    return [{
      source,
      trigger: normalizeTopologyEdgeTrigger(
        typeof mode === "string" ? mode : mode.trigger,
      ),
    }];
  });
  if (incoming.length === 0) {
    return undefined;
  }
  return {
    start: {
      id: LANGGRAPH_START_NODE_ID,
      targets: [],
    },
    end: {
      id: LANGGRAPH_END_NODE_ID,
      sources: incoming.map((item) => item.source),
      incoming,
    },
  };
}

export function createTopology(
  input: CreateTopologyInput,
): TopologyRecord {
  const nodes = collectNodes(input);
  const langgraph = buildLangGraphFromDownstream(input);
  const edges = buildEdges(input);
  const nodeRecords = buildNodeRecords(nodes, input);
  const spawnRules = buildSpawnRules(input);

  const topology: TopologyRecord = {
    nodes,
    edges,
    nodeRecords,
    ...(langgraph ? { langgraph } : {}),
    ...(spawnRules.length > 0 ? { spawnRules } : {}),
  };
  return topology;
}
