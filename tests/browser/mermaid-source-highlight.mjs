import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const source = 'flowchart LR\n  %% 说明：按条件处理\n  Start[开始] --> Choice{校验通过？}\n  Choice -->|是| Done["保存结果"]\n  classDef success fill:#d1fae5,stroke:#059669,stroke-width:2px;\n  class Done success;';
const markdown = `前置正文\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n结束`;
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto((process.env.TEST_BASE_URL || "http://127.0.0.1:1420") + "/tests/browser/editor-cursor.html");
  await page.waitForFunction(() => window.fixture?.view);
  await page.evaluate(markdown => {
    const view = window.fixture.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown }, selection: { anchor: 0 } });
  }, markdown);
  await page.getByRole("button", { name: "移开焦点" }).click();
  await page.locator(".mk-cm-mermaid-canvas svg").waitFor();
  await page.getByRole("button", { name: "编辑 Mermaid 源码", exact: true }).click();
  for (const dark of [true, false]) {
    await page.evaluate(dark => window.fixture.configure({ isDark: dark }), dark);
    await page.waitForFunction(() => [...document.querySelectorAll(".cm-line span")].some(span => span.textContent === "flowchart"));
    const colors = await page.evaluate(() => {
      const spans = [...document.querySelectorAll(".cm-line span")];
      const colorOf = text => {
        const span = spans.find(span => span.textContent === text);
        return span && getComputedStyle(span).color;
      };
      return { keyword: colorOf("flowchart"), label: colorOf("[开始]"), edge: colorOf("-->"), comment: colorOf("%% 说明：按条件处理") };
    });
    assert.ok(Object.values(colors).every(Boolean), `Missing Mermaid syntax highlighting: ${JSON.stringify(colors)}`);
    assert.equal(new Set(Object.values(colors)).size, 4, `Mermaid syntax needs distinct colors: ${JSON.stringify(colors)}`);
    await mkdir(".codex/mermaid-theme-qa", { recursive: true });
    await page.screenshot({ path: `.codex/mermaid-theme-qa/source-${dark ? "dark" : "light"}.png` });
    assert.equal(await page.evaluate(() => window.fixture.view.state.doc.toString()), markdown);
  }
  // Edit highlighted source, then leave the block and render it again.
  const updated = markdown.replace("[开始]", "[准备开始]");
  await page.evaluate(updated => {
    const view = window.fixture.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: updated }, selection: { anchor: updated.indexOf("准备开始") } });
  }, updated);
  await page.getByRole("button", { name: "移开焦点" }).click();
  await page.locator(".mk-cm-mermaid-canvas svg").waitFor();
  assert.ok((await page.locator(".mk-cm-mermaid-canvas svg").textContent()).includes("准备开始"));
  assert.deepEqual(errors, []);
  console.log("PASS: Mermaid source has distinct keyword/label/edge/comment colors in light/dark modes; editing and preview round-trip preserves source.");
} finally { await browser.close(); }
