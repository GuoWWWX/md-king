// Start Vite, then run: node tests/browser/callout-code.mjs
// PLAYWRIGHT_MODULE can point to a shared Playwright installation; no user files are edited.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await mkdir('.codex/callout-regression', { recursive: true });

async function frame() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function inspect(sourceMode) {
  return page.evaluate((sourceMode) => {
    const { view } = window.fixture;
    const lines = [...view.dom.querySelectorAll('.cm-line.mk-cm-callout-line')]
      .filter(el => el.matches('.mk-cm-code-line, .mk-cm-code-fence'));
    const failures = [];
    const positions = [];
    let codeTextLeft;
    for (const line of lines) {
      const box = line.getBoundingClientRect();
      const prefix = line.querySelector('.mk-cm-callout-code-prefix');
      const bg = getComputedStyle(line, '::after');
      if (bg.display === 'none' || bg.left !== '32px' || bg.right !== '32px') failures.push('code card inset');
      if (Boolean(prefix) !== sourceMode) failures.push('source prefix visibility');
      if (prefix) {
        const p = prefix.getBoundingClientRect();
        if (Math.abs(p.left - box.left - 14) > 1) failures.push('prefix gutter position');
        const glyph = document.createRange();
        glyph.setStart(prefix.firstChild, 0);
        glyph.setEnd(prefix.firstChild, 1);
        if (glyph.getBoundingClientRect().right > box.left + 28) failures.push('arrow overlaps card');
        const reference = view.dom.querySelector('.mk-cm-callout-first');
        if (Math.abs(parseFloat(getComputedStyle(prefix).fontSize) - parseFloat(getComputedStyle(reference).fontSize)) > 0.1) failures.push('prefix font size');
      }
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim() || node.parentElement.closest('.mk-cm-callout-code-prefix, .mk-cm-copy-code')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (node.textContent.includes('doBusiness')) codeTextLeft = range.getBoundingClientRect().left - box.left;
        for (const rect of range.getClientRects()) {
          if (rect.width === 0) continue;
          if (rect.left < box.left + 43 || rect.right > box.right - 43) failures.push('code text outside card');
          positions.push(rect.left - box.left);
        }
      }
    }
    if (view.dom.querySelectorAll('.mk-cm-callout-code-prefix').length !== (sourceMode ? 8 : 0)) failures.push('prefix count');
    return { failures, positions, codeTextLeft, count: lines.length, source: view.state.doc.toString() };
  }, sourceMode);
}

try {
  await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:1420') + '/tests/browser/callout-code.html');
  await page.waitForFunction(() => Boolean(window.fixture));
  for (const dark of [true, false]) {
    await page.evaluate(dark => window.fixture.setDark(dark), dark);
    await page.locator('#outside').click();
    await frame();
    const rendered = await inspect(false);
    assert.equal(rendered.count, 8);
    assert.deepEqual(rendered.failures, [], `${dark ? 'dark' : 'light'} rendered`);
    await page.screenshot({ path: `.codex/callout-regression/${dark ? 'dark' : 'light'}-rendered.png` });

    await page.evaluate(() => {
      const { view, source } = window.fixture;
      view.dispatch({ selection: { anchor: source.indexOf('finally') } });
      view.focus();
    });
    await frame();
    const editing = await inspect(true);
    assert.deepEqual(editing.failures, [], `${dark ? 'dark' : 'light'} editing`);
    assert.equal(editing.source, rendered.source);
    assert.equal(editing.codeTextLeft, rendered.codeTextLeft, 'source arrow must not shift the code');
    await page.screenshot({ path: `.codex/callout-regression/${dark ? 'dark' : 'light'}-editing.png` });

    // Click the real character in the gutter, delete it, then undo. A painted/atomic
    // substitute or a visually shifted hitbox cannot pass this check.
    const target = await page.evaluate(() => {
      const { view, source } = window.fixture;
      const pos = source.indexOf('> } finally');
      const prefix = [...view.dom.querySelectorAll('.mk-cm-callout-code-prefix')]
        .find((element) => element.textContent.trim() === '>' && element.parentElement.textContent.includes('finally'));
      if (!prefix) throw new Error('source prefix not rendered');
      const rect = prefix.getBoundingClientRect();
      return { pos, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(target.x, target.y);
    assert.equal(await page.evaluate(() => window.fixture.view.state.selection.main.head), target.pos + 1, 'click maps to the right of the editable prefix');
    await page.evaluate((pos) => window.fixture.view.dispatch({ changes: { from: pos, to: pos + 1, insert: '' } }), target.pos);
    const changed = await page.evaluate(() => window.fixture.view.state.doc.toString());
    assert.equal(changed, editing.source.slice(0, target.pos) + editing.source.slice(target.pos + 1));
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.fixture.view.state.doc.toString()), editing.source);
    await frame();
    assert.deepEqual((await inspect(true)).failures, []);

    await page.evaluate(() => window.fixture.setReadOnly(true));
    await page.locator('#outside').click();
    await frame();
    assert.deepEqual((await inspect(false)).failures, [], 'reading mode');
    await page.evaluate(() => window.fixture.setReadOnly(false));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: light/dark, render/source/read-only, wrapped code containment, prefix size/gutter, click-delete-undo.');
} finally {
  await browser.close();
}
