import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { contrastRatio } from './contrast-utils.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");

const source = `flowchart TD
subgraph MGT["管理角色权限基线（管理员、安全管理员、独立审计员职责分离）"]
  AUDIT["独立审计员<br/>只读访问操作日志与审计记录，无配置权限"]
  ADMIN["安全管理员<br/>负责安全策略配置、权限审批与账号维护"]
end
subgraph BIZ["业务操作角色基线（按岗位实名制细化操作权限）"]
  RUN["运行操作员<br/>日常运行监控、常规启闭控制与告警处理"]
end
AUDIT ==>|独立监督与留痕审查| BIZ
ADMIN -.->|分配权限与安全策略并记录操作审批结果| BIZ
classDef audit fill:#E4DFEC,stroke:#8064A2,stroke-width:4px,color:#4B3869;
class AUDIT audit;`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  let previewColors;
  for (const mode of ["preview-light", "preview-dark", "export-png", "export-svg"]) {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1800 } });
    const base = process.env.TEST_BASE_URL || "http://127.0.0.1:1420";
    await page.route("**/mermaid-export-test", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }));
    await page.goto(`${base}/mermaid-export-test`);
    const result = await page.evaluate(async ({ source, mode }) => {
      const dark = mode === "preview-dark";
      if (mode.startsWith("preview")) {
        const { renderMermaid } = await import("/src/lib/mermaid.ts");
        document.body.innerHTML = (await renderMermaid(source, dark)).svg;
      } else {
        // Use the same bundled runtime and shared module as the Rust renderer.
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "/src-tauri/resources/mermaid/mermaid.min.js";
          script.onload = resolve; script.onerror = reject;
          document.head.append(script);
        });
        const { mermaidConfig, styleMermaidEdgeLabels, ensureMermaidContrast } = await import("/src/lib/mermaid-config.js");
        const config = mermaidConfig("default");
        config.htmlLabels = mode === "export-png";
        Object.assign(config.flowchart, { htmlLabels: config.htmlLabels, useMaxWidth: false });
        window.mermaid.initialize(config);
        document.body.innerHTML = (await window.mermaid.render("export", source)).svg;
        styleMermaidEdgeLabels(document.querySelector("svg"), false);
        ensureMermaidContrast(document.querySelector("svg"), false);
      }
      const root = document.querySelector("svg");
      root.style.maxWidth = "none";
      const rect = node => node.getBoundingClientRect().toJSON();
      const nodes = [...root.querySelectorAll(".node")].map(node => {
        const shape = [...node.querySelectorAll("rect,polygon,path,circle,ellipse")].find(shape => getComputedStyle(shape).fill !== "none");
        return { id: node.id, rect: rect(node), fill: getComputedStyle(shape).fill,
          stroke: getComputedStyle(shape).stroke, strokeWidth: getComputedStyle(shape).strokeWidth };
      });
      return {
        nodes,
        titles: [...root.querySelectorAll(".cluster-label")].map(label => ({ text: label.textContent, rect: rect(label) })),
        foreign: [...root.querySelectorAll("foreignObject")].map(fo => ({
          height: Number(fo.getAttribute("height")), scrollHeight: fo.firstElementChild?.scrollHeight,
        })),
        labels: [...root.querySelectorAll("g.edgeLabel")].filter(label => label.textContent.trim()).map(label => {
          const text = label.querySelector("p,span,text"), card = label.querySelector("foreignObject > div, rect.background");
          const style = getComputedStyle(card), textStyle = getComputedStyle(text);
          return { text: label.textContent, color: text.tagName === 'text' ? textStyle.fill : textStyle.color,
            background: card.tagName === 'rect' ? style.fill : style.backgroundColor,
            border: card.tagName === 'rect' ? style.stroke : style.borderTopWidth, opacity: style.opacity,
            font: textStyle.fontSize };
        }),
      };
    }, { source, mode });
    assert.equal(result.titles.length, 2, mode);
    for (const title of result.titles) {
      for (const node of result.nodes) {
        const x = Math.min(title.rect.right, node.rect.right) - Math.max(title.rect.left, node.rect.left);
        const y = Math.min(title.rect.bottom, node.rect.bottom) - Math.max(title.rect.top, node.rect.top);
        assert.ok(x <= 0 || y <= 0, `${mode}: title overlaps ${node.id}`);
      }
    }
    for (const fo of result.foreign) {
      assert.ok(fo.scrollHeight <= fo.height + 1, `${mode}: text clipped by foreignObject`);
    }
    assert.equal(result.labels.length, 2, mode);
    const colors = ["AUDIT", "ADMIN", "RUN"].map(id => result.nodes.find(node => node.id.includes(id)).fill);
    if (mode === "preview-light") previewColors = colors;
    if (mode === "export-png") assert.deepEqual(colors, previewColors, "offline engine and preview must produce the same native palette");
    if (mode !== "preview-dark") {
      assert.equal(result.nodes.find(node => node.id.includes("AUDIT")).fill, "rgb(228, 223, 236)", `${mode}: preserve explicit classDef color`);
      assert.equal(result.nodes.find(node => node.id.includes("AUDIT")).stroke, "rgb(128, 100, 162)", `${mode}: preserve explicit node border color`);
      assert.equal(result.nodes.find(node => node.id.includes("AUDIT")).strokeWidth, "4px", `${mode}: preserve explicit node border width`);
      assert.notEqual(result.nodes.find(node => node.id.includes("ADMIN")).fill, "rgb(254, 243, 199)", `${mode}: use the native palette instead of the old amber override`);
    }
    assert.ok(result.labels.every(label => ['none', 'rgba(0, 0, 0, 0)'].includes(label.background)
      && (label.border === 'none' || parseFloat(label.border) === 0) && parseFloat(label.font) === 12),
    `${mode}: relationship labels must be transparent, borderless and smaller: ${JSON.stringify(result.labels)}`);
    await page.close();
  }
  // Inspect the actual Word SVG after its Office compatibility pass, not only
  // the live renderer before style attributes are serialized.
  const base = process.env.TEST_BASE_URL || "http://127.0.0.1:1420";
  const rust = await readFile('src-tauri/src/core/mermaid.rs', 'utf8');
  const template = rust.match(/r#"(<!doctype html>[\s\S]*?)"#/)[1];
  const values = { source_json: JSON.stringify('flowchart LR\nA["起点"] -->|"连线文字"| B["终点"]'),
    script_url: `${base}/src-tauri/resources/mermaid/mermaid.min.js`,
    renderer_config: Buffer.from(await readFile('src/lib/mermaid-config.js')).toString('base64'),
    markdown_renderer: Buffer.from(await readFile('src-tauri/resources/mermaid/markdown-labels.js')).toString('base64'),
    themes_json: JSON.stringify({ light: 'default', dark: 'dark', diagrams: {} }),
    html_labels: 'false', node_spacing: '50', rank_spacing: '60' };
  const html = template.replaceAll('{{', '{').replaceAll('}}', '}')
    .replace(/\{(source_json|script_url|renderer_config|markdown_renderer|themes_json|html_labels|node_spacing|rank_spacing)\}/g, (_, name) => values[name]);
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.route('**/mermaid-frame-svg-test', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`${base}/mermaid-frame-svg-test`);
  await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state));
  assert.equal(await page.locator('body').getAttribute('data-state'), 'ready', await page.locator('body').getAttribute('data-error'));
  const exported = await page.evaluate(() => {
    const bytes = Uint8Array.from(atob(document.body.dataset.svgBase64), char => char.charCodeAt(0));
    document.querySelector('#diagram').innerHTML = new TextDecoder().decode(bytes);
    const edge = document.querySelector('g.edgeLabel'), card = edge.querySelector('rect.background'), text = edge.querySelector('text');
    const box = getComputedStyle(card), label = getComputedStyle(text);
    const bounds = card.getBoundingClientRect(), id = edge.querySelector('g.label[data-id]').getAttribute('data-id');
    const path = [...document.querySelectorAll('path.flowchart-link[data-id]')].find(item => item.getAttribute('data-id') === id);
    const matrix = path.getScreenCTM(), length = path.getTotalLength();
    let nearLine = false;
    for (let i = 0; i <= 500; i++) {
      const point = path.getPointAtLength(length * i / 500).matrixTransform(matrix);
      if (point.x >= bounds.left - 24 && point.x <= bounds.right + 24 && point.y >= bounds.top - 24 && point.y <= bounds.bottom + 24) nearLine = true;
    }
    return { fill: box.fill, border: box.stroke, opacity: box.opacity, text: label.fill, font: label.fontSize, nearLine };
  });
  assert.ok(['none', 'rgba(0, 0, 0, 0)'].includes(exported.fill) && exported.border === 'none'
    && exported.nearLine && parseFloat(exported.font) === 12 && contrastRatio('rgb(255, 255, 255)', exported.text) >= 4.5,
  `serialized Word SVG must retain transparent labels and smaller text: ${JSON.stringify(exported)}`);
  await page.close();
  console.log("PASS: preview and Word PNG/SVG share the native theme, preserve explicit colors and keep Chinese titles/labels readable.");
} finally {
  await browser.close();
}
