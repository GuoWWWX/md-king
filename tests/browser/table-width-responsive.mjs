import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

const sample = [
  '| 模式 | 中文 | 一句话核心 | 复杂度 | 学习优先级 |',
  '| ---- | ---- | ---------- | ------ | ---------- |',
  '| **Tool Use** | 工具调用 | 模型提出工具调用，应用执行函数 | ⭐ | ⭐⭐⭐⭐⭐ |',
  '| **ReAct** | 推理-行动 | Thought → Action → Observation 循环 | ⭐⭐ | ⭐⭐⭐⭐⭐ |',
  '| **Plan-and-Execute** | 先规划后执行 | 先形成计划，再执行并按需调整 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |',
  '| **Reflection** | 反思 | 输出后自检并修正 | ⭐⭐⭐ | ⭐⭐⭐⭐ |',
  '| **Reflexion** | 强化反思 | 反思 + 持久化记忆 + 重试 | ⭐⭐⭐⭐ | ⭐⭐⭐ |',
  '| **REWOO** | 无观察推理 | 先规划工具使用，再执行并汇总 | ⭐⭐⭐ | ⭐⭐⭐ |',
  '| **Multi-Agent** | 多智能体协作 | 多个 Agent 分工合作 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |',
].join('\n');

const setSource = async (source) => {
  await page.evaluate((text) => {
    const view = window.fixture.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
  }, source);
  await page.waitForSelector('#editor .mk-cm-table');
};

const resize = async (width) => {
  await page.evaluate((value) => {
    const editor = document.querySelector('#editor');
    editor.style.flex = 'none';
    editor.style.width = value + 'px';
  }, width);
  await page.waitForTimeout(100);
};

const measure = () => page.locator('#editor .mk-cm-table-wrapper').evaluate((wrapper) => {
  const scroller = wrapper.querySelector('.mk-cm-table-scroll');
  const table = wrapper.querySelector('table');
  const lastCell = wrapper.querySelector('thead th:last-child');
  return {
    wraps: wrapper.classList.contains('is-wrap'),
    scrollWidth: scroller.scrollWidth,
    clientWidth: scroller.clientWidth,
    overflowX: getComputedStyle(scroller).overflowX,
    tableWidth: table.getBoundingClientRect().width,
    scrollRight: scroller.getBoundingClientRect().right,
    lastRight: lastCell.getBoundingClientRect().right,
    lastText: lastCell.textContent,
    clippedContents: Array.from(wrapper.querySelectorAll('.mk-cm-table-cell-content:not(.is-editing)'))
      .filter((cell) => cell.scrollWidth > cell.clientWidth + 1 || cell.scrollHeight > cell.clientHeight + 1)
      .map((cell) => cell.textContent),
  };
});

const assertFits = async (context) => {
  const geometry = await measure();
  assert.ok(geometry.wraps, context + ': expected content mode');
  assert.equal(geometry.lastText, '学习优先级');
  assert.ok(geometry.lastRight <= geometry.scrollRight + 1, context + ': last column is clipped: ' + JSON.stringify(geometry));
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, context + ': unnecessary horizontal overflow: ' + JSON.stringify(geometry));
  assert.deepEqual(geometry.clippedContents, [], context + ': cell content must wrap without clipping');
};

try {
  await page.goto((process.env.TEST_BASE_URL || 'http://127.0.0.1:1420') + '/tests/browser/table-images.html');
  await page.waitForFunction(() => window.fixture?.view);
  await page.evaluate(() => { document.querySelector('#preview').style.display = 'none'; });
  await setSource(sample);

  for (const width of [800, 650, 500, 360, 800]) {
    await resize(width);
    await assertFits('editor width ' + width);
  }
  assert.equal(await page.evaluate(() => window.fixture.source), sample, 'resizing must not change Markdown');

  await page.evaluate(() => window.fixture.configure({ isDark: true }));
  await resize(500);
  await assertFits('dark mode');

  const wrapper = page.locator('#editor .mk-cm-table-wrapper');
  await page.locator('#editor .mk-cm-table-cell-content[data-table-row="1"][data-table-column="2"]').click();
  const input = page.locator('#editor textarea[data-table-row="1"][data-table-column="2"]');
  await input.waitFor({ state: 'visible' });
  const inputFits = await input.evaluate((element) => element.scrollHeight <= element.clientHeight + 1);
  assert.ok(inputFits, 'editing a wrapped cell should display its complete Markdown');
  await assertFits('editing a cell');
  await input.press('Escape');
  assert.equal(await page.evaluate(() => window.fixture.source), sample, 'cancelling editing must preserve Markdown');

  for (const zoom of [1.25, 1.5]) {
    await page.evaluate((value) => { document.body.style.zoom = value; }, zoom);
    await assertFits('zoom ' + zoom);
  }
  await page.evaluate(() => { document.body.style.zoom = ''; });

  await wrapper.locator('.mk-table-width-mode-button').click();
  let geometry = await measure();
  assert.equal(geometry.wraps, false, 'the other width mode must remain available');
  assert.equal(geometry.overflowX, 'auto');
  assert.ok(geometry.scrollWidth > geometry.clientWidth, 'wide tables remain scrollable in window mode');
  await wrapper.locator('.mk-table-width-mode-button').click();
  await assertFits('switching back to content mode');

  await page.evaluate(() => window.fixture.configure({ readOnly: true }));
  await page.waitForSelector('#editor .mk-cm-table-wrapper--readonly');
  await assertFits('read-only mode');
  await page.evaluate(() => window.fixture.configure({ readOnly: false }));

  const quoted = '> [!TIP] 引用表格\n' + sample.split('\n').map((line) => '> ' + line).join('\n');
  await setSource(quoted);
  await assertFits('table in a quote');

  await setSource('| A | B |\n| --- | --- |\n| x | y |');
  geometry = await measure();
  assert.ok(geometry.tableWidth < 300, 'short tables should remain compact in content mode');

  const cells = Array.from({ length: 40 }, (_, i) => '列' + (i + 1));
  const wide = [cells, cells.map(() => '---'), cells.map(() => 'x')]
    .map((row) => '| ' + row.join(' | ') + ' |').join('\n');
  await setSource(wide);
  geometry = await measure();
  assert.ok(geometry.scrollWidth > geometry.clientWidth, 'an intrinsically wide table must not be clipped');
  assert.equal(geometry.overflowX, 'auto', 'an intrinsically wide table needs horizontal scrolling');
  await page.locator('#editor .mk-cm-table-scroll').evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  geometry = await measure();
  assert.ok(geometry.lastRight <= geometry.scrollRight + 1, 'the last column must be reachable');

  assert.deepEqual(errors, []);
  console.log('PASS: responsive Markdown tables fit in content mode, remain compact, support quotes and read-only, and scroll when necessary.');
} finally {
  await browser.close();
}
