import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const samples = {
  flow: `flowchart LR
    A[开始] -->|提交申请| B[审批]
    B --> C[完成]`,
  custom: `flowchart LR
    A[原始指定深色文字] -->|低对比连线| B[保留紫色背景]
    classDef custom fill:#E4DFEC,stroke:#8064A2,color:#E4DFEC,font-size:14px;
    class A,B custom;
    linkStyle default stroke:#20212a,stroke-width:2px;`,
  clusters: `flowchart LR
    subgraph GROUP["源码指定浅色分组"]
      A[提交] -->|分组内连线标签| B[审批]
    end
    B -->|深色画布上的标签| C[完成]
    style GROUP fill:#ffffde,stroke:#aaaa33,stroke-width:1px;`,
  sequence: `sequenceDiagram
    participant A as 用户
    participant B as 服务
    A->>B: 提交申请
    rect rgb(240,248,255)
      B-->>A: 浅色高亮区域内的回复
    end
    B-->>A: 正常回复`,
  class: `classDiagram
    class 用户 {
      +String 姓名
      +提交申请()
    }
    用户 --> 服务`,
  state: `stateDiagram-v2
    [*] --> 待审批
    待审批 --> 已完成: 审批通过
    已完成 --> [*]`,
  er: `erDiagram
    USER ||--o{ REQUEST : creates
    USER { string name }
    REQUEST { string status }`,
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  await mkdir(".codex", { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.route("**/mermaid-contrast-test", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }));
  await page.goto(`${process.env.TEST_BASE_URL || "http://127.0.0.1:1420"}/mermaid-contrast-test`);
  for (const dark of [false, true]) {
    for (const [name, source] of Object.entries(samples)) {
      const result = await page.evaluate(async ({ source, dark }) => {
        const { renderMermaid } = await import("/src/lib/mermaid.ts");
        document.body.style.background = dark ? "#202124" : "#ffffff";
        document.body.innerHTML = (await renderMermaid(source, dark)).svg;
        const root = document.querySelector("svg");
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        const rgb = color => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const ratio = (a, b) => {
          const lum = a => a.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((v, c, i) => v + c * [.2126, .7152, .0722][i], 0);
          return (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
        };
        const background = dark ? [32, 33, 36] : [255, 255, 255];
        const shapes = [...root.querySelectorAll("rect,polygon,circle,ellipse,path")].filter(el => {
          const fill = getComputedStyle(el).fill; return fill !== "none" && rgb(fill)[3] > 0;
        });
        const text = [...root.querySelectorAll("text,tspan,.nodeLabel p")].filter(el => el.textContent.trim()).map(el => {
          const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
          let bg = background;
          for (const shape of shapes) {
            const rect = shape.getBoundingClientRect();
            if (!rect.width || !rect.height || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
            const style = getComputedStyle(shape), color = rgb(style.fill), alpha = color[3] / 255 * Number(style.opacity) * Number(style.fillOpacity);
            bg = bg.map((v, i) => color[i] * alpha + v * (1 - alpha));
          }
          const color = getComputedStyle(el).getPropertyValue(el.matches("text,tspan") ? "fill" : "color");
          return { text: el.textContent, ratio: color === "none" ? 21 : ratio(rgb(color), bg) };
        });
        const lines = [...root.querySelectorAll(".flowchart-link,.edgePath path,.relation,.messageLine0,.messageLine1,.actor-line,.transition,.relationshipLine")].map(el => {
          const color = getComputedStyle(el).stroke;
          const bounds = el.getBoundingClientRect();
          const surfaces = [background, ...shapes.filter(shape => {
            const b = shape.getBoundingClientRect();
            return b.width && b.height && b.right >= bounds.left && b.left <= bounds.right && b.bottom >= bounds.top && b.top <= bounds.bottom;
          }).map(shape => rgb(getComputedStyle(shape).fill))];
          return color === "none" ? 21 : Math.min(...surfaces.map(bg => ratio(rgb(color), bg)));
        });
        return { text, lines, fills: [...root.querySelectorAll(".node rect,.node path")].map(el => getComputedStyle(el).fill) };
      }, { source, dark });
      assert.ok(result.text.length > 0, `${name}: no labels`);
      assert.ok(result.text.every(label => label.ratio >= 4.45), `${name}/${dark}: unreadable text ${JSON.stringify(result.text.filter(label => label.ratio < 4.45))}`);
      assert.ok(result.lines.every(ratio => ratio >= 2.95), `${name}/${dark}: unreadable lines ${result.lines}`);
      if (name === "custom") assert.ok(result.fills.includes("rgb(228, 223, 236)"), "preserve the source's semantic fill");
      await page.locator("svg").screenshot({ path: `.codex/mermaid-native-${name}-${dark ? "dark" : "light"}.png` });
    }
  }
  const concurrent = await page.evaluate(async () => {
    const { renderMermaid } = await import("/src/lib/mermaid.ts");
    const source = "flowchart LR\nLIGHT[并发主题检查] --> END[结束]";
    const renders = await Promise.all([renderMermaid(source, false), renderMermaid(source, true)]);
    return renders.map(render => {
      const host = document.createElement("div"); host.innerHTML = render.svg; document.body.append(host);
      const shape = [...host.querySelectorAll(".node rect,.node path")].find(shape => getComputedStyle(shape).fill !== "none");
      const fill = getComputedStyle(shape).fill;
      host.remove();
      return fill;
    });
  });
  assert.notEqual(concurrent[0], concurrent[1], "concurrent preview/export must retain their own light/dark theme");
  console.log("PASS: native light/dark flowcharts, custom colors, sequence highlights, class/state/ER diagrams have readable text and connectors.");
} finally {
  await browser.close();
}


