const SESSION_CREATE_TIMEOUT_MS = 12_000;

interface ResolveOpenCodeRequestTimeoutInput {
  pathname: string;
  method: "GET" | "POST";
}

export function shouldTimeboxOpenCodeRequest(
  input: ResolveOpenCodeRequestTimeoutInput,
): boolean {
  return !(
    input.method === "POST"
    && /^\/session\/[^/]+\/message$/.test(input.pathname)
  );
}

export function getOpenCodeRequestTimeoutMs(): number {
  return SESSION_CREATE_TIMEOUT_MS;
}
