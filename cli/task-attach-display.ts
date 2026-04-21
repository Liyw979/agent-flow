interface TaskAttachCommandEntry {
  agentName: string;
  opencodeAttachCommand: string | null;
}

export function renderTaskAttachCommands(entries: TaskAttachCommandEntry[]): string {
  let output = "\nattach:\n";
  for (const entry of entries) {
    output += `- ${entry.agentName} | ${entry.opencodeAttachCommand ?? "当前还没有可用 session"}\n`;
  }
  output += "\n";
  return output;
}
