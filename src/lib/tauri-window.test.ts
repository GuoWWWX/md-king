import assert from "node:assert/strict";
import test from "node:test";
import { handleTauriWindowDrag, handleTauriWindowDoubleClick, triggerTauriWindowToggleMaximize } from "./tauri.ts";

test("Tauri 窗口拖拽与双击最大化行为测试", () => {
  let startDraggingCalled = 0;
  let toggleMaximizeCalled = 0;

  const mockWindow = {
    startDragging: async () => {
      startDraggingCalled += 1;
    },
    toggleMaximize: async () => {
      toggleMaximizeCalled += 1;
    },
  };
  const getMockWindow = () => mockWindow;

  (globalThis as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    window: mockWindow,
  };
  (globalThis as unknown as { window?: unknown }).window = globalThis;

  try {
    // 1. 点击按钮等交互控件时，不触发拖拽也不触发最大化
    const buttonTarget = {
      closest: (sel: string) => (sel.includes("button") ? {} : null),
    };
    handleTauriWindowDrag({
      button: 0,
      detail: 1,
      target: buttonTarget as unknown as EventTarget,
    } as unknown as React.MouseEvent<HTMLElement>, getMockWindow);
    assert.equal(startDraggingCalled, 0);
    assert.equal(toggleMaximizeCalled, 0);

    // 2. 空白区域单次按下（detail === 1）：触发 startDragging
    const blankTarget = {
      closest: () => null,
    };
    handleTauriWindowDrag({
      button: 0,
      detail: 1,
      target: blankTarget as unknown as EventTarget,
    } as unknown as React.MouseEvent<HTMLElement>, getMockWindow);
    assert.equal(startDraggingCalled, 1);
    assert.equal(toggleMaximizeCalled, 0);

    // 3. 空白区域双击第 2 次按下（detail === 2）：立即触发 toggleMaximize
    handleTauriWindowDrag({
      button: 0,
      detail: 2,
      target: blankTarget as unknown as EventTarget,
    } as unknown as React.MouseEvent<HTMLElement>, getMockWindow);
    assert.equal(startDraggingCalled, 1);
    assert.equal(toggleMaximizeCalled, 1);

    // 4. 双击事件（handleTauriWindowDoubleClick）在节流时间内不会重复触发
    handleTauriWindowDoubleClick({
      button: 0,
      target: blankTarget as unknown as EventTarget,
    } as unknown as React.MouseEvent<HTMLElement>, getMockWindow);
    assert.equal(toggleMaximizeCalled, 1); // 450ms 内节流保护，防止两次 toggle 把窗口打回原形

    // 5. triggerTauriWindowToggleMaximize 也遵循节流保护
    triggerTauriWindowToggleMaximize(getMockWindow);
    assert.equal(toggleMaximizeCalled, 1);

  } finally {
    delete (globalThis as unknown as { __TAURI__?: unknown }).__TAURI__;
  }
});

