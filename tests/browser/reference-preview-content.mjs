import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(12000);

const fence = '`'.repeat(3);
const lines = [
  '# 目标章节', '',
  ...Array.from({ length: 19 }, (_, index) => `开头文字第 ${index + 1} 行`), '',
  `${fence}mermaid`, 'flowchart TD', '  subgraph S["完整图表"]',
  ...Array.from({ length: 14 }, (_, index) => `    N${index}["节点 ${index}"] --> N${index + 1}`),
  '  end', fence, '', '章节尾部内容', '', '# 下一个章节', '文档最后的内容',
];
const content = lines.join('\n');
const popup = page.getByRole('dialog', { name: '引用内容预览' });

async function show(target, dark) {
  await page.mouse.move(1300, 20);
  await page.keyboard.press('Escape');
  await page.evaluate(({ content, target, dark }) => {
    window.fixture.restore();
    window.fixture.configure({ dark });
    window.fixture.setTarget(content);
    window.fixture.set(`# 入口\n\n[[${target}|打开引用]]`);
  }, { content, target, dark });
  await page.locator('#editor [data-mk-link-target]').first().hover();
  await popup.locator('.cm-content').waitFor();
}

async function previewSource() {
  return page.evaluate(() => {
    const editor = document.querySelector('[data-reference-preview] .cm-editor');
    return window.fixture.view.constructor.findFromDOM(editor).state.doc.toString();
  });
}

try {
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:1420'}/tests/browser/document-references.html`);
  await page.waitForFunction(() => Boolean(window.fixture?.view));

  for (const dark of [false, true]) {
    await show('b.md', dark);
    assert.equal(await previewSource(), content, 'Whole-file preview must contain every referenced line');
    assert.ok((await popup.innerText()).includes(`line 1-${lines.length}`));
    const scroll = popup.locator('.cm-scroller');
    await scroll.evaluate(element => { element.scrollTop = 400; });
    await popup.locator('.mk-cm-mermaid-canvas svg').waitFor({ timeout: 20000 });
    assert.equal(await popup.locator('.mk-cm-mermaid[data-state="error"]').count(), 0, 'A complete Mermaid block must render without a truncated-source error');
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await popup.getByText('文档最后的内容', { exact: true }).waitFor();
    assert.equal(await popup.isVisible(), true, 'Scrolling inside the preview must keep it open');

    await show('b.md#目标章节', dark);
    const section = await previewSource();
    assert.ok(section.includes('章节尾部内容'), 'Long section preview must include its final content');
    assert.ok(!section.includes('文档最后的内容'), 'Section preview must not include the next section');

    await show('b.md#L10-L44', dark);
    assert.equal(await previewSource(), lines.slice(9, 44).join('\n'), 'Line-range preview must retain every selected line');
    assert.ok((await popup.innerText()).includes('line 10-44'));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: complete file, section and line-range previews; Mermaid rendering and scrolling to the end.');
} finally {
  await browser.close();
}
