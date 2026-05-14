import { test } from "bun:test";
import assert from "node:assert/strict";

import { getAppWorkspaceLayoutMetrics } from "./app-workspace-layout";

test("主布局间距缩小 50%，但团队面板宽度保持原值", () => {
  const metrics = getAppWorkspaceLayoutMetrics();

  assert.deepEqual(metrics, {
    panelGapPx: 5,
    teamPanelMinWidthPx: 340,
    teamPanelMaxWidthPx: 380,
  });
});
