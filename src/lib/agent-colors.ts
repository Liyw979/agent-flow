interface AgentColorToken {
  solid: string;
  soft: string;
  border: string;
  text: string;
  mutedText: string;
  badgeText: string;
}

const AGENT_COLOR_TOKENS: AgentColorToken[] = [
  {
    solid: "#2F6F5E",
    soft: "#E4F2EC",
    border: "#9BC8B8",
    text: "#173328",
    mutedText: "#48685D",
    badgeText: "#F7FBF9",
  },
  {
    solid: "#A7562A",
    soft: "#F9E8DD",
    border: "#E5B393",
    text: "#4F2410",
    mutedText: "#84523A",
    badgeText: "#FFF8F3",
  },
  {
    solid: "#3E6794",
    soft: "#E6EEF8",
    border: "#A8C0E0",
    text: "#19314E",
    mutedText: "#4D6887",
    badgeText: "#F5F9FF",
  },
  {
    solid: "#8C5E9E",
    soft: "#F2E9F6",
    border: "#D2B6DE",
    text: "#432851",
    mutedText: "#715B7E",
    badgeText: "#FCF8FF",
  },
  {
    solid: "#A06C23",
    soft: "#F7ECD7",
    border: "#DEC18E",
    text: "#4B3310",
    mutedText: "#7D6540",
    badgeText: "#FFFBEF",
  },
  {
    solid: "#A0455E",
    soft: "#F9E4EA",
    border: "#E0A7B6",
    text: "#4C1E2A",
    mutedText: "#815562",
    badgeText: "#FFF8FA",
  },
  {
    solid: "#576A2A",
    soft: "#EDF2DD",
    border: "#BDCC97",
    text: "#2D3814",
    mutedText: "#617042",
    badgeText: "#FAFDED",
  },
  {
    solid: "#2C7A7B",
    soft: "#DFF3F1",
    border: "#97D0CB",
    text: "#153B3A",
    mutedText: "#4A7270",
    badgeText: "#F4FEFC",
  },
];

function hashAgentName(name: string) {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function getAgentColorToken(agentName: string): AgentColorToken {
  const normalized = agentName.trim().toLowerCase();
  const index = hashAgentName(normalized) % AGENT_COLOR_TOKENS.length;
  return AGENT_COLOR_TOKENS[index] ?? AGENT_COLOR_TOKENS[0];
}
