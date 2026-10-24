import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:1420";
const output = process.env.QA_OUTPUT_DIR || ".codex/i18n-qa";
mkdirSync(output, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(12000);
await page.route("**/api.github.com/**/releases/latest", (route) => route.fulfill({ json: {
  tag_name: "v1.1.20", name: "Previous release", body: "Release notes", published_at: "2026-10-24T00:00:00Z", html_url: "https://github.com/GuoWWWX/md-king/releases/tag/v1.1.20", assets: [],
} }));
async function language(value) {
  await page.locator(".mk-activity-bar-footer").getByRole("button", { name: /Language/ }).click();
  await page.getByRole("menuitemradio", { name: value === "en" ? "English" : "简体中文", exact: true }).click();
  await page.waitForFunction((value) => document.documentElement.lang === (value === "en" ? "en" : "zh-CN"), value);
  await page.locator(".mk-activity-bar").getByRole("button", { name: value === "en" ? "Settings" : "设置", exact: true }).waitFor();
}
async function navigate(name) { await page.locator(".mk-activity-bar").getByRole("button", { name, exact: true }).click(); }
try {
  await page.goto(base);
  await page.getByRole("button", { name: "语言 / Language", exact: true }).waitFor();
  await page.evaluate(async () => {
    const { useDocumentTabsStore } = await import("/src/stores/document-tabs-store.ts");
    const { useAppStore } = await import("/src/stores/app-store.ts");
    useDocumentTabsStore.getState().openScratchTab({ title: "设置.md", content: "# 中文标题\n\n正文，设置不应该翻译。\n\n| 字段 | 内容 |\n| --- | --- |\n| 设置 | **保留中文** |\n\n最后一段。" });
    useAppStore.getState().setActivePage("convert");
  });
  await page.waitForFunction(() => window.__mk_editor_view?.state.doc.toString().startsWith("# 中文标题"));
  await page.evaluate(() => {
    const view = window.__mk_editor_view;
    view.dispatch({ changes: { from: view.state.doc.length, insert: "Q" }, selection: { anchor: 8, head: 16 } });
    window.languageTest = { view, content: view.state.doc.toString(), anchor: view.state.selection.main.anchor, head: view.state.selection.main.head };
  });
  await language("en");
  assert.deepEqual(await page.evaluate(() => {
    const { view, content, anchor, head } = window.languageTest, current = window.__mk_editor_view;
    return { sameView: view === current, sameContent: content === current.state.doc.toString(), sameSelection: anchor === current.state.selection.main.anchor && head === current.state.selection.main.head };
  }), { sameView: true, sameContent: true, sameSelection: true });
  assert.equal(await page.locator(".mk-activity-bar").getByRole("button", { name: "Templates", exact: true }).count(), 1);
  const order = await page.locator(".mk-activity-bar-footer button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  assert.deepEqual(order, ["Language / 语言", "Switch theme; current: Light mode", "Settings"]);

  // Existing CodeMirror controls update without rebuilding widgets or undo history.
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+f");
  const find = page.locator(".cm-search input[name=search]");
  await find.waitFor();
  await find.fill("正文");
  await language("zh");
  assert.equal(await find.getAttribute("placeholder"), "查找");
  assert.equal(await find.inputValue(), "正文");
  await language("en");
  assert.equal(await find.getAttribute("placeholder"), "Find");
  assert.equal(await find.inputValue(), "正文");
  await page.locator(".cm-search").getByRole("button", { name: "Close search", exact: true }).click();
  assert.equal(await page.locator(".mk-table-toolbar").getAttribute("aria-label"), "Table actions");
  assert.equal(await page.locator(".mk-cm-table-wrapper button[aria-label='Edit Markdown source']").count(), 1);
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => window.__mk_editor_view.state.doc.toString().endsWith("Q")), false);

  for (const name of ["Templates", "History", "Settings", "About"]) {
    await navigate(name);
    await page.getByRole("heading", { name: name === "About" ? "About md-king" : name, exact: true }).first().waitFor();
  }
  assert.equal(/[\u4e00-\u9fff]/.test(await page.locator(".mk-about-workspace").innerText()), false, "About guide titles, examples, and descriptions must all be English");
  await page.locator(".mk-about-workspace").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: `${output}/about-en-bottom.png` });

  await navigate("Settings");
  const pandocPath = page.getByPlaceholder("Leave empty to use bundled Pandoc");
  await pandocPath.fill("D:/language-test/pandoc.exe");
  await language("zh");
  assert.equal(await page.getByPlaceholder("留空则使用内置 Pandoc").inputValue(), "D:/language-test/pandoc.exe", "switching must preserve unsaved settings");
  await language("en");
  assert.equal(await pandocPath.inputValue(), "D:/language-test/pandoc.exe");
  await page.getByRole("button", { name: "Configure themes", exact: true }).click();
  await page.getByRole("heading", { name: "Mermaid themes", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").getByText("Per-diagram themes", { exact: true }).count(), 1);
  assert.equal(/[\u4e00-\u9fff]/.test(await page.getByRole("dialog").innerText()), false, "built-in Mermaid scheme names and labels must be English too");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

  await navigate("Templates");
  await page.locator(".mk-template-card").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open style manager", exact: true }).click();
  await page.getByRole("button", { name: "Back to templates", exact: true }).waitFor();
  await page.getByText("Style design", { exact: true }).click();
  await page.getByRole("button", { name: "Heading styles", exact: true }).click();
  assert.equal(await page.getByText("Chinese font", { exact: true }).count() > 0, true);
  assert.equal(await page.getByText("Text color", { exact: true }).count() > 0, true);
  await page.getByRole("button", { name: "Back to templates", exact: true }).click();

  // The sidebar update entry works in both its normal and available states.
  await page.evaluate(async () => {
    const { useUpdaterStore } = await import("/src/stores/updater-store.ts");
    useUpdaterStore.setState({ hasUpdate: true, status: "available", latestRelease: { tag_name: "v9.0.0", name: "QA", body: "These authored release notes stay unchanged.", published_at: "2026-10-24T00:00:00Z", html_url: "https://github.com/GuoWWWX/md-king/releases", assets: [] } });
  });
  await page.waitForFunction(() => Boolean(document.querySelector(".mk-activity-bar-footer .animate-ping")));
  const updateButton = page.locator(".mk-activity-bar").getByRole("button", { name: "Software update", exact: true });
  assert.match(await updateButton.getAttribute("class"), /bg-amber-/);
  await page.locator(".mk-activity-bar").getByRole("button", { name: "Software update", exact: true }).click();
  await page.getByRole("heading", { name: "Update available", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").getByRole("region", { name: "Release notes", exact: true }).count(), 1);
  await page.getByRole("dialog").getByRole("button", { name: "Later", exact: true }).click();

  await navigate("About");
  await page.locator(".mk-activity-bar").getByRole("button", { name: "Switch theme; current: Light mode", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.screenshot({ path: `${output}/about-en-dark.png` });
  await page.reload();
  await page.locator(".mk-activity-bar").getByRole("button", { name: "Settings", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en", "language must survive restart");

  // Inject only a failing native save call, without opening any real desktop UI.
  await page.evaluate(() => { window.__TAURI_INTERNALS__ = { invoke: () => Promise.reject(new Error("simulated save failure")) }; });
  await page.locator(".mk-activity-bar-footer").getByRole("button", { name: /Language/ }).click();
  await page.getByRole("menuitemradio", { name: "简体中文", exact: true }).click();
  await page.getByText("Unable to change language", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en", "failed save must roll back the language");
  await page.evaluate(() => { delete window.__TAURI_INTERNALS__; });
  assert.deepEqual(errors, []);
  console.log("PASS: Chinese/English navigation, full About guide, template styles, Mermaid/update dialogs, sidebar order, editor content/selection/undo/widgets, search, unsaved settings, restart persistence, save rollback, and dark mode.");
} finally { await browser.close(); }
