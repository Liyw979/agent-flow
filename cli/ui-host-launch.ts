export function buildUiUrl(input: {
  port: number;
  taskId: string;
}): string {
  const query = new URLSearchParams({
    taskId: input.taskId,
  });
  return `http://127.0.0.1:${input.port}/?${query.toString()}`;
}
