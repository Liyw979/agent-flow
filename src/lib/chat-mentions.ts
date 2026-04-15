export interface MentionContext {
  start: number;
  end: number;
  query: string;
}

export function getMentionContext(value: string, caret: number): MentionContext | null {
  const prefix = value.slice(0, caret);
  const match = prefix.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) {
    return null;
  }

  const start = prefix.lastIndexOf("@");
  if (start < 0) {
    return null;
  }

  return {
    start,
    end: caret,
    query: match[1] ?? "",
  };
}

export function getMentionOptions(availableAgents: string[], query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...availableAgents];
  }

  return availableAgents.filter((name) => name.toLowerCase().includes(normalizedQuery));
}
