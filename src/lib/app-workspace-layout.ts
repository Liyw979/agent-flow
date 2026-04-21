export interface AppWorkspaceLayoutMetrics {
  panelGapPx: number;
  teamPanelMinWidthPx: number;
  teamPanelMaxWidthPx: number;
}

export function getAppWorkspaceLayoutMetrics(): AppWorkspaceLayoutMetrics {
  return {
    panelGapPx: 5,
    teamPanelMinWidthPx: 340,
    teamPanelMaxWidthPx: 380,
  };
}
