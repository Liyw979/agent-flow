interface AgentPanelColorToken {
  background: string;
  border: string;
}

const AGENT_PANEL_COLOR_TOKENS: Record<string, AgentPanelColorToken> = {
  ba: {
    background: "#F4EED4",
    border: "#B8A64B",
  },
  build: {
    background: "#DDD7EE",
    border: "#B7AFE8",
  },
  codereview: {
    background: "#F4E0D4",
    border: "#E4B18F",
  },
  unittest: {
    background: "#DCDDFA",
    border: "#AEB7F2",
  },
  taskreview: {
    background: "#F4E0D4",
    border: "#E4B18F",
  },
};

const FALLBACK_AGENT_PANEL_COLOR_TOKENS: AgentPanelColorToken[] = [
  {
    background: "#F4EED4",
    border: "#B8A64B",
  },
  {
    background: "#DDD7EE",
    border: "#B7AFE8",
  },
  {
    background: "#F4E0D4",
    border: "#E4B18F",
  },
];

function normalizeAgentName(agentName: string) {
  return agentName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hashAgentName(agentName: string) {
  return [...normalizeAgentName(agentName)].reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

export function getAgentPanelColorToken(agentName: string): AgentPanelColorToken {
  const normalized = normalizeAgentName(agentName);
  const matched = AGENT_PANEL_COLOR_TOKENS[normalized];
  if (matched) {
    return matched;
  }

  return FALLBACK_AGENT_PANEL_COLOR_TOKENS[
    hashAgentName(agentName) % FALLBACK_AGENT_PANEL_COLOR_TOKENS.length
  ]!;
}
