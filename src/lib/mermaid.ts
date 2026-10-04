import { calculateRasterSize, svgDataUrl } from "./svg-image.ts";

/**
 * Mermaid 渲染服务。
 *
 * 编辑器装饰层、Word 预览、DOCX 导出三处都要拿同一张图，所以渲染、缓存、
 * 栅格化都收在这里。mermaid 本体约 500KB，用动态 import 让它只在文档里
 * 真的出现 mermaid 代码块时才下载。
 */

type RenderResult = { svg: string; width: number; height: number };

const svgCache = new Map<string, RenderResult>();
const pngCache = new Map<string, string>();
/** 同一段源码并发渲染时共用一个 promise，避免重复初始化 mermaid。 */
const inflight = new Map<string, Promise<RenderResult>>();

let mermaidReady: Promise<typeof import("mermaid").default> | undefined;
let currentTheme: "default" | "dark" = "default";
const MERMAID_FONT_FAMILY = "Microsoft YaHei, Segoe UI Emoji, sans-serif";
const MERMAID_FONT_SIZE = 14;
const MERMAID_LABEL_WRAP_WIDTH = 240;
const MERMAID_THEME_CSS = `
.nodeLabel {
  display: inline-block;
  max-width: ${MERMAID_LABEL_WRAP_WIDTH}px;
  white-space: normal !important;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.25;
  text-align: center;
}
.nodeLabel p { margin: 0; }
.cluster-label { padding-bottom: 8px; }
.cluster-label .nodeLabel { max-width: 480px; font-weight: 600; line-height: 1.35; }
/* 类图方法与属性列表：单行完整舒展展现，不限宽度、不折行，左对齐展示代码签名 */
g.classGroup .nodeLabel,
.node[id*="classId-"] .nodeLabel,
g.classGroup div,
.node[id*="classId-"] div,
g.classGroup span,
.node[id*="classId-"] span,
g.classGroup p,
.node[id*="classId-"] p {
  max-width: none !important;
  white-space: nowrap !important;
  text-align: left !important;
  overflow-wrap: normal !important;
  word-break: normal !important;
}
/* 类名标题保持居中加粗 */
g.classGroup .classTitle .nodeLabel,
.node[id*="classId-"] .classTitle .nodeLabel,
.classTitle,
.classTitleText {
  text-align: center !important;
}
/* 连线标签只显示文字，不绘制 Mermaid 默认的背景块。 */
.edgeLabel,
.edgeLabel *,
.edgeLabel p,
.edgeLabel span,
.edgeLabel foreignObject,
.edgeLabel foreignObject > div { background: transparent !important; background-color: transparent !important; }
.edgeLabel rect { fill: transparent !important; stroke: none !important; }
.edgeLabel, .edgeLabel * { text-shadow: none !important; }
.edgeLabel text, .edgeLabel tspan { paint-order: normal; stroke: none !important; }
/* 连线标签文字长时自动折行，避免被 foreignObject 默认单行截断 */
.edgeLabel,
.labelBkg,
.edgeLabel p,
.edgeLabel span,
.edgeLabel div,
.edgeLabel foreignObject > div {
  white-space: normal !important;
  overflow-wrap: anywhere !important;
  word-break: break-word !important;
  line-height: 1.35 !important;
  text-align: center !important;
}
.edgeLabel foreignObject {
  overflow: visible !important;
}
/* 状态图 (State Diagram) 连线与箭头统一使用琥珀主橙色 #f59e0b */
.transition,
path.transition,
.edgePaths .transition,
.statediagram-state line,
g.stateGroup line {
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
  fill: none !important;
}
defs [id*="barbEnd"],
[id*="barbEnd"] path,
marker[id*="barbEnd"] path,
[id$="-barbEnd"],
[id$="-barbEnd"] path {
  fill: #f59e0b !important;
  stroke: #f59e0b !important;
}
.node circle.state-start,
circle.state-start,
.node .fork-join,
rect.fork-join {
  fill: #f59e0b !important;
  stroke: #f59e0b !important;
}
`;

function mermaidConfig(theme: "default" | "dark") {
  const isDark = theme === "dark";
  return {
    startOnLoad: false,
    theme: "default" as const,
    securityLevel: "strict" as const,
    htmlLabels: true,
    fontFamily: MERMAID_FONT_FAMILY,
    fontSize: MERMAID_FONT_SIZE,
    markdownAutoWrap: true,
    themeVariables: {
      fontSize: `${MERMAID_FONT_SIZE}px`,
      fontFamily: MERMAID_FONT_FAMILY,
      // 深浅色模式使用完全相同的核心主橙色 #f59e0b
      lineColor: "#f59e0b",
      primaryBorderColor: "#f59e0b",
      nodeBorder: "#f59e0b",
      actorBorder: "#f59e0b",
      actorLineColor: "#f59e0b",
      signalColor: "#f59e0b",
      labelBoxBorderColor: "#f59e0b",
      loopLineColor: "#f59e0b",
      noteBorderColor: "#f59e0b",
      sequenceNumberColor: isDark ? "#fef3c7" : "#1c1917",
      // 方块填充：浅色模式 #fef3c7（正宗浅橙金色），深色模式 #382613（深黑棕夜光底）
      primaryColor: isDark ? "#382613" : "#fef3c7",
      actorBkg: isDark ? "#382613" : "#fef3c7",
      labelBoxBkgColor: isDark ? "#382613" : "#fef3c7",
      mainBkg: isDark ? "#382613" : "#fef3c7",
      // 容器背景与便签背景
      secondaryColor: isDark ? "#292015" : "#fffbeb",
      tertiaryColor: isDark ? "#261e14" : "#fffbeb",
      noteBkgColor: isDark ? "#292015" : "#fffbeb",
      // 文本颜色
      primaryTextColor: isDark ? "#fef3c7" : "#1c1917",
      actorTextColor: isDark ? "#fef3c7" : "#1c1917",
      signalTextColor: isDark ? "#fef3c7" : "#1c1917",
      labelTextColor: isDark ? "#fef3c7" : "#78350f",
      loopTextColor: isDark ? "#fef3c7" : "#78350f",
      noteTextColor: isDark ? "#fef3c7" : "#1c1917",
    },
    themeCSS: MERMAID_THEME_CSS + (isDark ? `
/* ====== 深色模式：暖金/琥珀夜光体系 ====== */
/* 流程图子图（Cluster）容器与标题 */
.cluster rect {
  fill: #261e14 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
  rx: 6px !important;
  ry: 6px !important;
}
.cluster-label text, .cluster-label span, .cluster-label .nodeLabel {
  fill: #fde68a !important;
  color: #fde68a !important;
  font-weight: 600 !important;
}

/* 流程图节点小方块（矩形、多边形/菱形、圆形等） */
.node[id*="-flowchart-"] rect,
.node[id*="-flowchart-"] polygon,
.node[id*="-flowchart-"] circle,
.node[id*="-flowchart-"] ellipse,
.node[id*="-flowchart-"] path {
  fill: #382613 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.node .nodeLabel,
.node text,
.node span {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
}

/* 连线与连线标签 */
.relation, .edgePath .path {
  stroke: #f59e0b !important;
}
[id$="-arrowhead"] path:not([fill]):not([style*="fill"]),
[id$="-crosshead"] path:not([fill]):not([style*="fill"]),
marker path:not([fill]):not([style*="fill"]) {
  fill: #f59e0b !important;
  stroke: #f59e0b !important;
}
.edgeLabel text, .edgeLabel span {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
}

/* 时序图 (Sequence Diagram) */
rect.actor, rect[class*="actor"], .actor rect {
  fill: #382613 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
text.actor, text[class*="actor"], .actor text, .actor tspan {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
  stroke: none !important;
}
.actor-man line, line.actor-man {
  stroke: #f59e0b !important;
  stroke-width: 2px !important;
}
.actor-man circle, circle.actor-man {
  stroke: #f59e0b !important;
  stroke-width: 2px !important;
  fill: #382613 !important;
}
.actor-line {
  stroke: #f59e0b !important;
}
.messageText {
  fill: #fef3c7 !important;
}
.messageLine0, .messageLine1 {
  stroke: #f59e0b !important;
}
.note {
  fill: #292015 !important;
  stroke: #f59e0b !important;
}
.noteText, .noteText tspan {
  fill: #fef3c7 !important;
}
/* 时序图 alt/loop 条件框体与其文字 */
.labelBox {
  fill: #382613 !important;
  stroke: #f59e0b !important;
}
.labelText, .loopText, .loopText tspan {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
  font-weight: 600 !important;
}
.sectionTitle, .sectionTitle text {
  fill: #fde68a !important;
  color: #fde68a !important;
  font-weight: 600 !important;
}
.loopLine {
  stroke: #f59e0b !important;
}
/* 时序图 autonumber 序号圆点与文字：紧凑精致，文字清晰不模糊，完美垂直居中 */
[id$="-sequencenumber"] circle, marker[id*="sequencenumber"] circle {
  r: 7.5px !important;
  fill: #382613 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.2px !important;
}
.sequenceNumber {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
  font-weight: 700 !important;
  font-size: 11px !important;
  dominant-baseline: central !important;
  text-anchor: middle !important;
}

/* 状态图 (State Diagram) */
.statediagram-state rect {
  fill: #382613 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.statediagram-cluster rect,
.statediagram-cluster rect.outer {
  fill: #261e14 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.statediagram-cluster .inner {
  fill: #1c150e !important;
}
.node circle.state-end {
  fill: #261e14 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.end-state-inner {
  fill: #f59e0b !important;
  stroke: none !important;
}
.state-title,
.transitionLabel,
.state-note,
.statediagram-state text,
.statediagram-note text,
.state-title text,
.stateLabel text,
.statediagram .edgeLabel {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
}
.statediagram-note rect {
  fill: #292015 !important;
  stroke: #f59e0b !important;
}

/* 类图与 ER 图 */
.classTitle text { fill: #fef3c7 !important; }
.relationLabel { fill: #fef3c7 !important; }
.node[id*="classId-"] .outer-path path:first-child,
g.classGroup rect,
.node[id*="classId-"] rect {
  fill: #382613 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
g.classGroup line, .node[id*="classId-"] line, .divider {
  stroke: #f59e0b !important;
  stroke-width: 1px !important;
}
g.classGroup text, g.classGroup span, .node[id*="classId-"] text, .node[id*="classId-"] span {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
}
.er.entityBox { fill: #382613 !important; stroke: #f59e0b !important; }
.er.attributeBoxOdd { fill: #261e14 !important; }
.er.attributeBoxEven { fill: #382613 !important; }
.er.entityBox text, .er.attributeBoxOdd text, .er.attributeBoxEven text, .er.relationshipLabel text {
  fill: #fef3c7 !important;
}
.er.relationshipLine { stroke: #f59e0b !important; }
` : `
/* ====== 浅色模式：暖金/琥珀日间体系 ====== */
/* 流程图子图（Cluster）容器与标题 */
.cluster rect {
  fill: #fffbeb !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
  rx: 6px !important;
  ry: 6px !important;
}
.cluster-label text, .cluster-label span, .cluster-label .nodeLabel {
  fill: #78350f !important;
  color: #78350f !important;
  font-weight: 600 !important;
}

/* 流程图节点小方块（矩形、多边形/菱形、圆形等）：边框纯正橙色，中间浅一点的橙色 */
.node[id*="-flowchart-"] rect,
.node[id*="-flowchart-"] polygon,
.node[id*="-flowchart-"] circle,
.node[id*="-flowchart-"] ellipse,
.node[id*="-flowchart-"] path {
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.node .nodeLabel,
.node text,
.node span {
  fill: #1c1917 !important;
  color: #1c1917 !important;
}

/* 连线与连线标签 */
.relation, .edgePath .path {
  stroke: #f59e0b !important;
}
[id$="-arrowhead"] path:not([fill]):not([style*="fill"]),
[id$="-crosshead"] path:not([fill]):not([style*="fill"]),
marker path:not([fill]):not([style*="fill"]) {
  fill: #f59e0b !important;
  stroke: #f59e0b !important;
}
.edgeLabel text, .edgeLabel span {
  fill: #1c1917 !important;
  color: #1c1917 !important;
}

/* 时序图 (Sequence Diagram)：方块边框纯正橙色，中间浅一点的橙色 */
rect.actor, rect[class*="actor"], .actor rect {
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
text.actor, text[class*="actor"], .actor text, .actor tspan {
  fill: #1c1917 !important;
  color: #1c1917 !important;
  stroke: none !important;
}
.actor-man line, line.actor-man {
  stroke: #f59e0b !important;
  stroke-width: 2px !important;
}
.actor-man circle, circle.actor-man {
  stroke: #f59e0b !important;
  stroke-width: 2px !important;
  fill: #fef3c7 !important;
}
.actor-line {
  stroke: #f59e0b !important;
}
.messageText {
  fill: #1c1917 !important;
}
.messageLine0, .messageLine1 {
  stroke: #f59e0b !important;
}
.note {
  fill: #fffbeb !important;
  stroke: #f59e0b !important;
}
.noteText, .noteText tspan {
  fill: #1c1917 !important;
}
/* 时序图 alt/loop 条件框体与其文字 */
.labelBox {
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
}
.labelText, .loopText, .loopText tspan {
  fill: #78350f !important;
  color: #78350f !important;
  font-weight: 600 !important;
}
.sectionTitle, .sectionTitle text {
  fill: #78350f !important;
  color: #78350f !important;
  font-weight: 600 !important;
}
.loopLine {
  stroke: #f59e0b !important;
}
/* 时序图 autonumber 序号圆点与文字：紧凑精致，文字清晰不模糊，完美垂直居中 */
[id$="-sequencenumber"] circle, marker[id*="sequencenumber"] circle {
  r: 7.5px !important;
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.2px !important;
}
.sequenceNumber {
  fill: #1c1917 !important;
  color: #1c1917 !important;
  font-weight: 700 !important;
  font-size: 11px !important;
  dominant-baseline: central !important;
  text-anchor: middle !important;
}

/* 状态图 (State Diagram) */
.statediagram-state rect {
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.statediagram-cluster rect,
.statediagram-cluster rect.outer {
  fill: #fffbeb !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.statediagram-cluster .inner {
  fill: #fef3c7 !important;
}
.node circle.state-end {
  fill: #fffbeb !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.end-state-inner {
  fill: #f59e0b !important;
  stroke: none !important;
}
.state-title,
.transitionLabel,
.state-note,
.statediagram-state text,
.statediagram-note text,
.state-title text,
.stateLabel text,
.statediagram .edgeLabel {
  fill: #1c1917 !important;
  color: #1c1917 !important;
}
.statediagram-note rect {
  fill: #fffbeb !important;
  stroke: #f59e0b !important;
}

/* 类图与 ER 图 */
.classTitle text { fill: #1c1917 !important; }
.relationLabel { fill: #1c1917 !important; }
.node[id*="classId-"] .outer-path path:first-child,
g.classGroup rect,
.node[id*="classId-"] rect {
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
g.classGroup line, .node[id*="classId-"] line, .divider {
  stroke: #f59e0b !important;
  stroke-width: 1px !important;
}
g.classGroup text, g.classGroup span, .node[id*="classId-"] text, .node[id*="classId-"] span {
  fill: #1c1917 !important;
  color: #1c1917 !important;
}
.er.entityBox { fill: #fef3c7 !important; stroke: #f59e0b !important; }
.er.attributeBoxOdd { fill: #fffbeb !important; }
.er.attributeBoxEven { fill: #fef3c7 !important; }
.er.entityBox text, .er.attributeBoxOdd text, .er.attributeBoxEven text, .er.relationshipLabel text {
  fill: #1c1917 !important;
}
.er.relationshipLine { stroke: #f59e0b !important; }
`),
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
      wrappingWidth: MERMAID_LABEL_WRAP_WIDTH,
      nodeSpacing: 50,
      rankSpacing: 60,
      padding: 24,
      subGraphTitleMargin: { top: 16, bottom: 32 },
      curve: "basis" as const,
    },
  };
}

async function loadMermaid(dark: boolean) {
  const wanted = dark ? "dark" : "default";
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize(mermaidConfig(wanted));
      currentTheme = wanted;
      return mermaid;
    });
  }

  const mermaid = await mermaidReady;
  if (currentTheme !== wanted) {
    // 主题变了要重新初始化 mermaid 引擎，但保留已有的 svgCache 和 pngCache：
    // cacheKey 已经由 "d:" / "l:" 天然区分深浅色，保留缓存可让用户来回切换深浅色时瞬间秒开，
    // 彻底避免图表高度瞬间坍缩导致页面滚动位置丢失。
    mermaid.initialize(mermaidConfig(wanted));
    currentTheme = wanted;
  }
  return mermaid;
}

/**
 * 对用户输入的 Mermaid 源码做方向与格式的轻量容错归一化：
 * 1. 容错方向小写：Mermaid 官方 lexer 仅识别大写 LR/RL/TB/TD/BT，
 *    用户手打小写 "flowchart lr"、"graph tb" 或 "direction lr" 时自动归一为大写，
 *    彻底避免因大小写敏感导致解析失败或方向失灵。
 */
export function normalizeMermaidSource(source: string): string {
  let s = source.trim();
  s = s.replace(/^([ \t]*(?:flowchart|graph))[ \t]+(lr|rl|tb|td|bt)\b/im, (_m, prefix, dir) => {
    return `${prefix} ${dir.toUpperCase()}`;
  });
  s = s.replace(/^([ \t]*direction)[ \t]+(lr|rl|tb|td|bt)\b/gim, (_m, prefix, dir) => {
    return `${prefix} ${dir.toUpperCase()}`;
  });
  return s;
}

function cacheKey(source: string, dark: boolean) {
  return `${dark ? "d" : "l"}:${source}`;
}

let renderSeq = 0;

/** 读缓存，命中时调用方可以同步拿到图，避免闪一下空白再出现。 */
export function getCachedMermaidSvg(source: string, dark: boolean): RenderResult | undefined {
  return svgCache.get(cacheKey(normalizeMermaidSource(source), dark));
}

export async function renderMermaid(source: string, dark: boolean): Promise<RenderResult> {
  const normalized = normalizeMermaidSource(source);
  const key = cacheKey(normalized, dark);

  const cached = svgCache.get(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const mermaid = await loadMermaid(dark);
    renderSeq += 1;
    // id 必须唯一：mermaid 会用它做 DOM 元素 id 和 SVG 内部的 clip-path 引用，
    // 重复 id 会让同一页里的多张图互相串。
    const { svg } = await mermaid.render(`mk-mermaid-${renderSeq}`, normalized);
    const size = measureSvg(svg);
    const result = { svg: readableEdgeLabels(svg, size, dark), ...size };
    svgCache.set(key, result);
    return result;
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

/** 标签背景透明后，要按标签实际落点的底色选字色，而不是对整张图强制白字。 */
function readableEdgeLabels(svg: string, size: { width: number; height: number }, dark: boolean): string {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none";
  host.innerHTML = svg;
  const root = host.querySelector("svg")!;
  const originalSize = [root.getAttribute("width"), root.getAttribute("height")];
  root.setAttribute("width", String(size.width));
  root.setAttribute("height", String(size.height));
  document.body.append(host);
  try {
    // 同级分组按 SVG 绘制顺序覆盖；嵌套分组会覆盖外层分组底色。
    const clusters = Array.from(root.querySelectorAll<SVGRectElement>(".cluster > rect")).map((rect) => ({
      bounds: rect.getBoundingClientRect(), style: getComputedStyle(rect),
    }));
    for (const label of root.querySelectorAll<SVGGElement>("g.edgeLabel")) {
      const bounds = label.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      let rgb = dark ? [24, 24, 27] : [255, 255, 255];
      for (const cluster of clusters) {
        const b = cluster.bounds;
        if (x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
        const channels = cluster.style.fill.match(/[\d.]+/g)?.map(Number);
        if (!channels || channels.length < 3) continue; // fill:none 不覆盖画布
        const alpha = (channels[3] ?? 1) * Number(cluster.style.fillOpacity) * Number(cluster.style.opacity);
        rgb = rgb.map((channel, i) => channels[i] * alpha + channel * (1 - alpha));
      }
      const linear = rgb.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      const color = (luminance + 0.05) / 0.066 > 1.05 / (luminance + 0.05) ? "#1c1917" : "#fef3c7";
      const background = `rgb(${rgb.map((channel) => Math.round(channel)).join(", ")})`;
      // 内联到文字本身，SVG 单独展示和 PNG 栅格化时也能保留，不依赖页面 CSS。
      for (const element of [label, ...label.querySelectorAll<SVGElement | HTMLElement>("div,span,p,text,tspan")]) {
        element.style.setProperty("color", color, "important");
        if (element.matches("text,tspan")) {
          element.style.setProperty("fill", color, "important");
          element.style.setProperty("stroke", background, "important");
          element.style.setProperty("stroke-width", "3px", "important");
          element.style.setProperty("paint-order", "stroke", "important");
        } else if (element.matches("div,span,p")) {
          element.style.setProperty("white-space", "normal", "important");
          element.style.setProperty("overflow-wrap", "anywhere", "important");
          element.style.setProperty("word-break", "break-word", "important");
          element.style.setProperty("line-height", "1.35", "important");
          element.style.setProperty("text-align", "center", "important");
          // foreignObject 文本没有 SVG stroke，用同色文字描边擦掉连线。
          element.style.setProperty("text-shadow", `1.5px 0 ${background}, -1.5px 0 ${background}, 0 1.5px ${background}, 0 -1.5px ${background}`, "important");
        }
      }

      // 如果连线标签内容较长发生换行，自动扩展 foreignObject 高度并向上补偿偏移以保持居中，避免文字被溢出切断
      for (const fo of label.querySelectorAll<SVGForeignObjectElement>("foreignObject")) {
        fo.style.setProperty("overflow", "visible", "important");
        const div = fo.querySelector<HTMLElement>("div, span, p");
        if (div) {
          const neededHeight = Math.ceil(div.scrollHeight);
          const currentHeight = parseFloat(fo.getAttribute("height") || "0");
          if (neededHeight > currentHeight && neededHeight > 0) {
            fo.setAttribute("height", String(neededHeight));
            const deltaY = (neededHeight - currentHeight) / 2;
            const foY = parseFloat(fo.getAttribute("y") || "0");
            fo.setAttribute("y", String(foY - deltaY));
          }
        }
      }
    }

    // 时序图 autonumber 序号文字垂直居中校准：消除 Mermaid 原生硬编码的 y 偏移，绝对对齐圆球中心
    for (const seq of root.querySelectorAll<SVGTextElement>(".sequenceNumber, text[class*='sequenceNumber']")) {
      const currentY = parseFloat(seq.getAttribute("y") || "0");
      if (currentY) {
        seq.setAttribute("y", String(currentY - 4.5));
      }
      seq.style.setProperty("dominant-baseline", "central", "important");
      seq.style.setProperty("text-anchor", "middle", "important");
      seq.style.setProperty("font-size", "11px", "important");
      seq.style.setProperty("font-weight", "700", "important");
      if (dark) {
        seq.style.setProperty("fill", "#fef3c7", "important");
        seq.style.setProperty("color", "#fef3c7", "important");
      }
    }

    // 自定义颜色方块深色模式自适应：保留用户自定义边框颜色，背景色自适应为对应同色系的暗夜微透底色
    if (dark) {
      for (const node of root.querySelectorAll<SVGGElement>(".node")) {
        const shapes = node.querySelectorAll<SVGElement>("rect, polygon, circle, ellipse, path");
        for (const shape of shapes) {
          const styleAttr = shape.getAttribute("style") || "";
          const fillMatch = styleAttr.match(/(?:^|;)\s*fill\s*:\s*([^;!]+)/i);
          const strokeMatch = styleAttr.match(/(?:^|;)\s*stroke\s*:\s*([^;!]+)/i);
          const inlineFill = fillMatch?.[1]?.trim() || shape.getAttribute("fill");
          const inlineStroke = strokeMatch?.[1]?.trim() || shape.getAttribute("stroke");

          if (inlineFill && inlineFill !== "none" && inlineFill !== "transparent") {
            const strokeColor = inlineStroke && inlineStroke !== "none" && inlineStroke !== "transparent" ? inlineStroke : inlineFill;
            shape.style.setProperty("stroke", strokeColor, "important");
            shape.style.setProperty("stroke-width", "2px", "important");
            shape.style.setProperty("fill", `color-mix(in srgb, ${strokeColor} 20%, #202020)`, "important");
            for (const textEl of node.querySelectorAll<HTMLElement | SVGElement>("div, span, p, text, tspan")) {
              textEl.style.setProperty("color", "#fef3c7", "important");
              if (textEl.matches("text, tspan")) {
                textEl.style.setProperty("fill", "#fef3c7", "important");
              }
            }
          }
        }
      }
    }

    ["width", "height"].forEach((name, i) => {
      const value = originalSize[i];
      if (value === "100%" || value === null) {
        root.setAttribute(name, String(i === 0 ? size.width : size.height));
      } else {
        root.setAttribute(name, value);
      }
    });
    return root.outerHTML;
  } finally {
    host.remove();
  }
}

/**
 * 从 SVG 文本里读出尺寸。
 *
 * 优先 viewBox：mermaid 输出的 width/height 常常是 `100%`，直接拿去做
 * canvas 尺寸会得到 NaN。支持科学计数法与逗号/空格分隔格式。
 */
export function measureSvg(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/\bviewBox="([^"]+)"/i);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3]) && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const widthMatch = svg.match(/\bwidth="([\d.]+(?:e[+-]?\d+)?)(?:px)?"/i);
  const heightMatch = svg.match(/\bheight="([\d.]+(?:e[+-]?\d+)?)(?:px)?"/i);
  const width = Number(widthMatch?.[1]);
  const height = Number(heightMatch?.[1]);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }

  return { width: 800, height: 400 };
}

/**
 * 把渲染好的 SVG 栅格化成 PNG data URL。
 *
 * DOCX 不支持 SVG——Pandoc 遇到 SVG 会直接跳过那张图，所以导出前必须转成
 * 位图。scale 默认 2 是为了在 Word 里放大看仍然清晰；再高会让文档体积
 * 明显膨胀。
 */
export async function mermaidToPngDataUrl(source: string, dark: boolean, scale = 2): Promise<string> {
  const trimmed = source.trim();
  const key = `${cacheKey(trimmed, dark)}:${scale}`;
  const cached = pngCache.get(key);
  if (cached) return cached;

  const { svg, width, height } = await renderMermaid(trimmed, dark);
  // PNG 导出使用白色画布，不能把深色编辑器画布上的白字直接带过去。
  const dataUrl = await svgToPng(readableEdgeLabels(svg, { width, height }, false), width, height, scale);
  pngCache.set(key, dataUrl);
  return dataUrl;
}

function svgToPng(svg: string, width: number, height: number, scale: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // 走 data URL 而不是 blob URL：blob URL 会让 canvas 被标记成
    // tainted，随后 toDataURL 抛 SecurityError。
    const image = new Image();
    let settled = false;
    let timeout: number | undefined;

    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      reject(cause instanceof Error ? cause : new Error("图表转图片失败"));
    };

    timeout = window.setTimeout(() => fail(new Error("图表转图片超时")), 10_000);

    image.onload = () => {
      if (settled) return;
      if (timeout !== undefined) window.clearTimeout(timeout);
      try {
        const rasterSize = calculateRasterSize(width, height, scale);
        const canvas = document.createElement("canvas");
        canvas.width = rasterSize.width;
        canvas.height = rasterSize.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建画布上下文");

        // 白底：PNG 默认透明，插进 Word 后在深色页面上会看不清线条。
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        if (!dataUrl.startsWith("data:image/png")) throw new Error("浏览器未能生成 PNG 图片");
        settled = true;
        resolve(dataUrl);
      } catch (cause) {
        fail(cause);
      }
    };

    image.onerror = () => fail(new Error("图表 SVG 无法载入"));
    try {
      image.src = svgDataUrl(withExplicitSize(svg, width, height));
    } catch (cause) {
      fail(cause);
    }
  });
}

/**
 * 给 SVG 补上像素尺寸。
 *
 * 浏览器把 `width="100%"` 的 SVG 画进 canvas 时会当成 0 宽，
 * 必须换成具体数值才画得出来。
 */
function withExplicitSize(svg: string, width: number, height: number) {
  let output = svg.replace(/\bwidth="[^"]*"/, `width="${width}"`);
  output = output.replace(/\bheight="[^"]*"/, `height="${height}"`);
  if (!/\bwidth=/.test(output)) {
    output = output.replace(/<svg\b/, `<svg width="${width}" height="${height}"`);
  }
  return output;
}

/** 判断一个代码块的语言标记是不是 mermaid。 */
export function isMermaidLanguage(language: string | undefined) {
  return language?.trim().toLowerCase() === "mermaid";
}
