import test from "node:test";
import assert from "node:assert/strict";
import { resolveAppPanelVisibility } from "./app-panel-visibility";

test("默认模式继续展示拓扑、消息与团队三个面板", () => {
  assert.deepEqual(resolveAppPanelVisibility("default"), {
    showTopologyPanel: true,
    showChatPanel: true,
    showTeamPanel: true,
  });
});

test("消息放大模式只显示消息面板", () => {
  assert.deepEqual(resolveAppPanelVisibility("chat-only"), {
    showTopologyPanel: false,
    showChatPanel: true,
    showTeamPanel: false,
  });
});

test("拓扑全屏模式只显示拓扑面板", () => {
  assert.deepEqual(resolveAppPanelVisibility("topology-only"), {
    showTopologyPanel: true,
    showChatPanel: false,
    showTeamPanel: false,
  });
});
