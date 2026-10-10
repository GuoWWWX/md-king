import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
try {
  await page.goto("http://127.0.0.1:1420/tests/browser/file-tree-clipboard.html");
  const row = (path) => page.locator(`[role="treeitem"][data-mk-vault-path="${path}"]`);
  const source = row("README.md");
  await source.click({ button: "right" });
  await page.getByRole("menuitem", { name: "复制", exact: true }).click();
  await page.waitForFunction(() => window.fixture.store.getState().clipboardEntry?.operation === "copy");
  await row("草稿").click({ button: "right" });
  await page.getByRole("menuitem", { name: "粘贴", exact: true }).click();
  await page.waitForFunction(() => window.fixture.store.getState().entries.some(e => e.path === "草稿/README.md"));
  await row("README.md").click();
  await page.keyboard.press("Control+x");
  await page.waitForFunction(() => window.fixture.store.getState().clipboardEntry?.operation === "cut");
  await row("笔记").click();
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.fixture.store.getState().entries.some(e => e.path === "笔记/README.md") && !window.fixture.store.getState().entries.some(e => e.path === "README.md"));
  assert.equal(await page.evaluate(() => window.fixture.store.getState().clipboardEntry), undefined);
  await row("草稿/未命名草稿.md").click();
  await page.keyboard.press("Control+c");
  await page.waitForFunction(() => window.fixture.store.getState().clipboardEntry?.operation === "copy");
  await row("草稿").click();
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.fixture.store.getState().entries.some(e => e.path === "草稿/未命名草稿 (1).md"));
  console.log("PASS: file tree context menus, Ctrl+C/X/V, same-folder copy, and cut state cleanup");
} catch (error) {
  console.log(await page.evaluate(() => ({
    paths: window.fixture?.store.getState().entries.map(e => e.path),
    clipboard: window.fixture?.store.getState().clipboardEntry,
    active: document.activeElement?.getAttribute("data-mk-vault-path"),
    selected: [...document.querySelectorAll('[aria-selected="true"]')].map(e => e.getAttribute("data-mk-vault-path")),
  })));
  throw error;
} finally {
  await browser.close();
}
