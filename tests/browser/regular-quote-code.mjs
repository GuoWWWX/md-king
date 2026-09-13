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
    let codeTextLeft;
    let cardWidth;
    const indent = view.state.doc.toString().includes('data-md-king-indent-pt="48"') ? 64 : 0;
    for (const line of lines) {
      const box = line.getBoundingClientRect();
      const card = getComputedStyle(line, "::after");
      const currentCardWidth = box.width - Number.parseFloat(card.left) - Number.parseFloat(card.right);
      if (cardWidth === undefined) cardWidth = currentCardWidth;
      if (Math.abs(currentCardWidth - cardWidth) > 1) failures.push("code card width differs between rows");
      const prefix = line.querySelector(".mk-cm-quote-code-prefix");
      if (card.display === "none" || parseFloat(card.left) !== 32 + indent || card.right !== "32px") {
        failures.push("code card inset");
      }
      if (Boolean(prefix) !== sourceMode) failures.push("source prefix visibility");
      if (prefix) {
        if (Math.abs(prefix.getBoundingClientRect().left - box.left - 14) > 1) failures.push("prefix alignment");
        const prefixWidth = prefix.getBoundingClientRect().width;
        if (prefixWidth < 4 || prefixWidth > 16) failures.push("prefix width");
        const glyph = document.createRange();
        glyph.setStart(prefix.firstChild, 0);
        glyph.setEnd(prefix.firstChild, 1);
        if (glyph.getBoundingClientRect().right > box.left + 28) failures.push("arrow overlaps card");
      }
      const outerLine = view.dom.querySelector('.cm-line.mk-cm-quote-line:not(.mk-cm-quote-code-line)');
      if (Math.abs(box.left - outerLine.getBoundingClientRect().left) > 1) {
        failures.push("quote border moved with code indent");
      }
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim() || node.parentElement.closest(".mk-cm-callout-code-prefix, .mk-cm-quote-code-prefix, .mk-cm-copy-code")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (node.textContent.includes('thread')) codeTextLeft = range.getBoundingClientRect().left - box.left;
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && (rect.left < box.left + 43 + indent || rect.right > box.right - 43)) {
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
      codeTextLeft,
      cardWidth,
      prefixCount: view.dom.querySelectorAll(".mk-cm-quote-code-line .mk-cm-quote-code-prefix").length,
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
    for (const indented of [false, true]) {
    await page.evaluate((indented) => {
      const { view } = window.fixture;
      const plain = window.fixture.source.replace(' {data-md-king-indent-pt="48"}', '');
      window.fixture.source = indented ? plain.replace('```bash', '```bash {data-md-king-indent-pt="48"}') : plain;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: window.fixture.source } });
    }, indented);
    await page.evaluate((value) => window.fixture.setDark(value), dark);
    await page.locator("#outside").click();
    await frame();
    const rendered = await inspect(false);
    assert.equal(rendered.count, 3);
    assert.deepEqual(rendered.failures, [], `${dark ? "dark" : "light"} rendered`);
    assert.equal(rendered.codeBackground, rendered.outerBackground, "quote background must continue behind the nested card");
    await page.screenshot({ path: `.codex/regular-quote-regression/${dark ? "dark" : "light"}-${indented ? "indented" : "plain"}-rendered.png` });

    await page.evaluate(() => {
      const { view, source } = window.fixture;
      view.dispatch({ selection: { anchor: source.indexOf("thread -n 3") } });
      view.focus();
    });
    await page.waitForFunction(() => window.fixture.view.dom.querySelectorAll('.mk-cm-quote-code-prefix').length === 3);
    await frame();
    const editing = await inspect(true);
    assert.deepEqual(editing.failures, [], `${dark ? "dark" : "light"} editing`);
    assert.equal(editing.prefixCount, 3, "every quoted code line keeps an editable quote prefix");
    assert.equal(editing.source, rendered.source);
    assert.equal(editing.codeTextLeft, rendered.codeTextLeft, 'source arrow must not shift the code');

    // 拖选代码内容时，源码前缀会在选区更新的同一轮从隐藏态变为可见态。
    // 选区重排后仍要保持和普通源码态相同的箭头位置与卡片几何，不能把首行
    // 的 `>` 推进选区，也不能让代码卡片按选中文本收窄。
    await page.evaluate(() => {
      const { view, source } = window.fixture;
      const from = source.indexOf("thread -n 3");
      view.dispatch({ selection: { anchor: from, head: from + "thread -n 3".length } });
      view.focus();
    });
    await frame();
    const selecting = await inspect(true);
    assert.deepEqual(selecting.failures, [], `${dark ? "dark" : "light"} selecting code`);
    assert.equal(selecting.codeTextLeft, rendered.codeTextLeft, 'selecting code must not move the source arrow or card');
    assert.ok(Math.abs(selecting.cardWidth - rendered.cardWidth) <= 1, 'selecting code must not shrink the card');
    assert.equal(selecting.prefixCount, 3, 'selected quoted code keeps every editable quote prefix');

    const quoteClick = await page.evaluate(() => {
      const { view } = window.fixture;
      const prefix = view.dom.querySelector('.mk-cm-quote-code-prefix');
      const line = prefix.closest('.cm-line');
      const lineFrom = view.posAtDOM(line, 0);
      const rect = prefix.getBoundingClientRect();
      return { x: rect.left + 3, y: rect.top + rect.height / 2, expected: lineFrom + 1, expectedX: rect.right };
    });
    await page.mouse.click(quoteClick.x, quoteClick.y);
    assert.equal(await page.evaluate(() => window.fixture.view.state.selection.main.head), quoteClick.expected, 'quote arrow click maps to the right of >');
    assert.ok(Math.abs((await page.evaluate(() => window.fixture.view.coordsAtPos(window.fixture.view.state.selection.main.head).left)) - quoteClick.expectedX) <= 1, 'caret is visibly beside >');
    const gutterClick = await page.evaluate(() => {
      const { view } = window.fixture;
      const prefix = view.dom.querySelector('.mk-cm-quote-code-prefix');
      const line = prefix.closest('.cm-line');
      const lineBox = line.getBoundingClientRect();
      const prefixBox = prefix.getBoundingClientRect();
      const cardLeft = Number.parseFloat(getComputedStyle(line, '::after').left);
      return {
        // 点在 `>` 右侧的引用沟槽，而不是代码卡片正文。
        x: prefixBox.left + 12,
        y: lineBox.top + lineBox.height / 2,
        expected: view.posAtDOM(line, 0) + 1,
        cardX: lineBox.left + cardLeft + 16,
      };
    });
    await page.mouse.click(gutterClick.x, gutterClick.y);
    assert.equal(await page.evaluate(() => window.fixture.view.state.selection.main.head), gutterClick.expected, 'gutter click maps to the right of >');
    await page.mouse.click(gutterClick.cardX, gutterClick.y);
    assert.ok(await page.evaluate(() => window.fixture.view.state.selection.main.head) > gutterClick.expected, 'code card click remains in code');
    await page.screenshot({ path: `.codex/regular-quote-regression/${dark ? "dark" : "light"}-${indented ? "indented" : "plain"}-editing.png` });

    await page.evaluate(() => window.fixture.setReadOnly(true));
    await page.locator("#outside").click();
    await frame();
    assert.deepEqual((await inspect(false)).failures, [], "reading mode");
    await page.evaluate(() => window.fixture.setReadOnly(false));
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS: regular blockquote code uses the same nested card geometry in light/dark and remains editable.");
} finally {
  await browser.close();
}
