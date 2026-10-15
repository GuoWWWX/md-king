import assert from "node:assert/strict";
import { createRequire } from "node:module";
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
classDef audit fill:#E4DFEC,stroke:#8064A2,color:#4B3869;
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
        return { id: node.id, rect: rect(node), fill: getComputedStyle(shape).fill, stroke: getComputedStyle(shape).stroke };
      });
      return {
        nodes,
        titles: [...root.querySelectorAll(".cluster-label")].map(label => ({ text: label.textContent, rect: rect(label) })),
        foreign: [...root.querySelectorAll("foreignObject")].map(fo => ({
          height: Number(fo.getAttribute("height")), scrollHeight: fo.firstElementChild?.scrollHeight,
        })),
        labels: [...root.querySelectorAll("g.edgeLabel")].filter(label => label.textContent.trim()).map(label => ({
          text: label.textContent, shadow: getComputedStyle(label.querySelector("p,span,text")).textShadow,
          stroke: getComputedStyle(label.querySelector("text") || label).stroke,
        })),
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
      assert.notEqual(result.nodes.find(node => node.id.includes("ADMIN")).fill, "rgb(254, 243, 199)", `${mode}: use the native palette instead of the old amber override`);
    }
    assert.ok(result.labels.every(label => label.shadow !== "none" || label.stroke !== "none"), `${mode}: lines must not obscure label text`);
    await page.close();
  }
  console.log("PASS: preview and Word PNG/SVG share the native theme, preserve explicit colors and keep Chinese titles/labels readable.");
} finally {
  await browser.close();
}
