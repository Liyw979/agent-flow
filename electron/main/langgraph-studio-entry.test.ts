import test from "node:test";
import assert from "node:assert/strict";

import { createStudioGraph } from "./langgraph-studio-entry";

test("createStudioGraph 生成的节点名必须符合 LangGraph 约束", () => {
  assert.doesNotThrow(() => {
    createStudioGraph({
      projectId: "project-a",
      nodes: ["Build"],
      edges: [],
    });
  });
});
