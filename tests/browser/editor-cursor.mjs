// Start Vite, then run: node tests/browser/editor-cursor.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && message.text().includes('CodeMirror')) errors.push(message.text());
});
async function frame() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
try {
  await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:1420') + '/tests/browser/editor-cursor.html');
  await page.waitForFunction(() => Boolean(window.fixture?.view));
  for (const dark of [true, false]) {
    await page.evaluate(isDark => window.fixture.configure({ isDark }), dark);
    await frame();
    for (const target of ['普通', '标题光标', '引用正文', 'lock.lock', '末行']) {
      await page.evaluate(target => {
        const { view } = window.fixture;
        view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(target) + 1 }, scrollIntoView: true });
        view.focus();
      }, target);
      await frame();
      const cursor = await page.evaluate(() => {
        const { view } = window.fixture;
        const element = view.dom.querySelector('.mk-cm-cursor-layer .cm-cursor');
        const rect = element.getBoundingClientRect();
        const coords = view.coordsAtPos(view.state.selection.main.head);
        const style = getComputedStyle(element);
        return {
          width: rect.width, height: rect.height, measuredHeight: parseFloat(element.style.height),
          offsetX: Math.abs(rect.left + rect.width / 2 - coords.left),
          offsetY: Math.abs((rect.top + rect.bottom - coords.top - coords.bottom) / 2),
          color: style.borderLeftColor, nativeCaret: getComputedStyle(view.contentDOM).caretColor,
        };
      });
      assert.equal(cursor.width, 3, `${target}: cursor width`);
      assert.ok(Math.abs(cursor.height / cursor.measuredHeight - (dark ? 0.85 : 0.9)) < 0.02, `${target}: cursor height`);
      assert.ok(cursor.offsetX < 1 && cursor.offsetY < 1, `${target}: cursor follows insertion point ${JSON.stringify(cursor)}`);
      assert.equal(cursor.color, dark ? 'rgb(121, 167, 223)' : 'rgb(95, 143, 209)');
      assert.equal(cursor.nativeCaret, 'rgba(0, 0, 0, 0)', 'no duplicate native caret');
    }
    await page.evaluate(() => {
      const { view } = window.fixture;
      view.dispatch({ selection: { anchor: 1, head: 8 }, scrollIntoView: true });
    });
    await frame();
    assert.equal(await page.locator('.cm-cursor').count(), 0, 'range selection has no insertion caret');
    assert.equal(await page.locator('.cm-selectionLayer').count(), 0, 'native selection is not replaced');
    assert.equal(await page.evaluate(() => document.getSelection().toString()), '通正文：光标比');
    const selectedColor = await page.locator('.cm-line').first().evaluate(el => getComputedStyle(el, '::selection').backgroundColor);
    assert.notEqual(selectedColor, 'rgba(0, 0, 0, 0)', 'native highlight remains visible');
  }
  await page.keyboard.press('ArrowRight');
  await page.keyboard.insertText('输入验证');
  assert.ok(await page.evaluate(() => window.fixture.view.state.doc.toString().includes('输入验证')));
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.fixture.view.state.doc.toString()), await page.evaluate(() => window.fixture.source));
  await page.evaluate(() => window.fixture.configure({ readOnly: true }));
  await frame();
  assert.equal(await page.locator('.cm-cursor').count(), 0, 'read-only has no insertion caret');
  await page.evaluate(() => window.fixture.configure({ isDark: true, readOnly: false }));
  await frame();
  await page.evaluate(() => {
    const { view } = window.fixture;
    view.dispatch({ selection: { anchor: 5 }, scrollIntoView: true });
    view.focus();
  });
  await frame();
  await mkdir('.codex/cursor-regression', { recursive: true });
  await page.screenshot({ path: '.codex/cursor-regression/dark.png' });
  await page.locator('#outside').click();
  await frame();
  assert.equal(await page.locator('.cm-cursor').evaluate(el => getComputedStyle(el).display), 'none', 'blur hides caret');
  assert.deepEqual(errors, []);
  console.log('PASS: 3px / 85% cursor, Markdown positions, light/dark, native selection, typing/undo, read-only and blur.');
} finally {
  await browser.close();
}
