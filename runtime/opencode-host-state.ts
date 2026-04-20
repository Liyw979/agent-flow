import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface OpenCodeHostStateRecord {
  pid: number;
  port: number;
  cwd: string;
  startedAt: string;
  configDigest: string;
  version: string;
}

const OPENCODE_HOST_STATE_VERSION = "1";

export function getOpenCodeHostStatePath(cwd: string): string {
  return path.join(cwd, ".agent-team", "opencode-host.json");
}

export function normalizeOpenCodeHostStateRecord(value: unknown): OpenCodeHostStateRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<OpenCodeHostStateRecord>;
  if (
    typeof record.pid !== "number"
    || !Number.isFinite(record.pid)
    || typeof record.port !== "number"
    || !Number.isFinite(record.port)
    || typeof record.cwd !== "string"
    || record.cwd.trim().length === 0
    || typeof record.startedAt !== "string"
    || record.startedAt.trim().length === 0
    || typeof record.configDigest !== "string"
    || record.configDigest.trim().length === 0
    || typeof record.version !== "string"
    || record.version.trim().length === 0
  ) {
    return null;
  }

  return {
    pid: Math.trunc(record.pid),
    port: Math.trunc(record.port),
    cwd: record.cwd,
    startedAt: record.startedAt,
    configDigest: record.configDigest,
    version: record.version,
  };
}

export function buildOpenCodeHostConfigDigest(content: string | null): string {
  const normalized = content?.trim() ?? "";
  return createHash("sha1").update(normalized).digest("hex");
}

export function isOpenCodeHostStateReusable(
  record: OpenCodeHostStateRecord,
  target: {
    cwd: string;
    configDigest: string;
  },
): boolean {
  return record.cwd === target.cwd
    && record.configDigest === target.configDigest
    && record.version === OPENCODE_HOST_STATE_VERSION;
}

export function readOpenCodeHostState(cwd: string): OpenCodeHostStateRecord | null {
  const statePath = getOpenCodeHostStatePath(cwd);
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return normalizeOpenCodeHostStateRecord(raw);
  } catch {
    return null;
  }
}

export function writeOpenCodeHostState(cwd: string, record: Omit<OpenCodeHostStateRecord, "version">): void {
  const statePath = getOpenCodeHostStatePath(cwd);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    ...record,
    version: OPENCODE_HOST_STATE_VERSION,
  }, null, 2));
}

export function deleteOpenCodeHostState(cwd: string): void {
  const statePath = getOpenCodeHostStatePath(cwd);
  if (fs.existsSync(statePath)) {
    fs.rmSync(statePath);
  }
}
