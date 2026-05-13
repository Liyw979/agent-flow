export interface TopologyAgentStatusBadgePresentation {
  label: string;
  icon: "idle" | "running" | "success" | "failed";
  className: string;
  effectClassName: string;
}

type TopologyNodeHeaderAction = "attach" | "status";

export function getTopologyNodeHeaderActionOrder(input: {
  showAttachButton: boolean;
}): TopologyNodeHeaderAction[] {
  return [
    ...(input.showAttachButton ? (["attach"] as const) : []),
    "status",
  ];
}

export function getTopologyAgentStatusBadgePresentation(agentState: string): TopologyAgentStatusBadgePresentation {
  switch (agentState) {
    case "completed":
      return {
        label: "已完成",
        icon: "success",
        className: "border border-[#2c4a3f]/18 bg-[#edf5f0] text-[#2c4a3f]",
        effectClassName: "",
      };
    case "failed":
      return {
        label: "执行失败",
        icon: "failed",
        className: "border border-[#d66b63]/45 bg-[#fff1ef] text-[#a33f38]",
        effectClassName: "",
      };
    case "running":
      return {
        label: "运行中",
        icon: "running",
        className:
          "border border-[#d8b14a]/70 bg-[linear-gradient(180deg,#fff7d8_0%,#ffedb8_100%)] text-[#6b5208]",
        effectClassName: "topology-status-badge-running",
      };
    default:
      return {
        label: "未启动",
        icon: "idle",
        className: "border border-[#c9d6ce]/85 bg-[#f7fbf8] text-[#5f7267]",
        effectClassName: "",
      };
  }
}
