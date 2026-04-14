export function toOpenCodeAgentName(agentName: string): string {
  if (agentName === "Build") {
    return "build";
  }
  return agentName;
}
