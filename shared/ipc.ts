export const IPC_CHANNELS = {
  bootstrap: "agent-team/bootstrap",
  submitTask: "agent-team/submit-task",
  openAgentTerminal: "agent-team/open-agent-terminal",
  getTaskRuntime: "agent-team/get-task-runtime",
  eventStream: "agent-team/event-stream",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
