import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const SUPPORTED_TOPOLOGY_FILE_EXTENSIONS = new Set([".yaml", ".yml"]);

export function isSupportedTopologyFile(filePath: string): boolean {
  return SUPPORTED_TOPOLOGY_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function assertSupportedTopologyFile(file: string): string {
  const resolved = path.resolve(file);
  if (!isSupportedTopologyFile(resolved)) {
    throw new Error(`团队拓扑文件必须是 .yaml 或 .yml：${resolved}`);
  }
  return resolved;
}

export function loadTeamDslDefinitionFile<T = unknown>(file: string): T {
  const resolved = assertSupportedTopologyFile(file);
  return parse(fs.readFileSync(resolved, "utf8")) as T;
}
