import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto("http://127.0.0.1:1420/tests/browser/mermaid-dark.html");
  await page.waitForFunction(() => window.result?.svg);
  const result = await page.evaluate(() => ({
    labels: [...document.querySelectorAll(".edgeLabel")]
      .filter((node) => node.querySelector(".labelBkg"))
      .map((node) => {
        const label = node.querySelector(".labelBkg");
        return { color: getComputedStyle(label).color, background: getComputedStyle(label).backgroundColor };
      }),
    nodeFill: getComputedStyle(document.querySelector('.node[id*="classId-"] .outer-path path')).fill,
  }));
  if (result.labels.length !== 5) throw new Error(`expected 5 edge labels, got ${result.labels.length}`);
  if (result.labels.some(({ color, background }) => color !== "rgb(244, 244, 245)" || background !== "rgb(39, 39, 42)")) {
    throw new Error(`dark edge-label styles are not applied: ${JSON.stringify(result.labels)}`);
  }
  if (result.nodeFill !== "rgb(204, 210, 242)") throw new Error(`unexpected class node fill: ${result.nodeFill}`);
  await page.goto("http://127.0.0.1:1420/tests/browser/mermaid-flow-dark.html");
  await page.waitForFunction(() => window.result?.svg);
  const flowFill = await page.evaluate(() => getComputedStyle(document.querySelector('.node[id*="-flowchart-"] rect.basic')).fill);
  if (flowFill !== "rgb(204, 210, 242)") throw new Error(`unexpected flowchart node fill: ${flowFill}`);
  const flowLayout = await page.evaluate(() => [["G1", "H1"], ["G2", "S1"], ["G3", "N1"]].map(([group, nodeId]) => {
    const cluster = document.getElementById(`mk-mermaid-1-${group}`);
    const label = cluster?.querySelector(".cluster-label")?.getBoundingClientRect();
    const node = document.querySelector(`[id*="-flowchart-${nodeId}-"]`)?.getBoundingClientRect();
    return { group, labelBottom: label?.bottom, nodeTop: node?.top };
  }));
  if (flowLayout.some(({ labelBottom, nodeTop }) => labelBottom == null || nodeTop == null || labelBottom > nodeTop)) {
    throw new Error(`subgraph title overlaps node: ${JSON.stringify(flowLayout)}`);
  }
  console.log("PASS: dark Mermaid edge labels and relationship lines are readable.");
} finally {
  await browser.close();
}
