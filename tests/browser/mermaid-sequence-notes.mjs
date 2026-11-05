import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:1420';
const shared = Buffer.from(await readFile('src/lib/mermaid-config.js')).toString('base64');
const markdownRenderer = Buffer.from(await readFile('src-tauri/resources/mermaid/markdown-labels.js')).toString('base64');
const rust = await readFile('src-tauri/src/core/mermaid.rs', 'utf8');
const template = rust.match(/r#"(<!doctype html>[\s\S]*?)"#/)[1];
const sentence = '使用浏览器完成授权，安全返回会话结果';
const cases = {
  short: { message: sentence, placement: 'over App,Auth', lines: 1 },
  long: { message: sentence.repeat(5), placement: 'over App,Auth', lines: 2 },
  mixed: { message: `用户在浏览器完成 OAuth 2.0 授权，返回 session token 并校验状态。${sentence.repeat(3)}`, placement: 'over App,Auth', lines: 2 },
  explicit: { message: `${sentence}<br/>${sentence.repeat(4)}`, placement: 'over App,Auth', lines: 2 },
  single: { message: sentence.repeat(4), placement: 'over App', lines: 2 },
  right: { message: sentence.repeat(4), placement: 'right of App', lines: 2 },
  left: { message: sentence.repeat(4), placement: 'left of Auth', lines: 2 },
  english: { message: 'The authorization service validates the session before returning the complete authorization result to the requesting application.', placement: 'over App,Auth', lines: 2 },
  emoji: { message: `用户 👩‍💻 完成授权后安全返回结果。${sentence.repeat(3)}`, placement: 'over App,Auth', lines: 2 },
  bold: { message: `**${sentence.repeat(4)}**`, placement: 'over App,Auth', lines: 2, bold: true },
  mixedFormatting: { message: `**授权通过** ${sentence.repeat(2)} *继续处理* ${sentence.repeat(2)} \`session_token\``, placement: 'over App,Auth', lines: 2, bold: true },
  math: { message: `计算 $x^2$ 完成校验。${sentence.repeat(4)}`, placement: 'over App,Auth', lines: 2, math: true },
  explicitNoWrap: { message: `nowrap: ${sentence.repeat(4)}`, placement: 'over App,Auth', lines: 1, noWrap: true },
};

function exportPage(source, theme, svg) {
  const values = { source_json: JSON.stringify(source), script_url: `${base}/src-tauri/resources/mermaid/mermaid.min.js`,
    renderer_config: shared, markdown_renderer: markdownRenderer, themes_json: JSON.stringify({ light: theme, dark: theme, diagrams: {} }),
    html_labels: String(!svg), node_spacing: '50', rank_spacing: '60' };
  return template.replaceAll('{{', '{').replaceAll('}}', '}')
    .replace(/\{(source_json|script_url|renderer_config|markdown_renderer|themes_json|html_labels|node_spacing|rank_spacing)\}/g, (_, name) => values[name]);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1400 } });
  let html = '<!doctype html><body></body>';
  await page.route('**/sequence-note-test', route => route.fulfill({ contentType: 'text/html', body: html }));
  let count = 0;
  for (const mode of ['light', 'dark', 'export-png', 'export-svg']) for (const [name, example] of Object.entries(cases)) {
    const source = `sequenceDiagram\n participant App as 应用\n participant Auth as 授权服务\n App->>Auth: 发起登录\n Note ${example.placement}: ${example.message}\n Auth-->>App: 返回授权状态`;
    const theme = mode === 'dark' ? 'redux-dark-color' : 'redux-color';
    html = mode.startsWith('export') ? exportPage(source, theme, mode === 'export-svg') : '<!doctype html><body></body>';
    await page.goto(`${base}/sequence-note-test`);
    if (mode.startsWith('export')) {
      await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state));
      assert.equal(await page.locator('body').getAttribute('data-state'), 'ready', await page.locator('body').getAttribute('data-error'));
      if (mode === 'export-svg') await page.evaluate(() => {
        const bytes = Uint8Array.from(atob(document.body.dataset.svgBase64), char => char.charCodeAt(0));
        document.querySelector('#diagram').innerHTML = new TextDecoder().decode(bytes);
      });
    } else {
      await page.evaluate(async ({ source, theme, mode }) => {
        const { renderMermaid } = await import('/src/lib/mermaid.ts');
        document.body.innerHTML = (await renderMermaid(source, mode === 'dark', { light: theme, dark: theme, diagrams: {} })).svg;
      }, { source, theme, mode });
    }
    const data = await page.evaluate(() => {
      const svg = document.querySelector('svg'); svg.style.maxWidth = 'none';
      const group = svg.querySelector('g[data-et="note"]'), rect = group.querySelector('rect.note');
      const box = element => element.getBoundingClientRect().toJSON();
      const elements = [...group.querySelectorAll('text.noteText, foreignObject')];
      const message = [...svg.querySelectorAll('.messageText')].find(e => e.textContent.includes('返回授权状态'));
      return { note: box(rect), svg: box(svg), rows: elements.map(e => ({ box: box(e), text: e.textContent })),
        next: box(message), bold: group.querySelectorAll('strong').length, math: group.querySelectorAll('math').length, rich: document.body.dataset.richLabels };
    });
    const context = `${mode}/${name}`;
    assert.ok(data.rows.length >= example.lines, `${context}: long note did not wrap`);
    if (!example.noWrap) assert.ok(data.note.width <= 480, `${context}: note grew wider than necessary`);
    else assert.equal(data.rows.length, 1, `${context}: explicit nowrap was ignored`);
    for (const row of data.rows) {
      assert.ok(row.box.left >= data.note.left + 4 && row.box.right <= data.note.right - 4
        && row.box.top >= data.note.top + 4 && row.box.bottom <= data.note.bottom - 4, `${context}: text not covered: ${JSON.stringify(data)}`);
    }
    assert.ok(data.note.left >= data.svg.left - 1 && data.note.right <= data.svg.right + 1, `${context}: note clipped by SVG`);
    assert.ok(data.next.top > data.note.bottom, `${context}: note overlaps the next message`);
    if (!example.math) {
      const actual = data.rows.map(row => row.text).join('').replace(/\s+/g, '');
      const expected = example.message.replace(/^nowrap:\s*|<br\s*\/?>|[*`]/gi, '').replace(/\s+/g, '');
      assert.equal(actual, expected, `${context}: note characters changed`);
    } else assert.ok(data.math, `${context}: formula formatting was lost`);
    if (example.bold) assert.ok(data.bold, `${context}: bold formatting was lost`);
    if (mode === 'export-svg' && !example.bold && !example.math) assert.equal(data.rich, 'false', `${context}: ordinary notes must keep SVG export`);
    count++;
  }
  console.log(`PASS: ${count} sequence note cases across preview, Word PNG and SVG export.`);
} finally { await browser.close(); }
