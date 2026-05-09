import {
  buildTopologyNodeRecords,
  DEFAULT_TOPOLOGY_TRIGGER,
  LANGGRAPH_END_NODE_ID,
  LANGGRAPH_START_NODE_ID,
  normalizeActionRequiredMaxRounds,
  normalizeTopologyEdgeTrigger,
  type SpawnRule,
  type SpawnedAgentTemplate,
  type TopologyEdge,
  type TopologyEdgeTrigger,
  type TopologyNodeRecord,
  type TopologyLangGraphRecord,
  type TopologyRecord,
  type TopologyEdgeMessageMode,
} from "@shared/types";

type TriggerConfig =
  | TopologyEdgeTrigger
  | {
      trigger: TopologyEdgeTrigger;
      maxTriggerRounds?: number;
    };
type DownstreamMode = TriggerConfig | "spawn";

type DownstreamMap = Record<string, Record<string, DownstreamMode>>;

type SpawnAgentInput =
  | string
  | {
      role: string;
      templateName: string;
    };

type SpawnLinkInput =
  | readonly [string, string, TriggerConfig]
  | {
      sourceRole: string;
      targetRole: string;
      trigger: TriggerConfig;
      messageMode: TopologyEdgeMessageMode;
    };

interface SpawnTemplateInput {
  name?: string;
  entryRole?: string;
  agents?: SpawnAgentInput[];
  links?: SpawnLinkInput[];
  reportTo?: string;
}

interface CreateTopologyDslInput {
  nodes?: string[];
  downstream: DownstreamMap;
  spawn?: Record<string, SpawnTemplateInput>;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function collectNodes(input: CreateTopologyDslInput): string[] {
  const nodes = [...(input.nodes ?? [])];
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
    for (const agent of config.agents ?? []) {
      pushUnique(nodes, typeof agent === "string" ? agent : agent.templateName);
    }
  }

  return nodes;
}

function buildEdges(input: CreateTopologyDslInput): TopologyEdge[] {
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
      const resolvedLink = resolveTestTopologyLinkConfig(mode);
      edges.push({
        source,
        target,
        trigger: resolvedLink.trigger,
        messageMode: "last",
        ...(typeof resolvedLink.maxTriggerRounds === "number"
          ? { maxTriggerRounds: resolvedLink.maxTriggerRounds }
          : {}),
      });
    }
  }

  return edges;
}

function buildNodeRecords(
  nodes: string[],
  input: CreateTopologyDslInput,
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

function normalizeSpawnedAgents(
  targetNodeId: string,
  config: SpawnTemplateInput | undefined,
): SpawnedAgentTemplate[] {
  const entryRole = config?.entryRole ?? "entry";
  const rawAgents = config?.agents ?? [targetNodeId];

  return rawAgents.map((agent, index) => {
    if (typeof agent !== "string") {
      return {
        role: agent.role,
        templateName: agent.templateName,
      };
    }

    return {
      role: index === 0 ? entryRole : agent,
      templateName: agent,
    };
  });
}

function normalizeSpawnLinks(config: SpawnTemplateInput | undefined): SpawnRule["edges"] {
  return (config?.links ?? []).map((link) => {
    if (Array.isArray(link)) {
      const [sourceRole, targetRole, trigger] = link;
      const resolvedLink = resolveTestTopologyLinkConfig(trigger);
      return {
        sourceRole,
        targetRole,
        trigger: resolvedLink.trigger,
        messageMode: "last",
        ...(typeof resolvedLink.maxTriggerRounds === "number"
          ? { maxTriggerRounds: resolvedLink.maxTriggerRounds }
          : {}),
      };
    }

    const objectLink = link as Exclude<SpawnLinkInput, readonly [string, string, TriggerConfig]>;

    const resolvedLink = resolveTestTopologyLinkConfig(objectLink.trigger);
    return {
      sourceRole: objectLink.sourceRole,
      targetRole: objectLink.targetRole,
      trigger: resolvedLink.trigger,
      messageMode: objectLink.messageMode,
      ...(typeof resolvedLink.maxTriggerRounds === "number"
        ? { maxTriggerRounds: resolvedLink.maxTriggerRounds }
        : {}),
    };
  });
}

function resolveTestTopologyLinkConfig(input: TriggerConfig): {
  trigger: TopologyEdgeTrigger;
  maxTriggerRounds?: number;
} {
  if (typeof input === "string") {
    return {
      trigger: normalizeTopologyEdgeTrigger(input),
    };
  }

  return {
    trigger: normalizeTopologyEdgeTrigger(input.trigger),
    ...(typeof input.maxTriggerRounds === "number"
      ? { maxTriggerRounds: normalizeActionRequiredMaxRounds(input.maxTriggerRounds) }
      : {}),
  };
}

function buildSpawnRules(input: CreateTopologyDslInput): SpawnRule[] {
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

    return {
      id: `spawn-rule:${target}`,
      spawnNodeName: target,
      sourceTemplateName,
      entryRole: config?.entryRole ?? "entry",
      spawnedAgents: normalizeSpawnedAgents(target, config),
      edges: normalizeSpawnLinks(config),
      exitWhen: "one_side_agrees",
      report: {
        templateName: config?.reportTo ?? sourceTemplateName,
        trigger: DEFAULT_TOPOLOGY_TRIGGER,
        messageMode: "last",
        maxTriggerRounds: false,
      },
    };
  });
}

function buildLangGraphFromDownstream(input: CreateTopologyDslInput): TopologyLangGraphRecord | undefined {
  const incoming = Object.entries(input.downstream).flatMap(([source, targets]) => {
    const mode = targets[LANGGRAPH_END_NODE_ID];
    if (!mode || mode === "spawn") {
      return [];
    }
    return [{
      source,
      trigger: resolveTestTopologyLinkConfig(mode).trigger,
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
  input: CreateTopologyDslInput,
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
