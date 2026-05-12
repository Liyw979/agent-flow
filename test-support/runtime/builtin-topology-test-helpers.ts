import fs from "node:fs";
import { parse } from "yaml";

import { compileTeamDsl, type TeamDslDefinition } from "@/runtime/team-dsl";

const BUILTIN_TOPOLOGY_DIR = new URL("../../config/team-topologies/", import.meta.url);

export function readBuiltinTopology(fileName: string): TeamDslDefinition {
  return parse(fs.readFileSync(new URL(fileName, BUILTIN_TOPOLOGY_DIR), "utf8")) as TeamDslDefinition;
}

export function compileBuiltinTopology(fileName: string) {
  return compileTeamDsl(readBuiltinTopology(fileName));
}
