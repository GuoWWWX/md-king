import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({channel: 'msedge', headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1200, height: 700}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:1420'}/tests/browser/window-titlebar.html`);
  await page.locator('[data-tab-id]').first().waitFor();
  const list = page.getByRole('tablist');
  const box = await list.boundingBox();
  const x = box.x + box.width - 30, y = box.y + box.height / 2;
  const calls = () => page.evaluate(() => [...window.fixture.calls]);
  const clear = () => page.evaluate(() => { window.fixture.calls.length = 0; });

  // Repeated maximize/restore through actual nested tab-list/titlebar handlers.
  for (const maximized of [true, false, true, false]) {
    await clear();
    await page.mouse.dblclick(x, y, {delay: 90});
    await page.mouse.move(x + 60, y + 60);
    assert.deepEqual(await calls(), ['toggle']);
    assert.equal(await page.evaluate(() => window.fixture.maximized), maximized);
    await page.getByRole('button', {name: maximized ? '还原窗口' : '最大化', exact: true}).waitFor();
    await page.waitForTimeout(300);
  }

  await clear();
  await page.mouse.click(x, y);
  await page.mouse.move(x + 40, y + 40);
  assert.deepEqual(await calls(), [], 'Click, release, then move must not drag');

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y);
  assert.deepEqual(await calls(), [], 'A small click movement must not drag');
  await page.mouse.move(x + 20, y);
  await page.mouse.up();
  assert.deepEqual(await calls(), ['drag'], 'A held-left-button drag starts once');

  // Release swallowed by a child must still clear the window-level drag listener.
  await clear();
  await list.evaluate(element => element.addEventListener('pointerup', event => event.stopPropagation(), {once: true}));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await list.dispatchEvent('pointermove', {clientX: x + 50, clientY: y, buttons: 1});
  assert.deepEqual(await calls(), [], 'Capture-phase release clears drag even when a child stops bubbling');

  // Native capture may hide pointerup entirely: buttons=0 must cancel pending drag.
  await page.mouse.down();
  await list.dispatchEvent('pointermove', {clientX: x + 50, clientY: y, buttons: 0});
  await list.dispatchEvent('pointermove', {clientX: x + 60, clientY: y, buttons: 1});
  await page.mouse.up();
  assert.deepEqual(await calls(), []);

  const first = await page.evaluate(() => window.fixture.first);
  const tab = page.locator(`[data-tab-id="${first}"]`);
  await tab.dblclick();
  assert.equal(await page.evaluate(() => window.fixture.activeTab), first);
  assert.deepEqual(await calls(), [], 'Document tab interactions must not toggle or drag the window');

  const originalOrder = await page.evaluate(() => window.fixture.tabIds);
  const initialTabBox = await tab.boundingBox();
  await page.mouse.move(initialTabBox.x + 20, initialTabBox.y + initialTabBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(initialTabBox.x + 20, 150);
  await page.mouse.up();
  await page.mouse.move(x, y);
  assert.deepEqual(await page.evaluate(() => window.fixture.tabIds), originalOrder, 'Releasing outside the titlebar must not leave a pending tab drag');
  await page.getByRole('textbox', {name: '页面缩放百分比'}).dblclick();
  assert.deepEqual(await calls(), [], 'Zoom controls must not toggle the window');

  const tabBox = await tab.boundingBox();
  const second = await page.evaluate(() => window.fixture.second);
  const secondBox = await page.locator(`[data-tab-id="${second}"]`).boundingBox();
  await page.mouse.move(tabBox.x + 20, tabBox.y + tabBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondBox.x + secondBox.width - 10, tabBox.y + tabBox.height / 2, {steps: 8});
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => window.fixture.tabIds), [second, first], 'Capturing on the tab preserves tab reordering');
  await tab.getByRole('button', {name: '关闭 First.md', exact: true}).click();
  assert.deepEqual(await page.evaluate(() => window.fixture.tabIds), [second]);
  assert.deepEqual(await calls(), [], 'Reordering and closing tabs must not drag or maximize the window');
  assert.deepEqual(errors, []);
  console.log('PASS: real nested titlebar/tab components maximize and restore once per double-click; release and cancellation prevent stray drags; held-button dragging and tab/zoom interactions work.');
} finally {
  await browser.close();
}
