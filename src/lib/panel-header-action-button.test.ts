import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("消息面板继续复用统一头部按钮样式，成员面板允许使用 Electron 同款专属按钮", () => {
  const appSource = readSource("../App.tsx");
  const chatWindowSource = readSource("../components/ChatWindow.tsx");
  const topologyGraphSource = readSource("../components/TopologyGraph.tsx");

  assert.doesNotMatch(appSource, /PANEL_HEADER_ACTION_BUTTON_CLASS|getPanelHeaderActionButtonClass/);
  assert.match(chatWindowSource, /PANEL_HEADER_ACTION_BUTTON_CLASS|getPanelHeaderActionButtonClass/);
  assert.doesNotMatch(topologyGraphSource, /PANEL_HEADER_ACTION_BUTTON_CLASS|getPanelHeaderActionButtonClass/);
});
