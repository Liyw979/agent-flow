import { test } from "bun:test";
import assert from "node:assert/strict";
import { getPanelFullscreenButtonCopy } from "./panel-fullscreen-label";

test("非全屏态统一显示为全屏", () => {
  assert.deepEqual(getPanelFullscreenButtonCopy(false), {
    label: "全屏",
    ariaLabel: "进入全屏",
  });
});

test("全屏态统一显示为退出全屏", () => {
  assert.deepEqual(getPanelFullscreenButtonCopy(true), {
    label: "退出全屏",
    ariaLabel: "退出全屏",
  });
});
