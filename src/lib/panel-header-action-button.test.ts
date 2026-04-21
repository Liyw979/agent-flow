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
  assert.match(topologyGraphSource, /PANEL_HEADER_ACTION_BUTTON_CLASS|getPanelHeaderActionButtonClass/);
});

test("消息与拓扑头部的全屏按钮文案必须统一走全屏语义，而不是继续写死放大消息", () => {
  const chatWindowSource = readSource("../components/ChatWindow.tsx");
  const topologyGraphSource = readSource("../components/TopologyGraph.tsx");

  assert.match(chatWindowSource, /getPanelFullscreenButtonCopy/);
  assert.match(topologyGraphSource, /getPanelFullscreenButtonCopy/);
  assert.doesNotMatch(chatWindowSource, /放大消息|恢复布局|放大消息面板|恢复默认布局/);
  assert.doesNotMatch(topologyGraphSource, /放大消息|放大消息面板/);
});
