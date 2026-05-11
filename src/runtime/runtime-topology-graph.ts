import { getTopologyNodeRecords, type TopologyRecord } from "@shared/types";

import type { GraphTaskState } from "./gating-state";

export function buildEffectiveTopology(state: GraphTaskState): TopologyRecord {
  const runtimeNodeIds = state.runtimeNodes.map((node) => node.id);
  const staticNodeIds = state.topology.nodes.filter((name) => !runtimeNodeIds.includes(name));
  const topologyNodeRecords = getTopologyNodeRecords(state.topology);
  const runtimeNodeRecords = state.runtimeNodes.map((node) => ({
    ...(() => {
      const templateNode = topologyNodeRecords.find(
        (item) => item.id === node.templateName || item.templateName === node.templateName,
      );
      if (templateNode) {
        return templateNode;
      }
      return {
        id: node.templateName,
        kind: node.kind === "group" ? "group" : "agent",
        templateName: node.templateName,
        initialMessageRouting: { mode: "inherit" as const },
      };
    })(),
    id: node.id,
    kind: node.kind,
    templateName: node.templateName,
    ...((node.kind === "group" && "groupRuleId" in node) ? { groupRuleId: node.groupRuleId } : {}),
  }));

  return {
    ...state.topology,
    nodes: [...staticNodeIds, ...runtimeNodeIds],
    edges: [
      ...state.topology.edges.map((edge) => ({ ...edge })),
      ...state.runtimeEdges.map((edge) => ({ ...edge })),
    ],
    nodeRecords: [
      ...topologyNodeRecords.map((node) => ({ ...node })),
      ...runtimeNodeRecords,
    ],
  };
}

export function ensureRuntimeAgentStatuses(state: GraphTaskState): void {
  for (const nodeId of buildEffectiveTopology(state).nodes) {
    if (!state.agentStatusesByName[nodeId]) {
      state.agentStatusesByName[nodeId] = "idle";
    }
  }
}

export function isGroupNode(state: GraphTaskState, nodeId: string): boolean {
  const nodeRecords = getTopologyNodeRecords(buildEffectiveTopology(state));
  return nodeRecords.some((node) => node.id === nodeId && node.kind === "group");
}

export function getGroupRuleIdForNode(state: GraphTaskState, nodeId: string): string | null {
  const nodeRecords = getTopologyNodeRecords(buildEffectiveTopology(state));
  return nodeRecords.find((node) => node.id === nodeId && node.kind === "group")?.groupRuleId ?? null;
}

export function getGroupRuleEntryRuntimeNodeIds(state: GraphTaskState, groupId: string, groupRuleId: string): string[] {
  const rule = state.topology.groupRules?.find((candidate) => candidate.id === groupRuleId);
  if (!rule) {
    return [];
  }
  return state.runtimeNodes
    .filter((node) => node.groupId === groupId && node.role === rule.entryRole)
    .map((node) => node.id);
}

export function getRuntimeTemplateName(state: GraphTaskState, runtimeAgentId: string): string | null {
  return state.runtimeNodes.find((node) => node.id === runtimeAgentId)?.templateName ?? null;
}

export function getNextGroupSequence(state: GraphTaskState, groupRuleId: string): number {
  const next = (state.groupSequenceByRule[groupRuleId] ?? 0) + 1;
  state.groupSequenceByRule[groupRuleId] = next;
  return next;
}

export function buildGroupItemId(groupRuleId: string, sequence: number): string {
  return `${groupRuleId}-${String(sequence).padStart(4, "0")}`;
}
