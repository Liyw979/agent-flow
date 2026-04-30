import {
  DEFAULT_TOPOLOGY_TRIGGER,
  getTopologyNodeRecords,
  type SpawnRule,
  type TopologyNodeRecord,
  type TopologyRecord,
} from "@shared/types";

const DEBATE_TURN_TRIGGER = "<respond>";
const DEBATE_SUMMARY_TRIGGER = "<finalize>";

interface DebateSpawnDraftInput {
  teamName: string;
  sourceTemplateName: string;
  proTemplateName: string;
  conTemplateName: string;
  summaryTemplateName: string;
  reportToTemplateName: string;
}

function sanitizeRuleId(value: string): string {
  const normalized = value.trim().replace(/\s+/g, "-");
  return normalized.length > 0 ? normalized : "dynamic-team";
}

function buildSpawnRuleId(teamName: string): string {
  return `spawn-rule:${sanitizeRuleId(teamName)}`;
}

function ensureNodeRecord(records: TopologyNodeRecord[], node: TopologyNodeRecord): TopologyNodeRecord[] {
  const existingIndex = records.findIndex((item) => item.id === node.id);
  if (existingIndex < 0) {
    return [...records, node];
  }
  const next = [...records];
  next[existingIndex] = node;
  return next;
}

export function getTopologyDisplayNodeIds(
  topology: Pick<TopologyRecord, "nodes" | "nodeRecords" | "spawnRules">,
  candidateNodeIds: string[],
): string[] {
  const candidateNodeIdSet = new Set(candidateNodeIds);
  const nodeRecords = getTopologyNodeRecords(topology as TopologyRecord);
  const spawnAgentTemplateNames = new Set(
    topology.spawnRules?.flatMap((rule) => rule.spawnedAgents.map((agent) => agent.templateName)) ?? [],
  );
  const latestRuntimeNodeIdByTemplate = new Map<string, string>();
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const resolveRuntimeNodeIndex = (templateName: string, runtimeNodeId: string) => {
    const match = new RegExp(`^${escapeRegExp(templateName)}-(\\d+)$`).exec(runtimeNodeId);
    return match ? Number.parseInt(match[1] ?? "0", 10) : Number.MAX_SAFE_INTEGER;
  };

  for (const templateName of spawnAgentTemplateNames) {
    const runtimeNodeIds = candidateNodeIds
      .filter((nodeId) => new RegExp(`^${escapeRegExp(templateName)}-(\\d+)$`).test(nodeId))
      .sort((left, right) =>
        resolveRuntimeNodeIndex(templateName, left) - resolveRuntimeNodeIndex(templateName, right));
    const latestRuntimeNodeId = runtimeNodeIds.at(-1);
    if (latestRuntimeNodeId) {
      latestRuntimeNodeIdByTemplate.set(templateName, latestRuntimeNodeId);
    }
  }

  const orderedTemplateNodeIds = topology.nodes.length > 0
    ? topology.nodes
    : nodeRecords
      .filter((node) => node.kind !== "spawn")
      .map((node) => node.id);

  return orderedTemplateNodeIds.flatMap((nodeId) => {
    const latestRuntimeNodeId = latestRuntimeNodeIdByTemplate.get(nodeId);
    if (latestRuntimeNodeId) {
      return [latestRuntimeNodeId];
    }
    if (candidateNodeIdSet.has(nodeId)) {
      return [nodeId];
    }
    return [];
  });
}

export function upsertDebateSpawnDraft(
  topology: TopologyRecord,
  input: DebateSpawnDraftInput,
): TopologyRecord {
  const teamName = input.teamName.trim();
  if (!teamName) {
    throw new Error("动态团队名称不能为空。");
  }

  const spawnRuleId = buildSpawnRuleId(teamName);
  const spawnNodeId = teamName;
  let nodeRecords = getTopologyNodeRecords(topology).map((node) => ({ ...node }));
  for (const templateName of [
    input.sourceTemplateName,
    input.proTemplateName,
    input.conTemplateName,
    input.summaryTemplateName,
    input.reportToTemplateName,
  ]) {
    if (!nodeRecords.some((node) => node.id === templateName)) {
      nodeRecords.push({
        id: templateName,
        kind: "agent",
        templateName,
        initialMessageRouting: { mode: "inherit" },
      });
    }
  }
  nodeRecords = ensureNodeRecord(nodeRecords, {
    id: spawnNodeId,
    kind: "spawn",
    templateName: input.proTemplateName,
    initialMessageRouting: { mode: "inherit" },
    spawnRuleId,
  });

  const nodeIds = topology.nodes.length > 0 ? [...topology.nodes] : nodeRecords
    .filter((node) => node.kind === "agent")
    .map((node) => node.id);
  for (const templateName of [
    input.sourceTemplateName,
    input.proTemplateName,
    input.conTemplateName,
    input.summaryTemplateName,
    input.reportToTemplateName,
  ]) {
    if (!nodeIds.includes(templateName)) {
      nodeIds.push(templateName);
    }
  }

  const spawnRule: SpawnRule = {
    id: spawnRuleId,
    spawnNodeName: spawnNodeId,
    sourceTemplateName: input.sourceTemplateName,
    entryRole: "pro",
    spawnedAgents: [
      { role: "pro", templateName: input.proTemplateName },
      { role: "con", templateName: input.conTemplateName },
      { role: "summary", templateName: input.summaryTemplateName },
    ],
    edges: [
      { sourceRole: "pro", targetRole: "con", trigger: DEBATE_TURN_TRIGGER, messageMode: "last" },
      { sourceRole: "con", targetRole: "pro", trigger: DEBATE_TURN_TRIGGER, messageMode: "last" },
      { sourceRole: "pro", targetRole: "summary", trigger: DEBATE_SUMMARY_TRIGGER, messageMode: "last" },
      { sourceRole: "con", targetRole: "summary", trigger: DEBATE_SUMMARY_TRIGGER, messageMode: "last" },
    ],
    exitWhen: "one_side_agrees",
    reportToTemplateName: input.reportToTemplateName,
    reportToTrigger: DEFAULT_TOPOLOGY_TRIGGER,
  };

  const nextEdges = topology.edges.filter(
    (edge) => !(edge.source === input.sourceTemplateName && edge.target === spawnNodeId),
  ).concat({
    source: input.sourceTemplateName,
    target: spawnNodeId,
    trigger: DEFAULT_TOPOLOGY_TRIGGER,
    messageMode: "last" as const,
  });

  const nextSpawnRules = (topology.spawnRules ?? []).filter((rule) => rule.id !== spawnRuleId).concat(spawnRule);

  return {
    ...topology,
    nodes: nodeIds,
    edges: nextEdges,
    nodeRecords,
    spawnRules: nextSpawnRules,
  };
}
