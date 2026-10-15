// Shared by the editor and the headless Word/quick-paste renderer.
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
`;

const MERMAID_THEMES = [
  ["redux-color", "Redux Color"], ["redux-dark-color", "Redux Dark Color"],
  ["redux", "Redux"], ["redux-dark", "Redux Dark"],
  ["neo", "Neo"], ["neo-dark", "Neo Dark"],
  ["default", "Default"], ["dark", "Dark"],
  ["forest", "Forest"], ["neutral", "Neutral"], ["base", "Base"],
].map(([id, label]) => ({ id, label }));

const MERMAID_DIAGRAM_TYPES = [
  ["flowchart", "流程图"], ["state", "状态图"], ["sequence", "时序图"],
  ["class", "类图"], ["er", "实体关系图"], ["mindmap", "思维导图"],
  ["gantt", "甘特图"], ["pie", "饼图"], ["journey", "用户旅程图"],
  ["gitGraph", "Git 分支图"], ["timeline", "时间线"], ["quadrant", "象限图"],
  ["xychart", "XY 图"], ["requirement", "需求图"], ["block", "块图"],
  ["packet", "数据包图"], ["architecture", "架构图"], ["kanban", "看板"],
  ["sankey", "桑基图"], ["radar", "雷达图"], ["treemap", "矩形树图"],
  ["c4", "C4 架构图"], ["info", "引擎信息"],
].map(([id, label]) => ({ id, label }));

function normalizeMermaidSelection(value) {
  const validTheme = id => MERMAID_THEMES.some(theme => theme.id === id);
  const diagrams = {};
  for (const { id } of MERMAID_DIAGRAM_TYPES) {
    const entry = value?.diagrams?.[id];
    const pair = {};
    for (const mode of ["light", "dark"]) {
      if (validTheme(entry?.[mode])) pair[mode] = entry[mode];
    }
    if (Object.keys(pair).length) diagrams[id] = pair;
  }
  return {
    light: validTheme(value?.light) ? value.light : "redux-color",
    dark: validTheme(value?.dark) ? value.dark : "redux-dark-color",
    diagrams,
  };
}

function normalizeMermaidThemes(value) {
  const settings = normalizeMermaidSelection(value);
  const presets = [];
  for (const preset of Array.isArray(value?.presets) ? value.presets : []) {
    const name = typeof preset?.name === "string" ? preset.name.trim() : "";
    if (!name || presets.some(item => item.name === name)) continue;
    presets.push({ name, ...normalizeMermaidSelection(preset) });
  }
  if (presets.length) settings.presets = presets;
  return settings;
}

/** Read the diagram header only; labels, comments and frontmatter must not select a type. */
function mermaidDiagramType(source) {
  const header = source.trim().replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/%%\{[\s\S]*?\}%%/g, "").replace(/^\s*%%[^\n]*(?:\n|$)/gm, "").trim();
  const name = header.match(/^[\w-]+/)?.[0] ?? "";
  if (/^(graph|flowchart)(-elk)?$/.test(name)) return "flowchart";
  if (/^stateDiagram(-v2)?$/.test(name)) return "state";
  if (/^classDiagram(-v2)?$/.test(name)) return "class";
  if (name === "sequenceDiagram") return "sequence";
  if (name === "erDiagram") return "er";
  if (name === "quadrantChart") return "quadrant";
  if (/^requirement(Diagram)?$/.test(name)) return "requirement";
  if (/^C4(Context|Container|Component|Dynamic|Deployment)$/.test(name)) return "c4";
  return name.replace(/-beta$/, "");
}

function resolveMermaidTheme(source, dark, settings) {
  const themes = normalizeMermaidThemes(settings);
  const mode = dark ? "dark" : "light";
  return themes.diagrams[mermaidDiagramType(source)]?.[mode] ?? themes[mode];
}

function mermaidConfig(theme, selectedTheme) {
  const isDark = theme === "dark";
  return {
    startOnLoad: false,
    theme: selectedTheme ?? (isDark ? "redux-dark-color" : "redux-color"),
    look: "neo",
    securityLevel: "strict",
    htmlLabels: true,
    fontFamily: MERMAID_FONT_FAMILY,
    fontSize: MERMAID_FONT_SIZE,
    markdownAutoWrap: true,
    themeVariables: {
      darkMode: isDark,
      background: isDark ? "#202124" : "#ffffff",
      fontSize: `${MERMAID_FONT_SIZE}px`,
      fontFamily: MERMAID_FONT_FAMILY,
    },
    themeCSS: MERMAID_THEME_CSS,
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
      wrappingWidth: MERMAID_LABEL_WRAP_WIDTH,
      nodeSpacing: 50,
      rankSpacing: 60,
      padding: 24,
      subGraphTitleMargin: { top: 16, bottom: 32 },
      curve: "basis",
    },
  };
}

/** Kanban lays out tasks before accounting for the full column heading height. */
function layoutMermaidKanban(root) {
  if (root.getAttribute("aria-roledescription") !== "kanban") return false;
  const columns = [...root.querySelectorAll(".sections > .cluster")].map(group => ({
    rect: group.querySelector("rect"), label: group.querySelector(".cluster-label"),
  })).filter(column => column.rect && column.label);
  if (!columns.length) return false;
  for (const { label } of columns) {
    for (const row of label.querySelectorAll("text,tspan.row")) {
      row.style.setProperty("text-anchor", "middle");
      row.setAttribute("x", "0");
    }
  }
  const headingHeight = Math.max(...columns.map(column => column.label.getBBox().height));
  const items = root.querySelector(".items");
  const firstItemTop = items?.querySelector(".node") ? items.getBBox().y : Infinity;
  for (const { rect, label } of columns) {
    const box = rect.getBBox(), heading = label.getBBox();
    const top = Math.min(box.y, firstItemTop - headingHeight - 24);
    rect.setAttribute("y", String(top));
    rect.setAttribute("height", String(box.height + box.y - top));
    label.setAttribute("transform", `translate(${box.x + (box.width - heading.width) / 2 - heading.x}, ${top + 12 - heading.y})`);
  }
  // Extend upwards without moving or shrinking any task cards.
  const view = root.viewBox.baseVal;
  const top = Math.min(view.y, root.getBBox().y - 16);
  root.setAttribute("viewBox", `${view.x} ${top} ${view.width} ${view.height + view.y - top}`);
  return true;
}

/** Preserve readable, complete relationship labels in both live SVG and Word images. */
function styleMermaidEdgeLabels(root, dark) {
  // 同级分组按 SVG 绘制顺序覆盖；嵌套分组会覆盖外层分组底色。
  const clusters = Array.from(root.querySelectorAll(".cluster > rect")).map((rect) => ({
    bounds: rect.getBoundingClientRect(), style: getComputedStyle(rect),
  }));
  for (const label of root.querySelectorAll("g.edgeLabel")) {
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
    const color = (luminance + 0.05) / 0.066 > 1.05 / (luminance + 0.05) ? "#222222" : "#f5f5f5";
    const background = `rgb(${rgb.map((channel) => Math.round(channel)).join(", ")})`;
    // 内联到文字本身，SVG 单独展示和 PNG 栅格化时也能保留，不依赖页面 CSS。
    for (const element of [label, ...label.querySelectorAll("div,span,p,text,tspan")]) {
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
    for (const fo of label.querySelectorAll("foreignObject")) {
      fo.style.setProperty("overflow", "visible", "important");
      const div = fo.querySelector("div, span, p");
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

}

function contrastRatio(first, second) {
  const luminance = channels => channels.slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Keep semantic fills and readable custom colors; change only low-contrast ink. */
function ensureMermaidContrast(root, dark) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const colors = new Map();
  const rgb = color => {
    if (!colors.has(color)) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      colors.set(color, [...context.getImageData(0, 0, 1, 1).data]);
    }
    return colors.get(color);
  };
  const canvasColor = dark ? [32, 33, 36] : [255, 255, 255];
  const shapes = [...root.querySelectorAll("rect,polygon,circle,ellipse,path")].map(shape => {
    const style = getComputedStyle(shape);
    return { bounds: shape.getBoundingClientRect(), color: style.fill === "none" ? null : rgb(style.fill), opacity: Number(style.opacity) * Number(style.fillOpacity) };
  }).filter(shape => shape.color?.[3] && shape.bounds.width && shape.bounds.height && shape.opacity);
  const backgroundAt = element => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
    let background = canvasColor;
    for (const shape of shapes) {
      const b = shape.bounds;
      if (x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
      const alpha = shape.color[3] / 255 * shape.opacity;
      background = background.map((channel, index) => shape.color[index] * alpha + channel * (1 - alpha));
    }
    return background;
  };
  const readableColor = background => contrastRatio([0, 0, 0], background) > contrastRatio([255, 255, 255], background) ? "#000000" : "#ffffff";
  const readableLineColor = backgrounds => ["#000000", "#ffffff", "#777777"].sort((a, b) =>
    Math.min(...backgrounds.map(background => contrastRatio(rgb(b), background))) - Math.min(...backgrounds.map(background => contrastRatio(rgb(a), background))))[0];
  for (const text of root.querySelectorAll("text,tspan,.nodeLabel,.nodeLabel p,.nodeLabel span")) {
    if (!text.textContent.trim()) continue;
    const property = text.matches("text,tspan") ? "fill" : "color";
    const color = getComputedStyle(text).getPropertyValue(property);
    if (color === "none") continue;
    const background = backgroundAt(text);
    if (contrastRatio(rgb(color), background) >= 4.5) continue;
    text.style.setProperty(property, readableColor(background), "important");
  }
  for (const line of root.querySelectorAll(".flowchart-link,.edgePath path,.relation,.messageLine0,.messageLine1,.actor-line,.transition,.relationshipLine")) {
    const color = getComputedStyle(line).stroke;
    const bounds = line.getBoundingClientRect();
    const backgrounds = [canvasColor, ...shapes.filter(shape => {
      const b = shape.bounds;
      return b.right >= bounds.left && b.left <= bounds.right && b.bottom >= bounds.top && b.top <= bounds.bottom;
    }).map(shape => shape.color)];
    if (color !== "none" && backgrounds.some(background => contrastRatio(rgb(color), background) < 3)) {
      line.style.setProperty("stroke", readableLineColor(backgrounds), "important");
    }
  }
  for (const arrow of root.querySelectorAll("marker path,marker polygon")) {
    for (const property of ["fill", "stroke"]) {
      const color = getComputedStyle(arrow).getPropertyValue(property);
      const backgrounds = [canvasColor, ...shapes.map(shape => shape.color)];
      if (color !== "none" && backgrounds.some(background => contrastRatio(rgb(color), background) < 3)) {
        arrow.style.setProperty(property, readableLineColor(backgrounds), "important");
      }
    }
  }
}

export { mermaidConfig, layoutMermaidKanban, styleMermaidEdgeLabels, ensureMermaidContrast, contrastRatio,
  MERMAID_THEMES, MERMAID_DIAGRAM_TYPES, normalizeMermaidThemes, mermaidDiagramType, resolveMermaidTheme };
