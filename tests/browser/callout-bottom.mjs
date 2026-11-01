import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
const cases = {
  header: '',
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
  for (const dark of [false, true]) for (const [name, content] of Object.entries(cases)) for (const ending of ['end', 'following', 'adjacent', 'adjacentFormatted', 'adjacentHeading', 'adjacentList']) {
    const title = name === 'header' ? '这是示意流程，实际系统可以观察工具请求和执行结果；'.repeat(5) : '测试';
    const after = ending === 'following' ? '\n\n普通正文'
      : ending === 'adjacent' ? '\n普通正文'
      : ending === 'adjacentFormatted' ? '\n**适用**：动态调用工具。'
      : ending === 'adjacentHeading' ? '\n# 普通正文'
      : ending === 'adjacentList' ? '\n- 普通正文' : '';
    const source = `> [!CAUTION] ${title}${content ? `\n${content}` : ''}${after}`;
    for (const mode of ['code', 'header', 'paragraph'].includes(name) ? ['rendered', 'editing', 'readonly'] : ['rendered']) {
      const result = await page.evaluate(async ({ source, dark, mode, name, title }) => {
        const {view} = window.fixture;
        window.fixture.setDark(dark);
        window.fixture.setReadOnly(mode === 'readonly');
        const anchor = mode === 'editing' ? source.indexOf(name === 'code' ? 'int value' : name === 'header' ? title : '正文内容') : source.length;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, selection: { anchor } });
        if (mode === 'editing') view.focus(); else document.querySelector('#outside').focus();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const last = view.dom.querySelector('.mk-cm-callout-last');
        if (!last) return { missing: true };
        const style = getComputedStyle(last), after = getComputedStyle(last, '::after');
        const next = [...view.dom.querySelectorAll('.cm-line')].find(line => line.textContent.includes('普通正文') || line.textContent.includes('适用'));
        return { className: last.className, padding: parseFloat(style.paddingBottom),
          radius: parseFloat(style.borderBottomLeftRadius), shadow: style.boxShadow,
          codeGap: parseFloat(after.bottom), source: view.state.doc.toString(),
          beforeNext: !next || last.getBoundingClientRect().bottom <= next.getBoundingClientRect().top + 1,
          nextIsCallout: Boolean(next?.classList.contains('mk-cm-callout-line')),
          headerHeight: view.dom.querySelector('.mk-cm-callout-first')?.getBoundingClientRect().height };
      }, { source, dark, mode, name, title });
      const context = `${dark ? 'dark' : 'light'}/${name}/${ending}/${mode}`;
      assert.equal(result.source, source, context);
      assert.ok(result.padding >= 7, `${context}: missing bottom padding: ${JSON.stringify(result)}`);
      assert.ok(result.radius >= 5, `${context}: missing rounded corners: ${JSON.stringify(result)}`);
      assert.match(result.shadow, /0px -1px 0px 0px inset/, `${context}: missing bottom border`);
      assert.ok(result.beforeNext, `${context}: the bottom border must be before the following paragraph`);
      assert.equal(result.nextIsCallout, false, `${context}: the following paragraph must not be styled as a callout`);
      if (name === 'header') assert.ok(result.headerHeight > 40, `${context}: the example should cover a wrapped title`);
      if (name === 'code') assert.equal(result.codeGap, 7, `${context}: code card must leave bottom padding`);
    }
  }
  console.log('PASS: callout bottoms remain visible before adjacent text, headings, and lists, including code, tables, math, and images.');
} finally { await browser.close(); }
