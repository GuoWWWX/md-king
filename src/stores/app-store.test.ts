import assert from "node:assert/strict";
import test from "node:test";
import { useAppStore } from "./app-store.ts";

function resetPageTabs() {
  useAppStore.setState({ activePage: "convert", pageTabs: [] });
}

test("打开页面会追加工作区标签，关闭当前页会切到相邻页面", () => {
  resetPageTabs();
  try {
    const store = useAppStore.getState();
    store.setActivePage("templates");
    store.setActivePage("settings");

    assert.deepEqual(useAppStore.getState().pageTabs, ["templates", "settings"]);
    assert.equal(useAppStore.getState().activePage, "settings");

    useAppStore.getState().closePageTab("settings");
    assert.deepEqual(useAppStore.getState().pageTabs, ["templates"]);
    assert.equal(useAppStore.getState().activePage, "templates");
  } finally {
    resetPageTabs();
  }
});

test("批量关闭工作区标签会保留指定页面或回到文档工作区", () => {
  resetPageTabs();
  try {
    const store = useAppStore.getState();
    store.setActivePage("templates");
    store.setActivePage("history");
    store.setActivePage("settings");

    store.closeOtherPageTabs("history");
    assert.deepEqual(useAppStore.getState().pageTabs, ["history"]);
    assert.equal(useAppStore.getState().activePage, "history");

    useAppStore.getState().closeAllPageTabs();
    assert.deepEqual(useAppStore.getState().pageTabs, []);
    assert.equal(useAppStore.getState().activePage, "convert");
  } finally {
    resetPageTabs();
  }
});
