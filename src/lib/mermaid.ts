import { calculateRasterSize, svgDataUrl } from "@/lib/svg-image";

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
const MERMAID_LABEL_WRAP_WIDTH = 160;
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
.cluster-label .nodeLabel { max-width: 320px; }
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
`;

function mermaidConfig(theme: "default" | "dark") {
  return {
    startOnLoad: false,
    // 保留节点的原始配色，避免 dark 主题把浅色自定义节点的文字改成浅色。
    theme: "default" as const,
    // securityLevel 保持 strict：图里的文本来自用户文档，
    // 放开会让 mermaid 允许内联脚本和外部资源。
    securityLevel: "strict" as const,
    htmlLabels: true,
    fontFamily: MERMAID_FONT_FAMILY,
    fontSize: MERMAID_FONT_SIZE,
    markdownAutoWrap: true,
    themeVariables: {
      fontSize: `${MERMAID_FONT_SIZE}px`,
      ...(theme === "dark" ? { lineColor: "#a1a1aa" } : {}),
    },
    themeCSS: MERMAID_THEME_CSS + (theme === "dark" ? `
.relation { stroke: #a1a1aa !important; }
/* 时序图消息文字、生命线和箭头使用浅灰，避免深色模式下默认 #333 隐入背景。 */
.messageText { fill: #d4d4d8 !important; }
.messageLine0, .messageLine1, .actor-line, .innerArc { stroke: #a1a1aa !important; }
.messageLine0, .messageLine1 { fill: none !important; }
[id$="-arrowhead"] path, [id$="-crosshead"] path { fill: #d4d4d8 !important; stroke: #d4d4d8 !important; }
/* classDiagram 的默认节点略微加深紫色，避免深色背景下发白；文字仍保持深色对比度。 */
.node[id*="classId-"] .outer-path path:first-child { fill: #ccd2f2 !important; }
/* flowchart 的矩形/菱形节点使用同一套浅蓝紫色，避免深色模式出现白色卡片。 */
.node[id*="-flowchart-"] rect,
.node[id*="-flowchart-"] polygon { fill: #ccd2f2 !important; }
` : ""),
    flowchart: {
      htmlLabels: true,
      useMaxWidth: false,
      wrappingWidth: MERMAID_LABEL_WRAP_WIDTH,
      nodeSpacing: 40,
      rankSpacing: 40,
      padding: 8,
      subGraphTitleMargin: { top: 8, bottom: 16 },
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
    // 主题变了要重新初始化并清缓存，否则深色模式下拿到的还是浅色图。
    mermaid.initialize(mermaidConfig(wanted));
    currentTheme = wanted;
    svgCache.clear();
    pngCache.clear();
  }
  return mermaid;
}

function cacheKey(source: string, dark: boolean) {
  return `${dark ? "d" : "l"}:${source}`;
}

let renderSeq = 0;

/** 读缓存，命中时调用方可以同步拿到图，避免闪一下空白再出现。 */
export function getCachedMermaidSvg(source: string, dark: boolean): RenderResult | undefined {
  return svgCache.get(cacheKey(source.trim(), dark));
}

export async function renderMermaid(source: string, dark: boolean): Promise<RenderResult> {
  const trimmed = source.trim();
  const key = cacheKey(trimmed, dark);

  const cached = svgCache.get(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const mermaid = await loadMermaid(dark);
    renderSeq += 1;
    // id 必须唯一：mermaid 会用它做 DOM 元素 id 和 SVG 内部的 clip-path 引用，
    // 重复 id 会让同一页里的多张图互相串。
    const { svg } = await mermaid.render(`mk-mermaid-${renderSeq}`, trimmed);
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
      let rgb = dark ? [34, 34, 34] : [255, 255, 255];
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
      const color = (luminance + 0.05) / 0.066 > 1.05 / (luminance + 0.05) ? "#222222" : "#ffffff";
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
          // foreignObject 文本没有 SVG stroke，用同色文字描边擦掉连线。
          element.style.setProperty("text-shadow", `1.5px 0 ${background}, -1.5px 0 ${background}, 0 1.5px ${background}, 0 -1.5px ${background}`, "important");
        }
      }
    }
    ["width", "height"].forEach((name, i) => {
      const value = originalSize[i];
      if (value === null) root.removeAttribute(name);
      else root.setAttribute(name, value);
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
 * canvas 尺寸会得到 NaN。
 */
function measureSvg(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/viewBox="([\d.\-\s]+)"/);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const width = Number(svg.match(/\bwidth="(\d+(?:\.\d+)?)"/)?.[1]);
  const height = Number(svg.match(/\bheight="(\d+(?:\.\d+)?)"/)?.[1]);
  if (width > 0 && height > 0) return { width, height };

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
