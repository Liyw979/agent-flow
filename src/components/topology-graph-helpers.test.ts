import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  getTopologyAgentStatusBadgePresentation,
  getTopologyNodeHeaderActionOrder,
} from "./topology-graph-helpers";

test("getTopologyAgentStatusBadgePresentation 会把 agent 状态映射为 Electron 同款图标与文案", () => {
  assert.deepEqual(
    getTopologyAgentStatusBadgePresentation("completed"),
    {
      label: "已完成",
      icon: "success",
      className: "border border-[#2c4a3f]/18 bg-[#edf5f0] text-[#2c4a3f]",
      effectClassName: "",
    },
  );

  assert.deepEqual(
    getTopologyAgentStatusBadgePresentation("running"),
    {
      label: "运行中",
      icon: "running",
      className:
        "border border-[#d8b14a]/70 bg-[linear-gradient(180deg,#fff7d8_0%,#ffedb8_100%)] text-[#6b5208]",
      effectClassName: "topology-status-badge-running",
    },
  );

  assert.deepEqual(
    getTopologyAgentStatusBadgePresentation("failed"),
    {
      label: "执行失败",
      icon: "failed",
      className: "border border-[#d66b63]/45 bg-[#fff1ef] text-[#a33f38]",
      effectClassName: "",
    },
  );

  assert.deepEqual(
    getTopologyAgentStatusBadgePresentation("idle"),
    {
      label: "未启动",
      icon: "idle",
      className: "border border-[#c9d6ce]/85 bg-[#f7fbf8] text-[#5f7267]",
      effectClassName: "",
    },
  );
});

test("getTopologyNodeHeaderActionOrder 会把 attach 固定排在状态 icon 左边", () => {
  assert.deepEqual(
    getTopologyNodeHeaderActionOrder({
      showAttachButton: true,
    }),
    ["attach", "status"],
  );

  assert.deepEqual(
    getTopologyNodeHeaderActionOrder({
      showAttachButton: false,
    }),
    ["status"],
  );
});
