import assert from "node:assert/strict";
import test from "node:test";

import { measureSvg, normalizeMermaidSource } from "./mermaid.ts";

test("Mermaid 源码方向大小写归一化", () => {
  // 顶层流程图方向小写容错
  assert.equal(normalizeMermaidSource("flowchart lr\n  A --> B"), "flowchart LR\n  A --> B");
  assert.equal(normalizeMermaidSource("flowchart rl\n  A --> B"), "flowchart RL\n  A --> B");
  assert.equal(normalizeMermaidSource("flowchart tb\n  A --> B"), "flowchart TB\n  A --> B");
  assert.equal(normalizeMermaidSource("flowchart td\n  A --> B"), "flowchart TD\n  A --> B");
  assert.equal(normalizeMermaidSource("flowchart bt\n  A --> B"), "flowchart BT\n  A --> B");

  // graph 语法方向容错
  assert.equal(normalizeMermaidSource("graph lr\n  A --> B"), "graph LR\n  A --> B");
  assert.equal(normalizeMermaidSource("graph rl\n  A --> B"), "graph RL\n  A --> B");

  // 前导空格容错
  assert.equal(normalizeMermaidSource("  flowchart   lr\n  A --> B"), "flowchart LR\n  A --> B");

  // 子图与状态图内部 direction 指令容错
  const subSource = `flowchart TB
  subgraph S1
    direction lr
    a --> b
  end`;
  assert.equal(
    normalizeMermaidSource(subSource),
    `flowchart TB
  subgraph S1
    direction LR
    a --> b
  end`,
  );

  // 状态图内部 direction 指令
  const stateSource = `stateDiagram-v2
  direction lr
  [*] --> S1`;
  assert.equal(
    normalizeMermaidSource(stateSource),
    `stateDiagram-v2
  direction LR
  [*] --> S1`,
  );

  // 不误改普通单词（包含 lr/tb 字符的普通标识符）
  const normalSource = `flowchart LR
  alert --> clearance`;
  assert.equal(normalizeMermaidSource(normalSource), normalSource);
});

test("measureSvg 精确提取 SVG 尺寸并支持科学计数法与逗号分隔", () => {
  // 标准空格分隔 viewBox
  assert.deepEqual(measureSvg('<svg viewBox="0 0 500 300"></svg>'), { width: 500, height: 300 });

  // 逗号分隔 viewBox
  assert.deepEqual(measureSvg('<svg viewBox="0, 0, 640, 480"></svg>'), { width: 640, height: 480 });

  // 状态图/类图常出现的微小浮点数科学计数法 viewBox（不应匹配失败回退到 800x400）
  assert.deepEqual(
    measureSvg('<svg viewBox="9.5367431640625e-7 24.000003814697266 201.82351684570312 52.999996185302734"></svg>'),
    { width: 201.82351684570312, height: 52.999996185302734 },
  );

  // 负坐标起始 viewBox
  assert.deepEqual(measureSvg('<svg viewBox="-10 -20 400 200"></svg>'), { width: 400, height: 200 });

  // width / height 属性提取（普通与带 px 后缀）
  assert.deepEqual(measureSvg('<svg width="320" height="240"></svg>'), { width: 320, height: 240 });
  assert.deepEqual(measureSvg('<svg width="320px" height="240px"></svg>'), { width: 320, height: 240 });

  // 负坐标起始与自适应安全留白 viewBox（经安全呼吸边距调整后的扩展尺寸）
  assert.deepEqual(measureSvg('<svg viewBox="-4 16 1092 259"></svg>'), { width: 1092, height: 259 });
  assert.deepEqual(measureSvg('<svg viewBox="-16 -16 958 224.5"></svg>'), { width: 958, height: 224.5 });

  // 无法识别时的安全兜底
  assert.deepEqual(measureSvg("<svg></svg>"), { width: 800, height: 400 });
});

test("applyNodeTextBorderColor 智能让节点文字颜色继承边框色", async () => {
  const { applyNodeTextBorderColor } = await import("./mermaid.ts");

  interface MockElement {
    tagName: string;
    className: string;
    styleMap: Map<string, string>;
    attributes: Map<string, string>;
    children: MockElement[];
    style: {
      setProperty: (prop: string, val: string, priority?: string) => void;
      getPropertyValue: (prop: string) => string;
    };
    getAttribute: (attr: string) => string | null;
    setAttribute: (attr: string, val: string) => void;
    querySelectorAll: <T = unknown>(selector: string) => T[];
    matches: (selector: string) => boolean;
  }

  function createMockElement(tagName: string, className = "", style = ""): MockElement {
    const styleMap = new Map<string, string>();
    const attributes = new Map<string, string>();
    const children: MockElement[] = [];

    if (style) {
      attributes.set("style", style);
    }
    if (className) {
      attributes.set("class", className);
    }

    const el: MockElement = {
      tagName: tagName.toLowerCase(),
      className,
      styleMap,
      attributes,
      children,
      style: {
        setProperty(prop: string, val: string) {
          styleMap.set(prop, val);
        },
        getPropertyValue(prop: string) {
          return styleMap.get(prop) || "";
        },
      },
      getAttribute(attr: string) {
        return attributes.get(attr) || null;
      },
      setAttribute(attr: string, val: string) {
        attributes.set(attr, val);
      },
      querySelectorAll<T = unknown>(selector: string): T[] {
        const result: MockElement[] = [];
        const selectors = selector.split(",").map((s) => s.trim().toLowerCase());

        function walk(node: MockElement) {
          for (const child of node.children) {
            const matchesSel = selectors.some((s) => {
              if (s.startsWith(".")) {
                return child.className.split(" ").includes(s.slice(1));
              }
              return child.tagName === s;
            });
            if (matchesSel) {
              result.push(child);
            }
            walk(child);
          }
        }
        walk(el);
        return result as unknown as T[];
      },
      matches(selector: string) {
        const selectors = selector.split(",").map((s) => s.trim().toLowerCase());
        return selectors.some((s) => {
          if (s.startsWith(".")) {
            return el.className.split(" ").includes(s.slice(1));
          }
          return el.tagName === s;
        });
      },
    };

    return el;
  }

  // 场景 1：自定义绿色边框与浅绿背景方块，文字自动使用绿色边框色
  const root1 = createMockElement("svg");
  const node1 = createMockElement("g", "node");
  const rect1 = createMockElement("rect", "", "stroke: #10b981; fill: #ecfdf5;");
  const text1 = createMockElement("text");
  node1.children.push(rect1, text1);
  root1.children.push(node1);

  applyNodeTextBorderColor(root1 as unknown as Element, true);
  assert.equal(text1.style.getPropertyValue("color"), "color-mix(in srgb, #10b981 75%, #ffffff)");
  assert.equal(text1.style.getPropertyValue("fill"), "color-mix(in srgb, #10b981 75%, #ffffff)");
  assert.equal(rect1.style.getPropertyValue("stroke"), "#10b981");
  assert.equal(rect1.style.getPropertyValue("fill"), "color-mix(in srgb, #10b981 20%, #202020)");

  // 场景 2：未指定任何自定义颜色的默认方块，文字默认继承对应主题的浅明暖橙色
  const root2 = createMockElement("svg");
  const node2 = createMockElement("g", "node");
  const rect2 = createMockElement("rect");
  const span2 = createMockElement("span");
  node2.children.push(rect2, span2);
  root2.children.push(node2);

  applyNodeTextBorderColor(root2 as unknown as Element, true);
  assert.equal(span2.style.getPropertyValue("color"), "#fde68a"); // 深色模式浅金暖橙，略微浅一点点

  // 浅色模式默认明朗暖橙
  const root3 = createMockElement("svg");
  const node3 = createMockElement("g", "node");
  const rect3 = createMockElement("rect");
  const span3 = createMockElement("span");
  node3.children.push(rect3, span3);
  root3.children.push(node3);

  applyNodeTextBorderColor(root3 as unknown as Element, false);
  assert.equal(span3.style.getPropertyValue("color"), "#ea580c"); // 浅色模式明朗暖橙，略微浅一点点

  // 场景 3：显式指定了 color 的节点，不强制覆盖用户定义的文字颜色
  const root4 = createMockElement("svg");
  const node4 = createMockElement("g", "node", "color: #3b82f6;");
  const rect4 = createMockElement("rect", "", "stroke: #ef4444;");
  const span4 = createMockElement("span");
  node4.children.push(rect4, span4);
  root4.children.push(node4);

  applyNodeTextBorderColor(root4 as unknown as Element, true);
  assert.equal(span4.style.getPropertyValue("color"), ""); // 保留原显式样式，不覆盖
});

test("adaptSequenceDiagramRects 智能自适应时序图背景高亮框并确保文字清晰度", async () => {
  const { adaptSequenceDiagramRects } = await import("./mermaid.ts");

  interface MockElement {
    tagName: string;
    className: string;
    styleMap: Map<string, string>;
    attributes: Map<string, string>;
    children: MockElement[];
    style: {
      setProperty: (prop: string, val: string, priority?: string) => void;
      getPropertyValue: (prop: string) => string;
    };
    getAttribute: (attr: string) => string | null;
    setAttribute: (attr: string, val: string) => void;
    querySelectorAll: <T = unknown>(selector: string) => T[];
    matches: (selector: string) => boolean;
  }

  function createMockElement(tagName: string, className = "", style = "", fill = ""): MockElement {
    const styleMap = new Map<string, string>();
    const attributes = new Map<string, string>();
    if (className) attributes.set("class", className);
    if (style) attributes.set("style", style);
    if (fill) attributes.set("fill", fill);

    if (style) {
      style.split(";").forEach((s) => {
        const [k, v] = s.split(":").map((x) => x?.trim());
        if (k && v) styleMap.set(k, v);
      });
    }

    const el: MockElement = {
      tagName: tagName.toLowerCase(),
      className,
      styleMap,
      attributes,
      children: [],
      style: {
        setProperty(prop: string, val: string) {
          styleMap.set(prop, val);
        },
        getPropertyValue(prop: string) {
          return styleMap.get(prop) || "";
        },
      },
      getAttribute(attr: string) {
        return attributes.get(attr) || null;
      },
      setAttribute(attr: string, val: string) {
        attributes.set(attr, val);
      },
      querySelectorAll<T = unknown>(selector: string): T[] {
        const result: MockElement[] = [];
        const selectors = selector.split(",").map((s) => s.trim().toLowerCase());
        function walk(node: MockElement) {
          for (const child of node.children) {
            const matches = selectors.some((s) => {
              if (s.startsWith(".")) {
                return child.className.split(" ").includes(s.slice(1));
              }
              if (s.startsWith("rect[")) {
                return child.tagName === "rect";
              }
              return child.tagName === s;
            });
            if (matches) result.push(child);
            walk(child);
          }
        }
        walk(el);
        return result as unknown as T[];
      },
      matches(selector: string) {
        const selectors = selector.split(",").map((s) => s.trim().toLowerCase());
        return selectors.some((s) => {
          if (s.startsWith(".")) {
            return el.className.split(" ").includes(s.slice(1));
          }
          return el.tagName === s;
        });
      },
    };

    return el;
  }

  // 场景：深色模式下，用户指定的两个时序图背景高亮框（AliceBlue 和 FloralWhite）
  const root = createMockElement("svg");
  const rect1 = createMockElement("rect", "rect", "fill: rgb(240, 248, 255);");
  const rect2 = createMockElement("rect", "rect", "fill: rgb(255, 250, 240);");
  const actorRect = createMockElement("rect", "actor", "fill: #382613;"); // 参与者角色框，不应被当成背景块修改

  root.children.push(rect1, rect2, actorRect);

  adaptSequenceDiagramRects(root as unknown as Element, true);

  // 验证两块浅色背景在深色模式下成功转换为暗调底色与细微光边框
  assert.equal(rect1.style.getPropertyValue("fill"), "color-mix(in srgb, rgb(240, 248, 255) 18%, #202020)");
  assert.equal(rect1.style.getPropertyValue("stroke"), "color-mix(in srgb, rgb(240, 248, 255) 45%, #f59e0b)");
  assert.equal(rect1.style.getPropertyValue("stroke-dasharray"), "4 2");

  assert.equal(rect2.style.getPropertyValue("fill"), "color-mix(in srgb, rgb(255, 250, 240) 18%, #202020)");
  assert.equal(rect2.style.getPropertyValue("stroke"), "color-mix(in srgb, rgb(255, 250, 240) 45%, #f59e0b)");

  // 参与者框保持原本主题色，不受影响
  assert.equal(actorRect.style.getPropertyValue("fill"), "#382613");
});


