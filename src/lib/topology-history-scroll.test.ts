import test from "node:test";
import assert from "node:assert/strict";
import {
  createTopologyHistoryAutoScrollTracker,
  shouldAutoScrollTopologyHistory,
  shouldStickTopologyHistoryToBottom,
} from "./topology-history-scroll";

test("新历史项追加且视口原本贴近底部时，拓扑历史区必须自动滚到底部", () => {
  assert.equal(
    shouldAutoScrollTopologyHistory({
      previousLastItemId: "history-1",
      nextLastItemId: "history-2",
      shouldStickToBottom: true,
    }),
    true,
  );
});

test("用户已经离开底部查看旧记录时，不应强行把拓扑历史区拉回到底部", () => {
  assert.equal(
    shouldAutoScrollTopologyHistory({
      previousLastItemId: "history-1",
      nextLastItemId: "history-2",
      shouldStickToBottom: false,
    }),
    false,
  );
});

test("拓扑历史区距离底部 48px 以内时，继续视为应追随底部", () => {
  assert.equal(
    shouldStickTopologyHistoryToBottom({
      scrollHeight: 500,
      clientHeight: 200,
      scrollTop: 252,
    }),
    true,
  );
});

test("createTopologyHistoryAutoScrollTracker 会把新追加的历史记录滚到底部", () => {
  const tracker = createTopologyHistoryAutoScrollTracker();
  const metrics = {
    scrollHeight: 640,
    scrollTop: 0,
  };
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
  tracker.bindViewport({
    get scrollHeight() {
      return metrics.scrollHeight;
    },
    get scrollTop() {
      return metrics.scrollTop;
    },
    set scrollTop(value: number) {
      metrics.scrollTop = value;
    },
  } as HTMLDivElement);

  try {
    const frameId = tracker.sync("history-2");
    assert.equal(frameId, 1);
    assert.equal(metrics.scrollTop, metrics.scrollHeight);
  } finally {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});

test("createTopologyHistoryAutoScrollTracker 会在重置追随状态后继续自动贴底，并在 reset 后允许解绑 viewport", () => {
  const tracker = createTopologyHistoryAutoScrollTracker();
  let scrollTop = 0;
  tracker.bindViewport({
    get scrollHeight() {
      return 900;
    },
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = value;
    },
  } as HTMLDivElement);

  tracker.updateStickState({
    scrollHeight: 900,
    clientHeight: 200,
    scrollTop: 100,
  });
  assert.equal(tracker.sync("history-2"), null);
  assert.equal(scrollTop, 0);

  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;

  try {
    tracker.reinitialize();
    assert.equal(tracker.sync("history-3"), 1);
    assert.equal(scrollTop, 900);

    tracker.reset();
    scrollTop = 0;
    assert.equal(tracker.sync("history-4"), null);
    assert.equal(scrollTop, 0);
  } finally {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});
