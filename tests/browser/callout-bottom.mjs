import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
const cases = {
  code: '> ```java\n> int value = 1;\n> ```',
  paragraph: '> 正文内容',
  list: '> - 第一项\n> - 第二项',
  table: '> | A | B |\n> | --- | --- |\n> | 1 | 2 |',
  math: '> $$\n> x^2\n> $$',
  image: '> ![图片](example.png)',
};
try {
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:1420'}/tests/browser/callout-code.html`);
  await page.waitForFunction(() => window.fixture);
  for (const dark of [false, true]) for (const [name, content] of Object.entries(cases)) for (const ending of ['end', 'following']) {
    const source = `> [!CAUTION] 测试\n${content}${ending === 'following' ? '\n\n普通正文' : ''}`;
    for (const mode of name === 'code' ? ['rendered', 'editing', 'readonly'] : ['rendered']) {
      const result = await page.evaluate(async ({ source, dark, mode }) => {
        const {view} = window.fixture;
        window.fixture.setDark(dark);
        window.fixture.setReadOnly(mode === 'readonly');
        const anchor = mode === 'editing' ? source.indexOf('int value') : source.length;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, selection: { anchor } });
        if (mode === 'editing') view.focus(); else document.querySelector('#outside').focus();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const last = view.dom.querySelector('.mk-cm-callout-last');
        if (!last) return { missing: true };
        const style = getComputedStyle(last), after = getComputedStyle(last, '::after');
        return { className: last.className, padding: parseFloat(style.paddingBottom),
          radius: parseFloat(style.borderBottomLeftRadius), shadow: style.boxShadow,
          codeGap: parseFloat(after.bottom), source: view.state.doc.toString() };
      }, { source, dark, mode });
      const context = `${dark ? 'dark' : 'light'}/${name}/${ending}/${mode}`;
      assert.equal(result.source, source, context);
      assert.ok(result.padding >= 7, `${context}: missing bottom padding: ${JSON.stringify(result)}`);
      assert.ok(result.radius >= 5, `${context}: missing rounded corners: ${JSON.stringify(result)}`);
      assert.match(result.shadow, /0px -1px 0px 0px inset/, `${context}: missing bottom border`);
      if (name === 'code') assert.equal(result.codeGap, 7, `${context}: code card must leave bottom padding`);
    }
  }
  console.log('PASS: callout bottom borders and padding for code, paragraphs, lists, tables, math and images in light/dark.');
} finally { await browser.close(); }
