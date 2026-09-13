// Start Vite, then run: node tests/browser/regular-quote-code.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir(".codex/regular-quote-regression", { recursive: true });

async function frame() {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function inspect(sourceMode) {
  return page.evaluate((sourceMode) => {
    const { view } = window.fixture;
    const lines = [...view.dom.querySelectorAll(".cm-line.mk-cm-quote-code-line")]
      .filter((element) => element.matches(".mk-cm-code-line, .mk-cm-code-fence"));
    const failures = [];
    for (const line of lines) {
      const box = line.getBoundingClientRect();
      const card = getComputedStyle(line, "::after");
      const prefix = line.querySelector(".mk-cm-callout-code-prefix");
      if (card.display === "none" || card.left !== "20px" || card.right !== "20px") {
        failures.push("code card inset");
      }
      if (Boolean(prefix) !== sourceMode) failures.push("source prefix visibility");
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim() || node.parentElement.closest(".mk-cm-callout-code-prefix, .mk-cm-copy-code")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && (rect.left < box.left + 31 || rect.right > box.right - 19)) {
            failures.push("code text outside card");
          }
        }
      }
    }
    const outer = view.dom.querySelector(".cm-line.mk-cm-quote-line:not(.mk-cm-quote-code-line)");
    const code = lines[0];
    return {
      count: lines.length,
      failures,
      prefixCount: view.dom.querySelectorAll(".mk-cm-quote-code-line .mk-cm-callout-code-prefix").length,
      source: view.state.doc.toString(),
      outerBackground: outer ? getComputedStyle(outer).backgroundColor : "",
      codeBackground: code ? getComputedStyle(code).backgroundColor : "",
    };
  }, sourceMode);
}

try {
  await page.goto((process.env.TEST_BASE_URL || "http://127.0.0.1:1420") + "/tests/browser/regular-quote-code.html");
  await page.waitForFunction(() => Boolean(window.fixture));
  for (const dark of [true, false]) {
    await page.evaluate((value) => window.fixture.setDark(value), dark);
    await page.locator("#outside").click();
    await frame();
    const rendered = await inspect(false);
    assert.equal(rendered.count, 3);
    assert.deepEqual(rendered.failures, [], `${dark ? "dark" : "light"} rendered`);
    assert.equal(rendered.codeBackground, rendered.outerBackground, "quote background must continue behind the nested card");
    await page.screenshot({ path: `.codex/regular-quote-regression/${dark ? "dark" : "light"}-rendered.png` });

    await page.evaluate(() => {
      const { view, source } = window.fixture;
      view.dispatch({ selection: { anchor: source.indexOf("thread -n 3") } });
      view.focus();
    });
    await frame();
    const editing = await inspect(true);
    assert.deepEqual(editing.failures, [], `${dark ? "dark" : "light"} editing`);
    assert.equal(editing.prefixCount, 3, "every quoted code line keeps an editable quote prefix");
    assert.equal(editing.source, rendered.source);

    await page.evaluate(() => window.fixture.setReadOnly(true));
    await page.locator("#outside").click();
    await frame();
    assert.deepEqual((await inspect(false)).failures, [], "reading mode");
    await page.evaluate(() => window.fixture.setReadOnly(false));
  }
  assert.deepEqual(errors, []);
  console.log("PASS: regular blockquote code uses the same nested card geometry in light/dark and remains editable.");
} finally {
  await browser.close();
}
