export interface TaskAttachCommandEntry {
  agentName: string;
  taskAttachCommand: string;
  opencodeAttachCommand: string | null;
}

export function renderTaskAttachCommands(entries: TaskAttachCommandEntry[]): string {
  let output = "\nattach:\n";
  for (const entry of entries) {
    output += `- ${entry.agentName} | attach: ${entry.taskAttachCommand}\n`;
    output += `  opencode attach: ${entry.opencodeAttachCommand ?? "当前还没有可用 session"}\n`;
  }
  output += "\n";
  return output;
}
