interface RuntimeRefreshAcceptanceInput {
  latestAcceptedRequestId: number;
  requestId: number;
}

export function shouldAcceptRuntimeRefresh(input: RuntimeRefreshAcceptanceInput): boolean {
  return input.requestId > input.latestAcceptedRequestId;
}
