import type {
  AgentFlowEvent,
  AgentRuntimeSnapshot,
  GetTaskRuntimePayload,
  OpenAgentTerminalPayload,
  SubmitTaskPayload,
  TaskSnapshot,
  UiBootstrapPayload,
} from "@shared/types";

function buildQuery(params: Record<string, string>) {
  return new URLSearchParams(params).toString();
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function readLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    cwd: params.get("cwd")?.trim() ?? "",
    taskId: params.get("taskId")?.trim() ?? "",
  };
}

export function bootstrapTask(params: { cwd: string; taskId: string }) {
  return fetchJson<UiBootstrapPayload>(`/api/bootstrap?${buildQuery(params)}`);
}

export function getTaskRuntime(payload: GetTaskRuntimePayload) {
  return fetchJson<AgentRuntimeSnapshot[]>(`/api/tasks/runtime?${buildQuery({
    cwd: payload.cwd,
    taskId: payload.taskId,
  })}`);
}

export function submitTask(payload: SubmitTaskPayload) {
  return fetchJson<TaskSnapshot>("/api/tasks/submit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function openAgentTerminal(payload: OpenAgentTerminalPayload) {
  await fetchJson<{ ok: true }>("/api/tasks/open-agent-terminal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function subscribeAgentFlowEvents(
  params: {
    cwd: string;
    taskId: string;
  },
  listener: (event: AgentFlowEvent) => void,
) {
  const source = new EventSource(`/api/events?${buildQuery(params)}`);
  source.onmessage = (message) => {
    try {
      const payload = JSON.parse(message.data) as AgentFlowEvent | { type: "connected" };
      if (payload.type === "connected") {
        return;
      }
      listener(payload);
    } catch {
      // ignore malformed events
    }
  };
  return () => {
    source.close();
  };
}
