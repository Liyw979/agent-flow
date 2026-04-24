import type { GraphTaskState } from "./gating-state";

export function resolveForwardingActiveAgentIdsFromState(
  state: Pick<GraphTaskState, "runtimeNodes">,
  sourceAgentId: string,
  targetAgentId: string,
): string[] {
  const sourceRuntimeNode = state.runtimeNodes.find((node) => node.id === sourceAgentId);
  if (!sourceRuntimeNode?.groupId) {
    return [...new Set([sourceAgentId, targetAgentId].map((value) => value.trim()).filter(Boolean))];
  }

  const activeGroupAgentIds = state.runtimeNodes
    .filter((node) => node.groupId === sourceRuntimeNode.groupId)
    .map((node) => node.id);
  const sourceFindingAgentIds = [
    sourceRuntimeNode.sourceNodeId,
    ...activeGroupAgentIds,
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return sourceFindingAgentIds.length > 0 ? [...new Set(sourceFindingAgentIds)] : [sourceAgentId];
}
