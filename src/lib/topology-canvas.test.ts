import test from "node:test";
import assert from "node:assert/strict";

import { buildTopologyCanvasLayout } from "./topology-canvas";

test("buildTopologyCanvasLayout 会按面板宽高把节点横向纵向铺满", () => {
  const layout = buildTopologyCanvasLayout({
    nodes: ["BA", "Build", "CodeReview", "UnitTest", "TaskReview"],
    edges: [
      { source: "BA", target: "Build", triggerOn: "association" },
      { source: "Build", target: "CodeReview", triggerOn: "approved" },
    ],
    availableWidth: 1860,
    availableHeight: 360,
    columnGap: 20,
    sidePadding: 20,
    topPadding: 10,
    bottomPadding: 10,
  });

  assert.equal(layout.width, 1860);
  assert.equal(layout.height, 360);
  assert.deepEqual(
    layout.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    })),
    [
      { id: "BA", x: 20, y: 10, width: 348, height: 340 },
      { id: "Build", x: 388, y: 10, width: 348, height: 340 },
      { id: "CodeReview", x: 756, y: 10, width: 348, height: 340 },
      { id: "UnitTest", x: 1124, y: 10, width: 348, height: 340 },
      { id: "TaskReview", x: 1492, y: 10, width: 348, height: 340 },
    ],
  );
  assert.equal(layout.edges.length, 0);
});
