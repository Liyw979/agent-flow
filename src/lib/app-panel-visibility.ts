export type AppPanelMode = "default" | "chat-only" | "topology-only";

export interface AppPanelVisibility {
  showTopologyPanel: boolean;
  showChatPanel: boolean;
  showTeamPanel: boolean;
}

export function resolveAppPanelVisibility(mode: AppPanelMode): AppPanelVisibility {
  if (mode === "chat-only") {
    return {
      showTopologyPanel: false,
      showChatPanel: true,
      showTeamPanel: false,
    };
  }

  if (mode === "topology-only") {
    return {
      showTopologyPanel: true,
      showChatPanel: false,
      showTeamPanel: false,
    };
  }

  return {
    showTopologyPanel: true,
    showChatPanel: true,
    showTeamPanel: true,
  };
}
