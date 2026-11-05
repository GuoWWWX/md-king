import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:1420';
const output = '.codex/mermaid-review';
await mkdir(output, {recursive: true});
const zgc = await readFile('tests/fixtures/conversion/mermaid-zgc-sequence.mmd', 'utf8');
const samples = {
  zgc,
  multiline: `flowchart LR
    A["第一行<br/>第二行"] -->|"第一行说明<br/>第二行说明"| B["目标第一行<br/>目标第二行<br/>目标第三行"]`,
  tlab: `flowchart LR
    subgraph H["新生代"]
      Eden["Eden 区"] -->|"划分专属工位"| T1["TLAB 1 (专供线程1无锁分配)"]
      Eden -->|"划分专属工位"| T2["TLAB 2 (专供线程2无锁分配)"]
      Eden -->|"划分专属工位"| T3["TLAB 3 (专供线程3无锁分配)"]
    end`,
  gc: `flowchart TD
    Eden["Eden 区"] -->|"条件1: 年龄达到阈值 (Age >= 15)"| Old["直接晋升【老年代】"]
    S0["Survivor S0"] -->|"条件2: 动态年龄判定 (累积 > 50%)"| Old
    S1["Survivor S1"] -->|"条件3: 幸存区放不下 (分配担保溢出)"| Old
    S1 -->|"都不满足 (正常幸存且放得下)"| To["整齐复制到【Survivor To 区】"]`,
  long: `sequenceDiagram
    participant App as 应用
    participant Auth as 授权服务
    App->>Auth: 发起登录
    Note over App,Auth: ${'使用浏览器完成授权，安全返回会话结果。'.repeat(6)}
    Auth-->>App: 返回授权状态`,
};
const browser = await chromium.launch({channel: 'msedge', headless: true});
try {
  const page = await browser.newPage({viewport: {width: 2200, height: 1800}, deviceScaleFactor: 1});
  for (const [name, source] of Object.entries(samples)) for (const dark of [true, false]) {
    await page.goto(`${base}/tests/browser/mermaid-markdown.html`);
    await page.waitForFunction(() => window.fixture);
    const result = await page.evaluate(async ({source, dark}) => {
      document.body.style.background = dark ? '#202124' : '#fff';
      document.querySelector('#out').innerHTML = (await window.fixture.renderMermaid(source, dark)).svg;
      const svg = document.querySelector('#out svg');
      return {
        messageGaps: [...svg.querySelectorAll('line[data-et="message"]')].map(line => {
          const rows = []; let previous = line.previousElementSibling;
          while(previous?.matches('text.messageText,foreignObject[data-mk-rich-processed]')) {
            rows.push(previous.getBoundingClientRect()); previous=previous.previousElementSibling;
          }
          return rows.length ? (line.getBoundingClientRect().top-Math.max(...rows.map(row=>row.bottom)))/Math.abs(line.parentElement.getScreenCTM().d) : null;
        }),
        notes: [...svg.querySelectorAll('g[data-et="note"]')].map(note => {
          const box = note.querySelector('rect.note').getBoundingClientRect();
          const rows = [...note.querySelectorAll('text.noteText,foreignObject')].map(text => text.getBoundingClientRect());
          return {width: box.width, lines: rows.length, covered: rows.every(row => row.left >= box.left + 4 && row.right <= box.right - 4
            && row.top >= box.top + 4 && row.bottom <= box.bottom - 4)};
        }),
        labels: [...svg.querySelectorAll('g.edgeLabel')].map(label => {
          const p = label.querySelector('p');
          const div = label.querySelector('foreignObject > div');
          const range = document.createRange(); range.selectNodeContents(p);
          const box = range.getBoundingClientRect(), inverse = label.parentElement.getScreenCTM().inverse();
          const center = new DOMPoint(box.x+box.width/2,box.y+box.height/2).matrixTransform(inverse);
          const anchor = label.getAttribute('data-mk-edge-anchor');
          const [x,y] = (anchor ?? '0 0').split(' ').map(Number);
          const horizontalBendCrossings = [...svg.querySelectorAll('path.flowchart-link')].some(path => {
            const length=path.getTotalLength(), matrix=path.getScreenCTM(), count=Math.max(1, Math.ceil(length/2));
            for(let i=1;i<count;i++) {
              const distance=length*i/count;
              const before=path.getPointAtLength(Math.max(0,distance-1)).matrixTransform(matrix);
              const after=path.getPointAtLength(Math.min(length,distance+1)).matrixTransform(matrix);
              const point=path.getPointAtLength(distance).matrixTransform(matrix);
              if(Math.abs(after.x-before.x)>Math.abs(after.y-before.y)*4 && point.x>box.left-4 && point.x<box.right+4
                && point.y>box.top-4 && point.y<box.bottom+4) return true;
            }
            return false;
          });
          return {font: getComputedStyle(p).fontSize, background: getComputedStyle(div).backgroundColor, border: getComputedStyle(div).borderTopWidth,
            dx:center.x-x, dy:center.y-y, bottomGap:y-new DOMPoint(box.x+box.width/2,box.bottom).matrixTransform(inverse).y,
            customPosition:anchor !== null, horizontalBendCrossings, unmasked:!label.querySelector('[data-mk-edge-knockout]')};
        }),
      };
    }, {source, dark});
    assert.ok(result.notes.every(note => note.covered), `${name}: note text must be covered`);
    assert.ok(result.labels.every(label => label.unmasked && (name === 'gc'
      ? label.customPosition && Math.abs(label.dx)<0.5 && Math.abs(label.dy+24)<0.5 : label.customPosition && Math.abs(label.dx)<0.5 && Math.abs(label.bottomGap-4)<0.5)),
      'horizontal glyphs must be 4 units above the line; vertical glyphs keep the elbow offset');
    assert.ok(result.messageGaps.every(gap => gap !== null && Math.abs(gap-3)<0.5), `${name}: sequence messages must be 3 units above the line`);
    if(name==='gc') assert.ok(result.labels.every(label=>!label.horizontalBendCrossings), 'vertical labels must clear both upper and lower horizontal bends');
    if (name === 'zgc') {
      assert.equal(result.notes.length, 2);
      assert.equal(result.notes[1].lines, 1, 'a wide spanning note must use its available width');
      assert.ok(result.notes[1].width > result.notes[0].width * 2, 'Note over App,NewObj must preserve its participant span');
    }
    if (name === 'long') assert.ok(result.notes[0].lines > 1, 'long notes must still wrap and grow vertically');
    assert.ok(result.labels.every(label => label.font === '12px' && label.background === 'rgba(0, 0, 0, 0)' && label.border === '0px'));
    await page.locator('#out svg').screenshot({path: `${output}/${name}-${dark ? 'dark' : 'light'}.png`});
  }
  const rust = await readFile('src-tauri/src/core/mermaid.rs', 'utf8');
  const template = rust.match(/r#"(<!doctype html>[\s\S]*?)"#/)[1];
  const values = {source_json: JSON.stringify(zgc), script_url: `${base}/src-tauri/resources/mermaid/mermaid.min.js`,
    renderer_config: Buffer.from(await readFile('src/lib/mermaid-config.js')).toString('base64'),
    markdown_renderer: Buffer.from(await readFile('src-tauri/resources/mermaid/markdown-labels.js')).toString('base64'),
    themes_json: JSON.stringify({light:'redux-color',dark:'redux-dark-color',diagrams:{}}), html_labels:'false', node_spacing:'50', rank_spacing:'60'};
  const html = template.replaceAll('{{','{').replaceAll('}}','}')
    .replace(/\{(source_json|script_url|renderer_config|markdown_renderer|themes_json|html_labels|node_spacing|rank_spacing)\}/g, (_, key) => values[key]);
  await page.route('**/note-width-export', route => route.fulfill({contentType:'text/html',body:html}));
  await page.goto(`${base}/note-width-export`);
  await page.waitForFunction(() => ['ready','error'].includes(document.body.dataset.state));
  assert.equal(await page.locator('body').getAttribute('data-state'), 'ready', await page.locator('body').getAttribute('data-error'));
  await page.evaluate(() => {
    document.querySelector('#diagram').innerHTML = new TextDecoder().decode(Uint8Array.from(atob(document.body.dataset.svgBase64), c => c.charCodeAt(0)));
  });
  assert.equal(await page.locator('g[data-et="note"]').nth(1).locator('text.noteText').count(), 1);
  assert.equal(await page.locator('body').getAttribute('data-rich-labels'), 'false', 'ordinary notes must retain vector export');
  const exportedMessageGaps = await page.evaluate(() => [...document.querySelectorAll('line[data-et="message"]')].map(line => {
    const rows=[]; let previous=line.previousElementSibling;
    while(previous?.matches('text.messageText,foreignObject[data-mk-rich-processed]')) {
      rows.push(previous.getBoundingClientRect()); previous=previous.previousElementSibling;
    }
    return rows.length ? (line.getBoundingClientRect().top-Math.max(...rows.map(row=>row.bottom)))/Math.abs(line.parentElement.getScreenCTM().d) : null;
  }));
  assert.equal(exportedMessageGaps.length, 5);
  assert.ok(exportedMessageGaps.every(gap => gap !== null && Math.abs(gap-3)<0.5), 'Word SVG sequence messages must stay 3 units above their line');
  await page.locator('svg').screenshot({path: `${output}/zgc-word-svg.png`});
  let flowHtml = '';
  await page.route('**/edge-clearance-export', route => route.fulfill({contentType:'text/html',body:flowHtml}));
  for (const name of ['gc','tlab','multiline']) for (const mode of ['png','svg']) {
    const flowValues = {...values, source_json: JSON.stringify(samples[name]), html_labels: String(mode === 'png')};
    flowHtml = template.replaceAll('{{','{').replaceAll('}}','}')
      .replace(/\{(source_json|script_url|renderer_config|markdown_renderer|themes_json|html_labels|node_spacing|rank_spacing)\}/g, (_, key) => flowValues[key]);
    await page.goto(`${base}/edge-clearance-export`);
    await page.waitForFunction(() => ['ready','error'].includes(document.body.dataset.state));
    assert.equal(await page.locator('body').getAttribute('data-state'), 'ready');
    const originalCenters = mode === 'svg' ? await page.evaluate(() => [...document.querySelectorAll('.node')].map(node => {
      const shape = node.querySelector('.label-container'), text = node.querySelector('text');
      if (!shape || !text) return null;
      const a = shape.getBoundingClientRect(), b = text.getBoundingClientRect();
      return {text:text.textContent,delta:(b.top+b.bottom-a.top-a.bottom)/2};
    }).filter(Boolean)) : [];
    if (mode === 'svg') await page.evaluate(() => {
      document.querySelector('#diagram').innerHTML = new TextDecoder().decode(Uint8Array.from(atob(document.body.dataset.svgBase64), c => c.charCodeAt(0)));
    });
    if(mode === 'svg') {
      const centers = await page.evaluate(() => [...document.querySelectorAll('.node')].map(node => {
        const shape = node.querySelector('.label-container'), text = node.querySelector('text');
        if (!shape || !text) return null;
        const a=shape.getBoundingClientRect(), b=text.getBoundingClientRect();
        return {text:text.textContent,delta:(b.top+b.bottom-a.top-a.bottom)/2};
      }).filter(Boolean));
      assert.ok(originalCenters.every(item => Math.abs(item.delta) < 2), `${name}: native SVG node center is the reference`);
      assert.ok(centers.length >= (name === 'multiline' ? 2 : 4) && centers.every(item => Math.abs(item.delta) < 2), `${name}: SVG node text must be vertically centered`);
    }
    const unmaskedLabels = await page.evaluate(() => [...document.querySelectorAll('g.edgeLabel')].every(label =>
      !label.querySelector('[data-mk-edge-knockout]')
      && [...label.querySelectorAll('rect')].every(rect => getComputedStyle(rect).stroke === 'none'
        && ['none','rgba(0, 0, 0, 0)'].includes(getComputedStyle(rect).fill))));
    await page.locator('svg').screenshot({path:`${output}/${name}-word-${mode}.png`});
    assert.ok(unmaskedLabels, `${name}/${mode}: labels must stay on their own lines without masking`);
    const labelAlignment = await page.evaluate(() => [...document.querySelectorAll('g.edgeLabel')].map(label => {
      const text=label.querySelector('p,text'), range=document.createRange(); range.selectNodeContents(text);
      const box=text.tagName.toLowerCase()==='text' ? text.getBoundingClientRect() : range.getBoundingClientRect();
      const inverse=label.parentElement.getScreenCTM().inverse();
      const center=new DOMPoint(box.x+box.width/2,box.y+box.height/2).matrixTransform(inverse);
      const bottom=new DOMPoint(box.x+box.width/2,box.bottom).matrixTransform(inverse);
      const [x,y]=label.getAttribute('data-mk-edge-anchor').split(' ').map(Number);
      const rise=Number(label.getAttribute('data-mk-edge-rise'));
      return Math.abs(center.x-x)<0.5 && (rise ? Math.abs(center.y-y+24)<0.5 : Math.abs(y-bottom.y-4)<0.5);
    }));
    assert.ok(labelAlignment.every(Boolean), `${name}/${mode}: exported labels must retain the requested line clearance`);
    if(name==='gc') {
      const clearBends = await page.evaluate(() => {
        const labels=[...document.querySelectorAll('g.edgeLabel')].map(label=>{
          const text=label.querySelector('p,text'), range=document.createRange();range.selectNodeContents(text);
          return text.tagName.toLowerCase()==='text' ? text.getBoundingClientRect() : range.getBoundingClientRect();
        });
        return [...document.querySelectorAll('path.flowchart-link')].every(path=>{
          const length=path.getTotalLength(), matrix=path.getScreenCTM(), count=Math.max(1,Math.ceil(length/2));
          for(let i=1;i<count;i++) {
            const distance=length*i/count, point=path.getPointAtLength(distance).matrixTransform(matrix);
            const before=path.getPointAtLength(Math.max(0,distance-1)).matrixTransform(matrix);
            const after=path.getPointAtLength(Math.min(length,distance+1)).matrixTransform(matrix);
            if(Math.abs(after.x-before.x)>Math.abs(after.y-before.y)*4 && labels.some(box=>point.x>box.left-4 && point.x<box.right+4
              && point.y>box.top-4 && point.y<box.bottom+4)) return false;
          }
          return true;
        });
      });
      assert.ok(clearBends, `GC/${mode}: exported vertical labels must clear the upper and lower bends`);
    }

  }
  console.log(`PASS: node centering, flowchart/sequence label gaps and note widths in preview/Word PNG/SVG; 17 previews written to ${output}.`);
} finally { await browser.close(); }
