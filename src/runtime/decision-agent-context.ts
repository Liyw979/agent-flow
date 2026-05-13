import { isDecisionAgentInTopology, type TopologyRecord } from "@shared/types";

import type { GraphTaskState } from "./gating-state";
import { buildEffectiveTopology } from "./runtime-topology-graph";

type DecisionAgentState =
  | {
      kind: "available";
      value: GraphTaskState;
    }
  | {
      kind: "absent";
    };

export function isExecutionDecisionAgent(input: {
  state: DecisionAgentState;
  topology: Pick<TopologyRecord, "edges"> & Partial<Pick<TopologyRecord, "langgraph">>;
  runtimeAgentId: string;
  executableAgentId: string;
}): boolean {
  const effectiveTopology = input.state.kind === "available"
    ? buildEffectiveTopology(input.state.value)
    : input.topology;

  return (
    isDecisionAgentInTopology(effectiveTopology, input.runtimeAgentId)
    || isDecisionAgentInTopology(effectiveTopology, input.executableAgentId)
    || isDecisionAgentInTopology(input.topology, input.runtimeAgentId)
    || isDecisionAgentInTopology(input.topology, input.executableAgentId)
  );
}
