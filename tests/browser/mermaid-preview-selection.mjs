import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

const source = [
  'flowchart LR',
  '  A["问题"] --> B["Thought 思考"]',
  '  B --> C["**Observation** 观察结果"]',
  '  C -->|继续处理| D["最终答案"]',
].join('\n');
const fence = String.fromCharCode(96).repeat(3);
const markdown = [fence + 'mermaid', source, fence, '', '正文'].join('\n');

async function selectWord(word) {
  const box = await page.evaluate((target) => {
    const root = document.querySelector('.mk-mermaid-preview').shadowRoot;
    const walker = document.createTreeWalker(root.querySelector('svg'), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const index = node.textContent.indexOf(target);
      if (index < 0 || !node.parentElement.closest('text, foreignObject')) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + target.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    throw new Error('Diagram text not found: ' + target);
  }, word);
  assert.ok(box.width > 10 && box.height > 5, 'diagram text must have visible dimensions');
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  assert.equal((await page.evaluate(() => window.getSelection().toString())).trim(), word, 'dragging over text must select it');
  return box;
}

try {
  await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:1420') + '/tests/browser/mermaid-preview.html');
  await page.waitForFunction(() => window.fixture?.view);
  await page.evaluate((text) => {
    const view = window.fixture.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
  }, markdown);
  await page.locator('.mk-cm-mermaid-canvas svg').waitFor();
  await page.locator('.mk-cm-mermaid-expand').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.locator('.mk-mermaid-preview svg').waitFor({ timeout: 5000 });
  assert.ok(await dialog.locator('.mk-mermaid-preview').getByText('Observation', { exact: true }).count());
  const isolatedIds = await page.evaluate(() => {
    const preview = document.querySelector('.mk-mermaid-preview').shadowRoot.querySelector('svg');
    return { id: preview.id, instances: document.querySelectorAll('svg[id="' + preview.id + '"]').length };
  });
  assert.ok(isolatedIds.id && isolatedIds.instances === 1, 'preview SVG IDs must not collide with the editor');
  await selectWord('Observation');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Observation', 'selected text must be copyable');

  await dialog.getByRole('button', { name: '放大', exact: true }).click();
  await dialog.getByRole('button', { name: '放大', exact: true }).click();
  assert.ok((await dialog.innerText()).includes('156%'));
  const beforeSelection = await dialog.locator('.mk-mermaid-preview').boundingBox();
  const box = await selectWord('Observation');
  const afterSelection = await dialog.locator('.mk-mermaid-preview').boundingBox();
  assert.ok(Math.abs(beforeSelection.x - afterSelection.x) < 1, 'selecting text must not pan the diagram');
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  assert.ok((await dialog.innerText()).includes('156%'), 'double-clicking text must not reset zoom');
  assert.equal((await page.evaluate(() => window.getSelection().toString())).trim(), 'Observation');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -80);
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent.includes('180%'));

  const viewport = dialog.locator('[aria-label="Mermaid 图表，图片查看器"]');
  const viewBox = await viewport.boundingBox();
  const beforePan = await dialog.locator('.mk-mermaid-preview').boundingBox();
  await page.mouse.move(viewBox.x + 20, viewBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(viewBox.x + 100, viewBox.y + 20, { steps: 8 });
  await page.mouse.up();
  const afterPan = await dialog.locator('.mk-mermaid-preview').boundingBox();
  assert.ok(afterPan.x > beforePan.x + 20, 'dragging the canvas must still pan a zoomed diagram');

  await page.mouse.dblclick(viewBox.x + 20, viewBox.y + 20);
  assert.ok((await dialog.innerText()).includes('100%'), 'double-clicking the canvas should reset zoom');
  await dialog.getByRole('button', { name: '放大', exact: true }).click();
  await dialog.getByRole('button', { name: '复位尺寸' }).click();
  assert.ok((await dialog.innerText()).includes('100%'));

  await selectWord('继续处理');
  await dialog.getByRole('button', { name: '关闭' }).click();
  await dialog.waitFor({ state: 'hidden' });

  const rich = 'flowchart LR\n A["**粗体** *斜体* `代码` $x^2$<br/>- 第一项<br/>- 第二项"] --> B["1. 一项<br/>2. 二项"]';
  const richMarkdown = [fence + 'mermaid', rich, fence, '', '正文'].join('\n');
  await page.evaluate((text) => {
    const view = window.fixture.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
  }, richMarkdown);
  await page.waitForFunction(() => document.querySelector('.mk-cm-mermaid-canvas svg strong')?.textContent === '粗体');
  await page.locator('.mk-cm-mermaid-expand').click();
  await dialog.locator('.mk-mermaid-preview svg').waitFor();
  const formatted = await page.evaluate(() => {
    const svg = document.querySelector('.mk-mermaid-preview').shadowRoot.querySelector('svg');
    const ul = svg.querySelector('ul');
    const ol = svg.querySelector('ol');
    return {
      bold: svg.querySelector('strong')?.textContent,
      italic: svg.querySelector('em')?.textContent,
      code: svg.querySelector('code')?.textContent,
      formula: svg.querySelector('math msup')?.textContent,
      bullets: ul?.querySelectorAll('li').length,
      numbers: ol?.querySelectorAll('li').length,
      bulletStyle: ul && getComputedStyle(ul).listStyleType,
      numberStyle: ol && getComputedStyle(ol).listStyleType,
      boxes: Array.from(svg.querySelectorAll('foreignObject')).map((box) => ({ height: Number(box.getAttribute('height')), content: box.firstElementChild?.scrollHeight || 0 })),
    };
  });
  assert.deepEqual({ ...formatted, boxes: undefined }, { bold: '粗体', italic: '斜体', code: '代码', formula: 'x2', bullets: 2, numbers: 2, bulletStyle: 'disc', numberStyle: 'decimal', boxes: undefined });
  for (const box of formatted.boxes) assert.ok(box.content <= box.height + 2, 'formatted labels must not be clipped: ' + JSON.stringify(box));
  await selectWord('粗体');
  await dialog.getByRole('button', { name: '关闭' }).click();
  await dialog.waitFor({ state: 'hidden' });

  const sequence = ['sequenceDiagram', '  participant A as 用户客户端', '  participant B as API 网关', '  A->>B: ObservationMessage'].join('\n');
  const sequenceMarkdown = [fence + 'mermaid', sequence, fence, '', '正文'].join('\n');
  await page.evaluate((text) => {
    document.documentElement.classList.remove('dark');
    const view = window.fixture.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
  }, sequenceMarkdown);
  await page.waitForFunction(() => document.querySelector('.mk-cm-mermaid-canvas svg')?.textContent.includes('ObservationMessage'));
  await page.locator('.mk-cm-mermaid-expand').click();
  await dialog.locator('.mk-mermaid-preview svg').waitFor();
  const isSvgText = await page.evaluate(() => {
    const svg = document.querySelector('.mk-mermaid-preview').shadowRoot.querySelector('svg');
    return Array.from(svg.querySelectorAll('text')).some((text) => text.textContent.includes('ObservationMessage'));
  });
  assert.ok(isSvgText, 'the sequence diagram should exercise native SVG text');
  await selectWord('ObservationMessage');
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'ObservationMessage');
  await dialog.getByRole('button', { name: '关闭' }).click();
  await dialog.waitFor({ state: 'hidden' });

  const hostile = [fence + 'mermaid', 'flowchart LR', '  A["**Safe** <img src=x onerror=window.__previewExecuted=true>"]', fence, '', '正文'].join('\n');
  await page.evaluate((text) => {
    window.__previewExecuted = false;
    const view = window.fixture.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
  }, hostile);
  await page.waitForFunction(() => document.querySelector('.mk-cm-mermaid-canvas svg')?.textContent.includes('Safe'));
  await page.locator('.mk-cm-mermaid-expand').click();
  await dialog.locator('.mk-mermaid-preview svg').waitFor();
  await page.waitForTimeout(100);
  const security = await page.evaluate(() => ({
    executed: window.__previewExecuted,
    dangerous: Boolean(document.querySelector('.mk-mermaid-preview').shadowRoot.querySelector('[onerror], script')),
  }));
  assert.deepEqual(security, { executed: false, dangerous: false }, 'previewed Mermaid content must remain sanitized');
  await dialog.getByRole('button', { name: '关闭' }).click();
  await dialog.waitFor({ state: 'hidden' });

  await page.evaluate(() => window.fixture.openImage());
  await dialog.waitFor();
  const image = dialog.getByRole('img', { name: '普通图片' });
  await image.waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"] img')?.naturalWidth > 0);
  assert.equal(await dialog.locator('.mk-mermaid-preview').count(), 0, 'ordinary images should use the normal image viewer');
  await dialog.getByRole('button', { name: '放大', exact: true }).click();
  assert.ok((await dialog.innerText()).includes('125%'));
  const imageViewport = dialog.locator('[aria-label="普通图片，图片查看器"]');
  const imageViewBox = await imageViewport.boundingBox();
  const imageBeforePan = await image.boundingBox();
  await page.mouse.move(imageViewBox.x + 20, imageViewBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(imageViewBox.x + 20, imageViewBox.y + 80, { steps: 8 });
  await page.mouse.up();
  const imageAfterPan = await image.boundingBox();
  assert.ok(imageAfterPan.y > imageBeforePan.y + 10, 'ordinary image panning must still work');

  assert.deepEqual(errors, []);
  console.log('PASS: Mermaid flowchart and sequence text can be selected and copied; zoom, pan, reset, and ordinary images still work.');
} finally {
  await browser.close();
}
