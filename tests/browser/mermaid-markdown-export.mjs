import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:1420';
const rust = await readFile('src-tauri/src/core/mermaid.rs', 'utf8');
const template = rust.match(/r#"(<!doctype html>[\s\S]*?)"#/)[1];
const source = 'gantt\n dateFormat YYYY-MM-DD\n section 计划\n **任务** *文字* `id` $x^2$<br/>- 第一项<br/>- 第二项 :a, 2026-01-01, 3d';
const values = { source_json: JSON.stringify(source), script_url: `${base}/src-tauri/resources/mermaid/mermaid.min.js`,
  renderer_config: Buffer.from(await readFile('src/lib/mermaid-config.js')).toString('base64'),
  markdown_renderer: Buffer.from(await readFile('src-tauri/resources/mermaid/markdown-labels.js')).toString('base64'),
  themes_json: JSON.stringify({ light: 'default', dark: 'dark', diagrams: {} }), html_labels: 'true', node_spacing: '50', rank_spacing: '60' };
const html = template.replaceAll('{{', '{').replaceAll('}}', '}')
  .replace(/\{(source_json|script_url|renderer_config|markdown_renderer|themes_json|html_labels|node_spacing|rank_spacing)\}/g, (_, name) => values[name]);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
 await page.route('**/markdown-export-test', route => route.fulfill({contentType:'text/html', body:html}));
 await page.goto(`${base}/markdown-export-test`);
 await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state));
 assert.equal(await page.locator('body').getAttribute('data-state'), 'ready', await page.locator('body').getAttribute('data-error'));
 const result = await page.evaluate(() => {
   const svg = document.querySelector('svg');
   const bar = svg.querySelector('rect.task').getBoundingClientRect();
   const label = svg.querySelector('foreignObject[data-mk-rich-processed]').getBoundingClientRect();
   const section = svg.querySelector('.sectionTitle').getBoundingClientRect();
   return { bar: bar.toJSON(), label: label.toJSON(), section: section.toJSON() };
 });
 assert.ok(result.label.left >= result.bar.left - 1 && result.label.right <= result.bar.right + 1, JSON.stringify(result));
 assert.ok(result.label.left >= result.section.right || result.label.top >= result.section.bottom || result.label.bottom <= result.section.top, JSON.stringify(result));
 console.log('PASS: Word Gantt rich label remains inside the task bar and clear of its section title.');
} finally { await browser.close(); }
