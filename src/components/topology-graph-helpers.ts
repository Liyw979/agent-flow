import { isReviewAgentInTopology, type TopologyEdge, type TopologyRecord } from "@shared/types";

export function getTopologyAgentStatusLabel(
  topology: Pick<TopologyRecord, "edges">,
  agentName: string,
  agentState: string,
) {
  const reviewAgent = isReviewAgentInTopology(topology, agentName);

  switch (agentState) {
    case "success":
      return reviewAgent ? "审视通过" : "已完成";
    case "failed":
      return reviewAgent ? "审视不通过" : "执行失败";
    case "needs_revision":
      return "审视不通过";
    case "running":
      return "运行中";
    default:
      return "未启动";
  }
}

export function getTopologyEdgeTriggerAppearance(triggerOn: TopologyEdge["triggerOn"]) {
  switch (triggerOn) {
    case "association":
      return {
        color: "#2C4A3F",
        strokeWidth: 2,
        strokeDasharray: undefined,
        zIndex: 1,
        animated: false,
      };
    case "review_pass":
      return {
        color: "#2F5E9E",
        strokeWidth: 2,
        strokeDasharray: "6 4",
        zIndex: 1,
        animated: false,
      };
    case "review_fail":
      return {
        color: "#A95C42",
        strokeWidth: 2,
        strokeDasharray: "6 4",
        zIndex: 1,
        animated: false,
      };
    default:
      return {
        color: "#2C4A3F",
        strokeWidth: 2,
        strokeDasharray: undefined,
        zIndex: 1,
        animated: false,
      };
  }
}

export function getTopologyNodeOrder(
  topology: Pick<TopologyRecord, "nodes" | "agentOrderIds">,
  defaultAgentOrderIds: string[],
) {
  return topology.agentOrderIds.length > 0 ? topology.agentOrderIds : defaultAgentOrderIds;
}
