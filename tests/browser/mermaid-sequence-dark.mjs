import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { contrastRatio } from './contrast-utils.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:1420'}/tests/browser/mermaid-sequence-dark.html`);
  await page.waitForFunction(() => window.result?.svg);
  const result = await page.evaluate(() => {
    const textOnShape = (node, selector) => {
      const box=node.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
      const shape=[...document.querySelectorAll(selector)].find(rect=>{const b=rect.getBoundingClientRect();return x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom;});
      return {text:getComputedStyle(node).fill,background:shape?getComputedStyle(shape).fill:'none'};
    };
    return {
    background: getComputedStyle(document.body).backgroundColor,
    messageText: [...document.querySelectorAll(".messageText")].map((node) => getComputedStyle(node).fill),
    messageLines: [...document.querySelectorAll(".messageLine0, .messageLine1, .actor-line, .innerArc")].map((node) => getComputedStyle(node).stroke),
    arrowheads: [...document.querySelectorAll('[id$="-arrowhead"] path, [id$="-crosshead"] path')].map((node) => ({ fill: getComputedStyle(node).fill, stroke: getComputedStyle(node).stroke })),
    notes: [...document.querySelectorAll(".noteText")].map((node) => textOnShape(node,'rect.note')),
    actorLabels: [...document.querySelectorAll("text.actor tspan")].map((node) => textOnShape(node,'rect.actor')),
  };});
  assert.ok(result.messageText.length >= 6, `expected sequence messages, got ${result.messageText.length}`);
  assert.ok(result.messageText.every((color) => contrastRatio(color,result.background)>=4.5), `message text lacks contrast: ${JSON.stringify(result.messageText)}`);
  assert.ok(result.messageLines.length >= 8, `expected sequence lines, got ${result.messageLines.length}`);
  assert.ok(result.messageLines.every((color) => contrastRatio(color,result.background)>=3), `sequence lines are too dark: ${JSON.stringify(result.messageLines)}`);
  assert.ok(result.arrowheads.length >= 2 && result.arrowheads.every(({ fill, stroke }) => contrastRatio(fill,result.background)>=3 && contrastRatio(stroke,result.background)>=3), `sequence arrows are too dark: ${JSON.stringify(result.arrowheads)}`);
  assert.ok(result.notes.length>=2 && result.notes.every(({text,background}) => contrastRatio(text,background)>=4.5), `note text lacks contrast: ${JSON.stringify(result.notes)}`);
  assert.ok(result.actorLabels.length>=4 && result.actorLabels.every(({text,background}) => contrastRatio(text,background)>=4.5), `actor labels lack contrast: ${JSON.stringify(result.actorLabels)}`);
  await page.locator("#out").screenshot({ path: ".codex/sequence-dark-readable.png" });
  console.log("PASS: dark sequence diagram text, lines and arrows are readable.");
} finally {
  await browser.close();
}
