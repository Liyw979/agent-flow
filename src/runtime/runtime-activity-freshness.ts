import type { OpenCodeRuntimeActivity } from "./opencode-client";

export interface RuntimeActivityFreshness {
  detailStateRank: number;
  detailParseModeRank: number;
  detailPayloadKeyCount: number;
  detailPlaceholderRank: number;
  timestampMs: number;
}

function rankDetailState(
  detailState: OpenCodeRuntimeActivity["detailState"],
): number {
  switch (detailState) {
    case "complete":
      return 2;
    case "missing":
      return 1;
    case "not_applicable":
      return 0;
  }
}

function rankDetailParseMode(
  detailParseMode: OpenCodeRuntimeActivity["detailParseMode"],
): number {
  switch (detailParseMode) {
    case "structured":
      return 2;
    case "plain_text":
      return 1;
    case "missing":
    case "not_applicable":
      return 0;
  }
}

export function buildRuntimeActivityFreshness(
  activity: OpenCodeRuntimeActivity,
): RuntimeActivityFreshness {
  const timestampMs = Date.parse(activity.timestamp);
  return {
    detailStateRank: rankDetailState(activity.detailState),
    detailParseModeRank: rankDetailParseMode(activity.detailParseMode),
    detailPayloadKeyCount: activity.detailPayloadKeyCount,
    detailPlaceholderRank: activity.detailHasPlaceholderValue ? 0 : 1,
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
  };
}

export function isRuntimeActivityFreshnessNewer(
  existing: RuntimeActivityFreshness,
  next: RuntimeActivityFreshness,
): boolean {
  if (next.detailStateRank !== existing.detailStateRank) {
    return next.detailStateRank > existing.detailStateRank;
  }
  if (next.detailParseModeRank !== existing.detailParseModeRank) {
    return next.detailParseModeRank > existing.detailParseModeRank;
  }
  if (next.detailPayloadKeyCount !== existing.detailPayloadKeyCount) {
    return next.detailPayloadKeyCount > existing.detailPayloadKeyCount;
  }
  if (next.detailPlaceholderRank !== existing.detailPlaceholderRank) {
    return next.detailPlaceholderRank > existing.detailPlaceholderRank;
  }
  return next.timestampMs > existing.timestampMs;
}
