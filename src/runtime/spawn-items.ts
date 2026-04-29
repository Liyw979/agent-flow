import type { SpawnItemPayload } from "@shared/types";
import { parseJson5 } from "@shared/json5";

function extractCandidateJsonStrings(content: string): string[] {
  const trimmed = content.trim();
  const candidates: string[] = [];

  if (trimmed) {
    candidates.push(trimmed);
  }

  const fencePattern = /```(?:json5?|JSON5?)?\s*([\s\S]*?)```/gu;
  for (const match of trimmed.matchAll(fencePattern)) {
    const body = match[1]?.trim();
    if (body) {
      candidates.push(body);
    }
  }

  return candidates;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  for (const candidate of extractCandidateJsonStrings(content)) {
    try {
      const parsed = parseJson5(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function extractSpawnItemsFromContent(content: string): { items: SpawnItemPayload[] } {
  const parsed = parseJsonObject(content);
  if (!parsed) {
    throw new Error("spawn 上游输出必须提供 JSON 对象，且对象里包含可展开的 items 数组。");
  }

  const rawItems = parsed["items"];
  if (rawItems === undefined) {
    throw new Error("spawn 上游输出缺少 items 字段。");
  }
  if (!Array.isArray(rawItems)) {
    throw new Error("spawn 上游输出中的 items 字段必须是数组。");
  }

  return {
    items: rawItems.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`spawn items[${index}] 必须是包含 title 字段的对象。`);
      }
      const record = item as Record<string, unknown>;
      const title = typeof record["title"] === "string" ? record["title"].trim() : "";
      if (!title) {
        throw new Error(`spawn items[${index}] 缺少非空 title。`);
      }
      const id = typeof record["id"] === "string" && record["id"].trim()
        ? record["id"].trim()
        : title;
      return { id, title };
    }),
  };
}
