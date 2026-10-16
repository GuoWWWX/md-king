import assert from "node:assert/strict";
import test from "node:test";
import { readClipboardText } from "./tauri.ts";

async function withClipboardRuntime(windowValue: unknown, readText: () => Promise<string>, run: () => Promise<void>) {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowValue });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { readText } } });
  try {
    await run();
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
}

test("桌面粘贴在浏览器禁止读取时仍通过系统剪贴板保留中文 Emoji 和空白", async () => {
  const text = "# 标题 👌\r\n\r\n  正文 👍🏽\t\r\n";
  await withClipboardRuntime({ __TAURI_INTERNALS__: { invoke: async (command: string) => {
    assert.equal(command, "read_clipboard_text");
    return text;
  } } }, async () => { throw new Error("Browser clipboard must not be used"); }, async () => {
    assert.equal(await readClipboardText(), text);
  });
});

test("浏览器预览仍通过浏览器剪贴板读取文本", async () => {
  await withClipboardRuntime({}, async () => "预览 👌", async () => {
    assert.equal(await readClipboardText(), "预览 👌");
  });
});

test("系统剪贴板失败时保留错误且不触发浏览器权限请求", async () => {
  await withClipboardRuntime({ __TAURI_INTERNALS__: { invoke: async () => {
    throw new Error("系统剪贴板暂时被占用");
  } } }, async () => { assert.fail("Must not fall back to browser permissions"); }, async () => {
    await assert.rejects(readClipboardText(), /系统剪贴板暂时被占用/);
  });
});
