import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:1420");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const appearance = page.locator("section").filter({ has: page.getByRole("heading", { name: "外观", exact: true }) });
  assert.equal(await appearance.getByRole("button", { name: "配置主题", exact: true }).count(), 1);
  await page.getByRole("button", { name: "配置主题", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const selected = (label) => dialog.getByRole("combobox", { name: label, exact: true }).getAttribute("data-value");
  const choose = async (label, value) => {
    await dialog.getByRole("combobox", { name: label, exact: true }).click();
    await page.locator(`[role="option"][data-value="${value}"]`).click();
  };
  const options = async (label) => {
    await dialog.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("listbox").evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))));
    return page.getByRole("listbox").getByRole("option").evaluateAll((items) => items.map((item) => item.dataset.value));
  };
  const ready = () => page.waitForFunction(() => {
    const images = [...document.querySelectorAll('[role="dialog"] img')];
    return images.length === 2 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
  await ready();
  await mkdir(".codex/mermaid-theme-qa", { recursive: true });
  const lightOptions = ["redux-color", "redux", "neo", "default", "forest", "neutral", "base"];
  const darkOptions = ["redux-dark-color", "redux-dark", "neo-dark", "dark"];
  assert.deepEqual(await options("浅色默认主题"), lightOptions);
  const lightSelection = await page.locator('[role="option"][data-state="checked"]').evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
  assert.deepEqual(lightSelection, { background: "rgb(241, 242, 244)", color: "rgb(15, 23, 42)" });
  await page.screenshot({ path: ".codex/mermaid-theme-qa/light-dropdown.png" });
  await page.keyboard.press("Escape");
  assert.deepEqual(await options("深色默认主题"), darkOptions);
  await page.keyboard.press("Escape");
  assert.deepEqual(await options("状态图浅色主题"), ["inherit", ...lightOptions]);
  await page.keyboard.press("Escape");
  assert.deepEqual(await options("状态图深色主题"), ["inherit", ...darkOptions]);
  await page.keyboard.press("Escape");
  await choose("整体选择主题", "forest");
  await ready();
  assert.equal(await selected("浅色默认主题"), "forest");
  assert.equal(await selected("深色默认主题"), "dark");
  await choose("状态图浅色主题", "neo");
  await ready();
  assert.equal(await selected("预览图表类型"), "state");
  await dialog.getByRole("button", { name: "原生多色", exact: true }).click();
  assert.equal(await selected("状态图浅色主题"), "neo");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "配置主题", exact: true }).click();
  assert.equal(await selected("状态图浅色主题"), "inherit");
  await choose("浅色默认主题", "forest");
  await choose("深色默认主题", "neo-dark");
  await choose("状态图浅色主题", "neutral");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "配置主题", exact: true }).click();
  assert.equal(await selected("浅色默认主题"), "forest");
  assert.equal(await selected("深色默认主题"), "neo-dark");
  assert.equal(await selected("状态图浅色主题"), "neutral");
  await ready();
  await mkdir(".codex/mermaid-theme-qa", { recursive: true });
  await page.screenshot({ path: ".codex/mermaid-theme-qa/light.png" });
  await page.evaluate(async () => (await import("/src/lib/appearance.ts")).applyAppearance("dark", "blue"));
  await page.screenshot({ path: ".codex/mermaid-theme-qa/dark.png" });
  assert.deepEqual(await options("状态图深色主题"), ["inherit", ...darkOptions]);
  const popupStyle = await page.getByRole("listbox").evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, opacity: getComputedStyle(element).opacity }));
  assert.equal(popupStyle.opacity, "1");
  assert.equal(popupStyle.background, "rgb(24, 24, 27)");
  const darkSelection = await page.locator('[role="option"][data-state="checked"]').evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
  assert.deepEqual(darkSelection, { background: "rgb(58, 58, 58)", color: "rgb(228, 228, 231)" });
  const trigger = await page.locator('[role="combobox"][aria-label="状态图深色主题"]').boundingBox();
  const dropdown = await page.getByRole("listbox").boundingBox();
  assert.ok(trigger && dropdown && Math.abs(trigger.width - dropdown.width) <= 1);
  const rowBackground = await page.locator('[role="combobox"][aria-label="状态图深色主题"]').evaluate((element) => getComputedStyle(element.closest("tr")).backgroundColor);
  assert.equal(rowBackground, "rgba(0, 0, 0, 0)");
  await page.screenshot({ path: ".codex/mermaid-theme-qa/dark-dropdown.png" });
  await page.keyboard.press("Escape");
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight, overflow: element.scrollWidth - element.clientWidth };
    });
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.top >= 0 && geometry.bottom <= geometry.height, JSON.stringify(geometry));
    assert.ok(geometry.overflow <= 1, JSON.stringify(geometry));
    await page.screenshot({ path: `.codex/mermaid-theme-qa/width-${width}.png` });
    assert.deepEqual(await options("状态图深色主题"), ["inherit", ...darkOptions]);
    const popup = await page.getByRole("listbox").boundingBox();
    const field = await page.locator('[role="combobox"][aria-label="状态图深色主题"]').boundingBox();
    assert.ok(popup && field && Math.abs(popup.width - field.width) <= 1);
    assert.ok(popup && popup.x >= 0 && popup.x + popup.width <= width && popup.y >= 0 && popup.y + popup.height <= 900);
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.getByRole("button", { name: "清除单独设置", exact: true }).click();
  assert.equal(await selected("状态图浅色主题"), "inherit");
  await dialog.getByRole("button", { name: "恢复默认", exact: true }).click();
  assert.equal(await selected("浅色默认主题"), "redux-color");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const renderResults = await page.evaluate(async () => {
    const { renderMermaid, setMermaidThemes, getCachedMermaidSvg, mermaidToPngDataUrl } = await import("/src/lib/mermaid.ts");
    const { normalizeMermaidThemes, mermaidDiagramType, MERMAID_THEMES } = await import("/src/lib/mermaid-config.js");
    const { mermaidThemeSamples } = await import("/src/components/settings/mermaid-theme-samples.ts");
    const failures = [];
    let count = 0;
    for (const [type, source] of Object.entries(mermaidThemeSamples)) {
      if (mermaidDiagramType(source) !== type) failures.push(`${type}: header mismatch`);
      for (const dark of [false, true]) {
        try { const rendered = await renderMermaid(source, dark, normalizeMermaidThemes()); if (!rendered.svg.includes("<svg")) throw new Error("missing SVG"); count++; }
        catch (error) { failures.push(`${type}/${dark}: ${error.message}`); }
      }
    }
    const source = mermaidThemeSamples.flowchart;
    for (const { id } of MERMAID_THEMES) {
      for (const dark of [false, true]) {
        try { await renderMermaid(source, dark, normalizeMermaidThemes({ light: id, dark: id })); count++; }
        catch (error) { failures.push(`${id}/${dark}: ${error.message}`); }
      }
    }
    setMermaidThemes(normalizeMermaidThemes({ light: "forest" }));
    const forest = await renderMermaid(source, false);
    const forestPng = await mermaidToPngDataUrl(source, false);
    setMermaidThemes(normalizeMermaidThemes());
    const redux = await renderMermaid(source, false);
    const reduxPng = await mermaidToPngDataUrl(source, false);
    if (forest.svg === redux.svg || forestPng === reduxPng) failures.push("SVG/PNG cache did not change with theme");
    setMermaidThemes(normalizeMermaidThemes({ light: "forest" }));
    if (getCachedMermaidSvg(source, false)?.svg !== forest.svg) failures.push("previous theme cache not reusable");
    const explicit = await renderMermaid('---\nconfig:\n  theme: forest\n---\nflowchart LR\n A[custom] --> B[result]\n style A fill:#ff9900', false);
    if (!explicit.svg.includes("#ff9900") && !explicit.svg.includes("rgb(255, 153, 0)")) failures.push("source-level custom fill lost");
    setMermaidThemes();
    return { count, failures };
  });
  assert.deepEqual(renderResults.failures, []);
  // Existing editor widgets and Word previews must refresh without reopening the document.
  await page.goto((process.env.TEST_BASE_URL || "http://127.0.0.1:1420") + "/tests/browser/editor-cursor.html");
  await page.waitForFunction(() => window.fixture?.view);
  await page.evaluate(async () => {
    const { useAppStore } = await import("/src/stores/app-store.ts");
    const { getAppConfig } = await import("/src/lib/tauri.ts");
    const { normalizeMermaidThemes } = await import("/src/lib/mermaid-config.js");
    window.themeConfig = await getAppConfig();
    useAppStore.getState().setAppConfig({ ...window.themeConfig, mermaidThemes: normalizeMermaidThemes() });
    window.fixture.configure({ isDark: false });
    const view = window.fixture.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "正文\n\n```mermaid\nflowchart TB\n A[接收请求] --> B[处理任务]\n```\n\n结束" }, selection: { anchor: 0 } });
  });
  await page.getByRole("button", { name: "移开焦点" }).click();
  const editorSvg = page.locator(".mk-cm-mermaid-canvas svg").first();
  await editorSvg.waitFor();
  const originalEditor = await editorSvg.evaluate((svg) => svg.outerHTML);
  await page.evaluate(async () => {
    const { useAppStore } = await import("/src/stores/app-store.ts");
    const { normalizeMermaidThemes } = await import("/src/lib/mermaid-config.js");
    useAppStore.getState().setAppConfig({ ...window.themeConfig, mermaidThemes: normalizeMermaidThemes({ light: "forest" }) });
  });
  await page.waitForFunction((previous) => document.querySelector(".mk-cm-mermaid-canvas svg")?.outerHTML !== previous, originalEditor);
  assert.notEqual(await editorSvg.evaluate((svg) => svg.outerHTML), originalEditor);

  for (const paperTheme of ["light", "dark"]) {
    await page.goto((process.env.TEST_BASE_URL || "http://127.0.0.1:1420") + `/tests/browser/word-preview-mermaid.html?theme=${paperTheme}&scenario=fit`);
    const wordImage = page.getByAltText("Mermaid 图表").first();
    await wordImage.waitFor();
    await page.waitForFunction(() => document.querySelector('img[alt="Mermaid 图表"]')?.naturalWidth > 0);
    let previousWord = await wordImage.getAttribute("src");
    for (const settings of [
      { light: "forest", dark: "redux-dark" },
      { light: "forest", dark: "redux-dark", diagrams: { flowchart: { light: "neo", dark: "neo-dark" } } },
    ]) {
      const expected = await page.evaluate(async (settings) => {
        const { useAppStore } = await import("/src/stores/app-store.ts");
        const { getAppConfig } = await import("/src/lib/tauri.ts");
        const { normalizeMermaidThemes } = await import("/src/lib/mermaid-config.js");
        const { renderMermaid } = await import("/src/lib/mermaid.ts");
        const { svgDataUrl } = await import("/src/lib/svg-image.ts");
        useAppStore.getState().setAppConfig({ ...await getAppConfig(), mermaidThemes: normalizeMermaidThemes(settings) });
        const source = window.fixture.markdown.match(/```mermaid\n([\s\S]*?)```/)[1];
        return svgDataUrl((await renderMermaid(source, false)).svg);
      }, settings);
      await page.waitForFunction((previous) => document.querySelector('img[alt="Mermaid 图表"]')?.getAttribute("src") !== previous, previousWord);
      const normalizeSvg = (url) => decodeURIComponent(url.split(",")[1]).replace(/mk-mermaid-\d+/g, "mermaid");
      assert.ok(normalizeSvg(await wordImage.getAttribute("src")) === normalizeSvg(expected), `${paperTheme} paper must use the configured light theme`);
      const background = await wordImage.evaluate((image) => getComputedStyle(image.parentElement.parentElement).backgroundColor);
      if (paperTheme === "dark") assert.equal(background, "rgb(255, 255, 255)", "Word diagrams need a light canvas on dark paper");
      previousWord = await wordImage.getAttribute("src");
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ui: "passed", ...renderResults }));
} finally { await browser.close(); }
