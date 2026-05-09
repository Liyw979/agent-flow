import {
  getTopologyNodeRecords,
  isActionRequiredTopologyTrigger,
  type RuntimeTopologyEdge,
  type SpawnBundleRuntimeNode,
  type SpawnBundleInstantiation,
  type SpawnItemPayload,
  type SpawnRule,
  type TopologyRecord,
} from "@shared/types";

function sanitizeInstanceSegment(value: string): string {
  return value.trim().replace(/\s+/g, "-");
}

function resolveRuntimeNodeIndex(itemId: string, explicitIndex?: number): number | string {
  if (typeof explicitIndex === "number" && Number.isInteger(explicitIndex) && explicitIndex > 0) {
    return explicitIndex;
  }
  const match = itemId.match(/(\d+)(?!.*\d)/u);
  if (match) {
    return Number.parseInt(match[1] ?? "0", 10);
  }
  return 1;
}

function buildRuntimeNodeId(templateName: string, itemId: string, explicitIndex?: number): string {
  return `${templateName}-${resolveRuntimeNodeIndex(itemId, explicitIndex)}`;
}

function resolveSpawnRuleTerminalRoles(rule: SpawnRule): string[] {
  const outgoingRoles = new Set(rule.edges.map((edge) => edge.sourceRole));
  return rule.spawnedAgents
    .map((agent) => agent.role)
    .filter((role) => !outgoingRoles.has(role));
}

export function instantiateSpawnBundle(input: {
  topology: TopologyRecord;
  spawnRuleId: string;
  activationId: string;
  item: SpawnItemPayload;
  instanceIndex?: number;
}): SpawnBundleInstantiation {
  const rule = input.topology.spawnRules?.find((candidate) => candidate.id === input.spawnRuleId);
  if (!rule) {
    throw new Error(`spawn rule 不存在：${input.spawnRuleId}`);
  }

  const topologyNodes = getTopologyNodeRecords(input.topology);
  const effectiveSpawnNodeName = rule.spawnNodeName
    || topologyNodes.find((node) => node.spawnRuleId === rule.id)?.id
    || "";
  const spawnNode = topologyNodes.find((node) =>
    node.id === effectiveSpawnNodeName || node.templateName === effectiveSpawnNodeName,
  );
  if (!spawnNode) {
    throw new Error(`spawn rule 缺少 spawn 节点：${effectiveSpawnNodeName || rule.id}`);
  }
  const sourceLookupName = rule.sourceTemplateName ?? spawnNode.id;
  const sourceNode = topologyNodes.find((node) =>
    node.id === sourceLookupName || node.templateName === sourceLookupName,
  );
  if (!sourceNode) {
    throw new Error(`spawn rule 缺少 source template：${sourceLookupName}`);
  }

  const groupId = `${sanitizeInstanceSegment(rule.id)}:${sanitizeInstanceSegment(input.item.id)}`;
  const nodes: SpawnBundleRuntimeNode[] = rule.spawnedAgents.map((agent) => {
    const templateNode = topologyNodes.find(
      (node) => node.id === agent.templateName || node.templateName === agent.templateName,
    );
    const sharedNode = {
      id: buildRuntimeNodeId(agent.templateName, input.item.id, input.instanceIndex),
      templateName: agent.templateName,
      displayName: buildRuntimeNodeId(agent.templateName, input.item.id, input.instanceIndex),
      sourceNodeId: sourceNode.id,
      groupId,
      role: agent.role,
    };
    if (templateNode?.kind === "spawn") {
      if (!templateNode.spawnRuleId) {
        throw new Error(`spawn template 缺少 spawnRuleId：${agent.templateName}`);
      }
      return {
        ...sharedNode,
        kind: "spawn",
        spawnRuleId: templateNode.spawnRuleId,
      };
    }
    return {
      ...sharedNode,
      kind: "agent",
    };
  });

  const edges: RuntimeTopologyEdge[] = rule.edges.map((edge) => {
    const sourceNodeInstance = nodes.find((node) => node.role === edge.sourceRole);
    const targetNodeInstance = nodes.find((node) => node.role === edge.targetRole);
    if (!sourceNodeInstance || !targetNodeInstance) {
      throw new Error(`spawn rule ${rule.id} 的 role 连线不完整：${edge.sourceRole} -> ${edge.targetRole}`);
    }
    return {
      source: sourceNodeInstance.id,
      target: targetNodeInstance.id,
      trigger: edge.trigger,
      messageMode: edge.messageMode,
      ...(isActionRequiredTopologyTrigger(edge.trigger, edge.maxTriggerRounds) && typeof edge.maxTriggerRounds === "number"
        ? { maxTriggerRounds: edge.maxTriggerRounds }
        : {}),
    };
  });

  const sourceToSpawnEdge = input.topology.edges.find((edge) =>
    edge.source === sourceNode.id
    && edge.target === spawnNode.id,
  );
  const entryNode = nodes.find((node) => node.role === rule.entryRole);
  if (sourceToSpawnEdge && entryNode) {
    edges.unshift({
      source: sourceNode.id,
      target: entryNode.id,
      trigger: sourceToSpawnEdge.trigger,
      messageMode: sourceToSpawnEdge.messageMode,
      ...(isActionRequiredTopologyTrigger(sourceToSpawnEdge.trigger, sourceToSpawnEdge.maxTriggerRounds)
        && typeof sourceToSpawnEdge.maxTriggerRounds === "number"
        ? { maxTriggerRounds: sourceToSpawnEdge.maxTriggerRounds }
        : {}),
    });
  }

  const reportNode = rule.report !== false
    ? topologyNodes.find(
        (node) => node.templateName === rule.report.templateName || node.id === rule.report.templateName,
      )
    : null;
  if (rule.report !== false && !reportNode) {
    throw new Error(`spawn rule 缺少 report target template：${rule.report.templateName}`);
  }

  const terminalRoles = resolveSpawnRuleTerminalRoles(rule);
  const reportSourceNode = terminalRoles.length === 1
    ? nodes.find((node) => node.role === terminalRoles[0])
    : undefined;
  const spawnToReportEdge = reportNode
    ? input.topology.edges.find((edge) =>
      edge.source === spawnNode.id
      && edge.target === reportNode.id)
    : undefined;
  if (reportSourceNode && reportNode && rule.report !== false) {
    const reportTrigger = spawnToReportEdge?.trigger ?? rule.report.trigger;
    const reportMaxTriggerRounds = spawnToReportEdge?.maxTriggerRounds
      ?? (rule.report.maxTriggerRounds === false
        ? undefined
        : rule.report.maxTriggerRounds);
    edges.push({
      source: reportSourceNode.id,
      target: reportNode.id,
      trigger: reportTrigger,
      messageMode:
        spawnToReportEdge?.messageMode
        ?? rule.report.messageMode,
      ...(isActionRequiredTopologyTrigger(reportTrigger, reportMaxTriggerRounds)
        && typeof reportMaxTriggerRounds === "number"
        ? { maxTriggerRounds: reportMaxTriggerRounds }
        : {}),
    });
  }

  return {
    groupId,
    activationId: input.activationId,
    spawnNodeName: effectiveSpawnNodeName,
    item: input.item,
    nodes,
    edges,
  };
}

export function instantiateSpawnBundles(input: {
  topology: TopologyRecord;
  spawnRuleId: string;
  activationId: string;
  items: SpawnItemPayload[];
}): SpawnBundleInstantiation[] {
  const useExplicitIndex = input.items.length > 1;
  return input.items.map((item, index) =>
    instantiateSpawnBundle({
      topology: input.topology,
      spawnRuleId: input.spawnRuleId,
      activationId: input.activationId,
      item,
      ...(useExplicitIndex ? { instanceIndex: index + 1 } : {}),
    }),
  );
}

export function validateSpawnRule(topology: TopologyRecord, rule: SpawnRule): void {
  const topologyNodes = getTopologyNodeRecords(topology);
  const knownTemplateNames = new Set(topologyNodes.map((node) => node.templateName));
  const knownNodeIds = new Set(topologyNodes.map((node) => node.id));
  const effectiveSpawnNodeName = rule.spawnNodeName
    || topologyNodes.find((node) => node.spawnRuleId === rule.id)?.id
    || "";
  if (!knownNodeIds.has(effectiveSpawnNodeName) && !knownTemplateNames.has(effectiveSpawnNodeName)) {
    throw new Error(`spawn rule 对应的 spawn 节点不存在：${effectiveSpawnNodeName || rule.id}`);
  }
  if (
    rule.report !== false
    && !knownTemplateNames.has(rule.report.templateName)
    && !knownNodeIds.has(rule.report.templateName)
  ) {
    throw new Error(`spawn rule report target 不存在：${rule.report.templateName}`);
  }
  const knownRoles = new Set(rule.spawnedAgents.map((agent) => agent.role));
  if (!knownRoles.has(rule.entryRole)) {
    throw new Error(`spawn rule entry role 不存在：${rule.entryRole}`);
  }
  if (rule.report !== false && resolveSpawnRuleTerminalRoles(rule).length !== 1) {
    throw new Error(`spawn rule ${rule.id} 存在 report target 时，子图必须有且仅有一个终局 role。`);
  }
  for (const edge of rule.edges) {
    if (!knownRoles.has(edge.sourceRole) || !knownRoles.has(edge.targetRole)) {
      throw new Error(`spawn rule 含有未知 role 连线：${edge.sourceRole} -> ${edge.targetRole}`);
    }
  }
}
