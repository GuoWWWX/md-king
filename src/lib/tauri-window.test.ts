import assert from "node:assert/strict";
import test from "node:test";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { handleTauriWindowDrag, handleTauriWindowDoubleClick } from "./tauri.ts";

test("窗口标题栏的双击与拖动不会相互触发", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const host = new EventTarget();
  Object.assign(host, { __TAURI__: {} });
  Object.defineProperty(globalThis, "window", { configurable: true, value: host });
  let now = 10000;
  t.mock.method(Date, "now", () => now);
  const calls: string[] = [];
  const getWindow = () => ({
    startDragging: async () => { calls.push("drag"); },
    toggleMaximize: async () => { calls.push("toggle"); },
  });
  const blank = { closest: () => null };
  const down = (overrides = {}) => ({
    button: 0, buttons: 1, detail: 0, clientX: 100, clientY: 20, pointerId: 1,
    target: blank, nativeEvent: new Event("pointerdown"), ...overrides,
  }) as unknown as ReactPointerEvent<HTMLElement>;
  const emit = (type: string, properties = {}) => {
    host.dispatchEvent(Object.assign(new Event(type), {
      clientX: 120, clientY: 20, buttons: 1, pointerId: 1, ...properties,
    }));
  };
  const doubleClick = () => handleTauriWindowDoubleClick(down() as unknown as ReactMouseEvent<HTMLElement>, getWindow);

  try {
    await t.test("两次点击只在浏览器确认双击后切换一次，之后移动不拖窗", () => {
      handleTauriWindowDrag(down(), getWindow);
      emit("pointerup", { buttons: 0 });
      now += 100;
      const second = down();
      handleTauriWindowDrag(second, getWindow);
      handleTauriWindowDrag({ ...second }, getWindow);
      assert.deepEqual(calls, []);
      emit("pointerup", { buttons: 0 });
      doubleClick();
      doubleClick();
      emit("pointermove", { buttons: 0 });
      assert.deepEqual(calls, ["toggle"]);
    });

    await t.test("超过旧的 450ms 阈值仍遵循浏览器的系统双击判定", () => {
      calls.length = 0;
      now += 1000;
      handleTauriWindowDrag(down(), getWindow);
      emit("pointerup", { buttons: 0 });
      now += 600;
      handleTauriWindowDrag(down(), getWindow);
      emit("pointerup", { buttons: 0 });
      doubleClick();
      assert.deepEqual(calls, ["toggle"]);
    });

    await t.test("同一次 pointerdown 重复冒泡不能在延迟后误判为双击", () => {
      calls.length = 0;
      now += 1000;
      const event = down();
      handleTauriWindowDrag(event, getWindow);
      now += 80;
      handleTauriWindowDrag({ ...event }, getWindow);
      assert.deepEqual(calls, []);
      emit("pointermove");
      emit("mousemove");
      assert.deepEqual(calls, ["drag"]);
    });

    await t.test("即使没收到松开事件，未按左键的移动也不能启动拖动", () => {
      calls.length = 0;
      now += 1000;
      handleTauriWindowDrag(down(), getWindow);
      emit("pointermove", { buttons: 0 });
      emit("pointermove");
      assert.deepEqual(calls, []);
    });

    await t.test("左键按住且移动超过阈值才启动一次拖动", () => {
      calls.length = 0;
      now += 1000;
      handleTauriWindowDrag(down(), getWindow);
      emit("pointermove", { clientX: 102 });
      assert.deepEqual(calls, []);
      emit("pointermove");
      emit("pointermove");
      assert.deepEqual(calls, ["drag"]);
    });

    await t.test("释放、取消、失焦和双击都会清理待启动的拖动", () => {
      for (const type of ["pointerup", "mouseup", "pointercancel", "blur", "dblclick"]) {
        calls.length = 0;
        now += 1000;
        handleTauriWindowDrag(down(), getWindow);
        if (type === "dblclick") doubleClick();
        else emit(type);
        emit("pointermove");
        assert.deepEqual(calls, type === "dblclick" ? ["toggle"] : [], type);
      }
    });

    await t.test("按钮等交互控件与非左键不拖窗、不切换窗口", () => {
      calls.length = 0;
      now += 1000;
      for (const event of [down({ target: { closest: () => ({}) } }), down({ button: 2 })]) {
        handleTauriWindowDrag(event, getWindow);
        handleTauriWindowDoubleClick(event as unknown as ReactMouseEvent<HTMLElement>, getWindow);
      }
      emit("pointermove");
      assert.deepEqual(calls, []);
    });
  } finally {
    emit("blur");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
