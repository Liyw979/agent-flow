import type { GroupItemPayload } from "@shared/types";

import type { GraphTaskState } from "./gating-state";
import { instantiateGroupBundles } from "./runtime-topology";
import { buildEffectiveTopology, ensureRuntimeAgentStatuses } from "./runtime-topology-graph";

export function materializeRuntimeGroupAgentsForItems(input: {
  state: GraphTaskState;
  groupRuleId: string;
  activationId?: string;
  items: GroupItemPayload[];
  sourceRuntimeNodeId?: string;
  sourceRuntimeTemplateName?: string;
  reportRuntimeNodeId?: string;
}) {
  const bundles = instantiateGroupBundles({
    topology: buildEffectiveTopology(input.state),
    groupRuleId: input.groupRuleId,
    activationId: input.activationId ?? input.groupRuleId,
    items: input.items,
    ...(input.sourceRuntimeNodeId ? { sourceRuntimeNodeId: input.sourceRuntimeNodeId } : {}),
    ...(input.sourceRuntimeTemplateName ? { sourceRuntimeTemplateName: input.sourceRuntimeTemplateName } : {}),
    ...(input.reportRuntimeNodeId ? { reportRuntimeNodeId: input.reportRuntimeNodeId } : {}),
  });

  const createdBundles = [];
  for (const bundle of bundles) {
    if (input.state.groupBundles.some((existing) => existing.groupId === bundle.groupId)) {
      continue;
    }
    input.state.groupBundles.push(bundle);
    input.state.runtimeNodes.push(...bundle.nodes);
    input.state.runtimeEdges.push(...bundle.edges);
    createdBundles.push(bundle);
  }

  ensureRuntimeAgentStatuses(input.state);
  return createdBundles;
}
