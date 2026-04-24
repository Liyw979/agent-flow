import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type { TaskAgentRecord, TopologyRecord } from "@shared/types";

import { resolveTaskAgentIdsToPrewarm } from "./task-session-prewarm";
import { compileTeamDsl } from "./team-dsl";

function readBuiltinTopology(fileName: string) {
  return JSON.parse(
    fs.readFileSync(
      path.resolve("config", "team-topologies", fileName),
      "utf8",
    ),
  ) as Parameters<typeof compileTeamDsl>[0];
}

test("resolveTaskAgentIdsToPrewarm 不会为仅作为 spawn 模板存在的静态 agent 预建 session", () => {
  const topology: TopologyRecord = compileTeamDsl(
    readBuiltinTopology("vulnerability-team.topology.json"),
  ).topology;
  const taskAgents: TaskAgentRecord[] = [
    {
      taskId: "task-1",
      id: "线索发现",
      opencodeSessionId: null,
      opencodeAttachBaseUrl: null,
      status: "idle",
      runCount: 0,
    },
    {
      taskId: "task-1",
      id: "漏洞论证",
      opencodeSessionId: null,
      opencodeAttachBaseUrl: null,
      status: "idle",
      runCount: 0,
    },
    {
      taskId: "task-1",
      id: "漏洞挑战",
      opencodeSessionId: null,
      opencodeAttachBaseUrl: null,
      status: "idle",
      runCount: 0,
    },
    {
      taskId: "task-1",
      id: "讨论总结",
      opencodeSessionId: null,
      opencodeAttachBaseUrl: null,
      status: "idle",
      runCount: 0,
    },
  ];

  assert.deepEqual(resolveTaskAgentIdsToPrewarm(topology, taskAgents), ["线索发现"]);
});
