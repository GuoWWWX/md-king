import { StateEffect } from "@codemirror/state";
import { redo, undo } from "@codemirror/commands";
import { EditorView, WidgetType } from "@codemirror/view";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import katex from "katex";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRight,
  ArrowRightToLine,
  ArrowUpToLine,
  AlignCenter,
  AlignJustify,
  ClipboardPaste,
  ChevronDown,
  ChevronRight,
  Code2,
  Expand,
  Maximize2,
  Columns3,
  Copy,
  FileText,
  Globe2,
  GripHorizontal,
  GripVertical,
  Rows3,
  Scissors,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { markdownCalloutIcon } from "@/components/markdown-callout-icon";
import { TableWidthModeIcon } from "@/components/editor/table-width-mode-icon";
import type { MarkdownCalloutTone } from "@/lib/markdown-callout";
import type { MarkdownFrontmatterEntry } from "@/lib/markdown-frontmatter";
import { orderedListMarker } from "./source-indent";
import { getCachedMermaidSvg, renderMermaid } from "@/lib/mermaid";
import { requestMediaPreview, svgDataUrl } from "@/components/media/image-viewer";
import { resolvePreviewImageSource } from "@/lib/tauri";
import {
  applyTableOperation,
  clearTableSelection,
  pasteTableTsv,
  reorderTableColumn,
  reorderTableRow,
  serializeMarkdownTable,
  tableOperationFocus,
  tableCellPointerSelection,
  tableSelectionBounds,
  tableSelectionCoversWholeTable,
  tableSelectionToTsv,
  type MarkdownTable,
  type TableOperation,
  type TableSelection,
} from "./markdown-table";
import { TableCellCompositionGuard } from "./table-cell-edit";
import { setTableWidthModeEffect, tableContextChangeEvent, type TableWidthMode } from "./table-display-settings";
import { renderTableInlineMarkdown } from "./table-inline-renderer";

type ImageWidthMode = "fit" | "natural";

const imageWidthModes = new Map<string, ImageWidthMode>();

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

/** KaTeX 公式预览；点击公式时把光标放回源码，保持实时预览可编辑。 */
export class MarkdownMathWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly display: boolean,
    private readonly editPosition: number,
    private readonly editable: boolean,
  ) {
    super();
  }

  eq(other: MarkdownMathWidget): boolean {
    return other.source === this.source
      && other.display === this.display
      && other.editPosition === this.editPosition
      && other.editable === this.editable;
  }

  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement(this.display ? "div" : "span");
    host.className = this.display ? "mk-cm-math-block" : "mk-cm-math-inline";
    try {
      host.innerHTML = katex.renderToString(this.source, {
        displayMode: this.display,
        throwOnError: true,
        output: "html",
        strict: false,
      });
    } catch {
      host.classList.add("is-invalid");
      host.textContent = this.source;
    }
    if (this.editable) {
      host.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({ selection: { anchor: this.editPosition }, scrollIntoView: true });
        view.focus();
      });
    }
    return host;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export class MarkdownBreakWidget extends WidgetType {
  eq(other: MarkdownBreakWidget) { return other.constructor === MarkdownBreakWidget; }
  toDOM() { const element = document.createElement("br"); element.className = "mk-cm-markdown-break"; return element; }
  ignoreEvent() { return false; }
}

/**
 * 代码块右上角的复制按钮。
 *
 * 放在围栏首行末尾（side:1 widget），绝对定位浮在右上角；
 * 点击后图标短暂切换成对勾再还原，给用户明确的操作反馈。
 */
export class CopyCodeWidget extends WidgetType {
  constructor(private readonly code: string) {
    super();
  }

  eq(other: CopyCodeWidget): boolean {
    return other.code === this.code;
  }

  toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mk-cm-copy-code";
    btn.setAttribute("aria-label", "复制代码");
    btn.dataset.tooltip = "复制代码";
    btn.innerHTML = COPY_ICON;

    // 在 click 之前阻止编辑器移动选区和按钮抢焦点，避免围栏切换到源码态。
    const keepEditorSelection = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    btn.addEventListener("pointerdown", keepEditorSelection);
    btn.addEventListener("mousedown", keepEditorSelection);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard.writeText(this.code).then(() => {
        btn.innerHTML = CHECK_ICON;
        btn.classList.add("mk-cm-copy-code--ok");
        window.setTimeout(() => {
          btn.innerHTML = COPY_ICON;
          btn.classList.remove("mk-cm-copy-code--ok");
        }, 1500);
      });
    });

    return btn;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * 无序列表的排版化圆点。
 *
 * 源码里的 `-` / `*` / `+` 在渲染态被 replace 成这个 widget，
 * 用真正的圆点字符而不是保留原字符，才能和 Word 预览侧的列表观感对齐。
 *
 * eq() 必须实现：CM 每次 update 都会拿新 widget 和旧 widget 比对，
 * 返回 true 时复用现有 DOM。不实现的话默认恒为 false，
 * 滚动或输入时每个圆点都被销毁重建，表现为整段列表闪烁。
 */
export class BulletWidget extends WidgetType {
  constructor(private readonly depth: number) {
    super();
  }

  eq(other: BulletWidget): boolean {
    return other.depth === this.depth;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "mk-cm-bullet";
    // 按嵌套层级换符号，和常见 Markdown 渲染器（含本项目 Word 预览）的层级约定一致。
    span.textContent = `${this.depth % 3 === 0 ? "•" : this.depth % 3 === 1 ? "◦" : "▪"} `;
    // 屏幕阅读器不该念出这个纯装饰字符，源码里的 `-` 才是语义所在。
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  /** 圆点是纯展示，不吞事件——让点击照常落到编辑器上定位光标。 */
  ignoreEvent(): boolean {
    return false;
  }
}

export class OrderedListWidget extends WidgetType {
  constructor(private readonly sourceMarker: string, private readonly value: number) {
    super();
  }

  eq(other: OrderedListWidget): boolean {
    return other.sourceMarker === this.sourceMarker && other.value === this.value;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "mk-cm-ordered-marker";
    span.textContent = `${orderedListMarker(this.sourceMarker, this.value)} `;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * GFM 任务列表的可视复选框。
 *
 * 源码仍保留在文档中，只有光标靠近标记时才由实时预览层替换成此 widget；
 * 因此既能一眼识别任务状态，也不会引入另一份脱离 Markdown 的状态。
 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement("span");
    checkbox.className = "mk-cm-task-checkbox";
    checkbox.dataset.checked = String(this.checked);
    checkbox.setAttribute("role", "checkbox");
    checkbox.setAttribute("aria-checked", String(this.checked));
    checkbox.setAttribute("aria-label", this.checked ? "取消完成状态" : "标记为已完成");
    checkbox.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const markerStart = view.posAtDOM(checkbox, 0);
      const marker = view.state.doc.sliceString(markerStart, markerStart + 3);
      if (!/^\[(?: |x|X)\]$/.test(marker)) return;

      view.dispatch({
        changes: { from: markerStart + 1, to: markerStart + 2, insert: this.checked ? " " : "x" },
        scrollIntoView: false,
      });
      view.focus();
    });
    return checkbox;
  }

  /** 任务标记附近仍允许编辑器处理光标，进入源码态后可以直接修改 `[ ]` / `[x]`。 */
  ignoreEvent(): boolean {
    return true;
  }
}

function measuredBlockWidget(content: HTMLElement, spacing: "frontmatter" | "media" | "table"): HTMLElement {
  const container = document.createElement("div");
  container.className = `mk-cm-block-widget-spacing mk-cm-block-widget-spacing--${spacing}`;
  container.append(content);
  return container;
}

/**
 * Mermaid 图表。
 *
 * mermaid 的渲染是异步的，widget 的 toDOM 必须同步返回，所以这里先返回一个
 * 容器：命中缓存就直接填图（切换光标进出时不会闪空白），否则先占位再异步补上。
 */
export class MermaidWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly dark: boolean,
    private readonly blockFrom: number,
    private readonly editable: boolean,
    private readonly caption?: string,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return other.source === this.source
      && other.dark === this.dark
      && other.blockFrom === this.blockFrom
      && other.editable === this.editable
      && other.caption === this.caption;
  }

  toDOM(view: EditorView): HTMLElement {
    // 分两层：外层负责边框，内层专门放 SVG。
    const host = document.createElement("div");
    host.className = "mk-cm-mermaid";
    const container = measuredBlockWidget(host, "media");

    const langLabel = document.createElement("span");
    langLabel.className = "mk-cm-mermaid-language";
    langLabel.textContent = "MERMAID";
    langLabel.setAttribute("aria-hidden", "true");
    host.append(langLabel);

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "mk-cm-mermaid-expand";
    previewButton.dataset.tooltip = "放大查看 Mermaid 图";
    previewButton.setAttribute("aria-label", "放大查看 Mermaid 图");
    previewButton.innerHTML = iconMarkup(Expand);
    previewButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const svg = host.querySelector(".mk-cm-mermaid-canvas svg")?.outerHTML;
      if (svg) requestMediaPreview({ src: svgDataUrl(svg), alt: "Mermaid 图表", title: "Mermaid 图表" });
    });
    host.append(previewButton);

    if (this.editable) {
      const sourceButton = document.createElement("button");
      sourceButton.type = "button";
      sourceButton.className = "mk-cm-mermaid-source";
      sourceButton.dataset.tooltip = "编辑 Mermaid 源码";
      sourceButton.setAttribute("aria-label", "编辑 Mermaid 源码");
      sourceButton.innerHTML = iconMarkup(Code2);
      sourceButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({
          selection: { anchor: this.blockFrom },
          effects: editMermaidSourceEffect.of(this.blockFrom),
          scrollIntoView: true,
        });
        view.focus();
      });
      host.append(sourceButton);
    }

    const canvas = document.createElement("div");
    canvas.className = "mk-cm-mermaid-canvas";
    canvas.setAttribute("role", "region");
    canvas.style.userSelect = "text";
    canvas.addEventListener("pointerdown", (event) => {
      const target = event.target as Element | null;
      if (target?.closest("a, [role='link'], text, span, .node, .edgeLabel, .cluster-label")) {
        event.stopPropagation();
      }
    });
    canvas.addEventListener("click", (event) => {
      const link = (event.target as Element | null)?.closest("a");
      if (link && link.href) {
        event.stopPropagation();
      }
    });
    canvas.setAttribute("aria-label", "Mermaid 图表");
    host.append(canvas);

    if (this.caption) {
      const caption = document.createElement("div");
      caption.className = "mk-cm-mermaid-caption";
      caption.textContent = this.caption;
      host.append(caption);
    }

    const cached = getCachedMermaidSvg(this.source, this.dark);
    if (cached) {
      canvas.innerHTML = cached.svg;
      return container;
    }

    host.dataset.state = "loading";
    canvas.textContent = "正在渲染图表…";

    void renderMermaid(this.source, this.dark)
      .then(({ svg }) => {
        // 容器可能已经被 CM 回收（用户快速滚动或改了源码），
        // 这时候往里写东西没有意义，isConnected 判掉。
        if (!canvas.isConnected) return;
        delete host.dataset.state;
        canvas.innerHTML = svg;
      })
      .catch((error: unknown) => {
        if (!canvas.isConnected) return;
        host.dataset.state = "error";
        // 语法错误要给出原文，否则用户不知道图为什么画不出来。
        canvas.textContent = error instanceof Error ? error.message : "图表渲染失败";
      });

    return container;
  }

  /**
   * 图表主体交给编辑器处理选区：普通单击仍是空选区并保持预览，
   * 拖选经过图表时才能让块级装饰恢复 Mermaid 源码。
   */
  ignoreEvent(event: Event): boolean {
    const target = event.target as Element | null;
    if (target?.closest(".mk-cm-mermaid-canvas, .mk-cm-mermaid-source, a, [role='link']")) {
      return true;
    }
    return false;
  }
}

/** 独占一行的 Markdown 图片在编辑器内按块级预览，源码可通过右上角按钮恢复编辑。 */
export class MarkdownImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
    private readonly markdownSourcePath: string | undefined,
    private readonly blockFrom: number,
    private readonly blockTo: number,
    private readonly selected: boolean,
    private readonly editable: boolean,
  ) {
    super();
  }

  eq(other: MarkdownImageWidget): boolean {
    return this.hasSameImage(other)
      && other.selected === this.selected;
  }

  updateDOM(dom: HTMLElement, _view: EditorView, previous: MarkdownImageWidget): boolean {
    if (!this.hasSameImage(previous)) return false;
    // 选中或取消选中时只切换外框。重建大图片会先回退到加载占位高度，
    // 随后 load/requestMeasure 再撑开，表现为整个编辑页跳动闪烁。
    const host = dom.classList.contains("mk-cm-image")
      ? dom
      : dom.querySelector<HTMLElement>(".mk-cm-image");
    if (!host) return false;
    host.dataset.selected = String(this.selected);
    return true;
  }

  private hasSameImage(other: MarkdownImageWidget): boolean {
    return other.src === this.src
      && other.alt === this.alt
      && other.markdownSourcePath === this.markdownSourcePath
      && other.blockFrom === this.blockFrom
      && other.blockTo === this.blockTo
      && other.editable === this.editable;
  }

  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.className = "mk-cm-image";
    host.dataset.state = "loading";
    host.dataset.selected = String(this.selected);
    const container = measuredBlockWidget(host, "media");
    host.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    const frame = document.createElement("div");
    frame.className = "mk-cm-image-frame";
    host.append(frame);

    const canvas = document.createElement("div");
    canvas.className = "mk-cm-image-canvas";
    canvas.textContent = "正在加载图片…";
    frame.append(canvas);

    const widthModeKey = `${this.markdownSourcePath ?? "untitled"}\u0000${this.src}`;
    let widthMode = imageWidthModes.get(widthModeKey) ?? "natural";
    const applyWidthMode = (next: ImageWidthMode) => {
      widthMode = next;
      imageWidthModes.set(widthModeKey, next);
      host.dataset.widthMode = next;
    };
    applyWidthMode(widthMode);
    if (this.editable) {
      const showSource = () => {
        view.dispatch({
          selection: { anchor: this.blockFrom },
          scrollIntoView: true,
        });
        view.focus();
      };
      const focusAfterImage = () => {
        const afterImage = this.blockTo + 1;
        const hasNextLine = this.blockTo < view.state.doc.length
          && view.state.doc.sliceString(this.blockTo, afterImage) === "\n";
        view.dispatch(
          hasNextLine
            ? { selection: { anchor: afterImage }, scrollIntoView: true }
            : { changes: { from: this.blockTo, insert: "\n" }, selection: { anchor: afterImage }, scrollIntoView: true },
        );
        view.focus();
      };
      const sourceButton = document.createElement("button");
      sourceButton.type = "button";
      sourceButton.className = "mk-cm-image-source";
      sourceButton.dataset.tooltip = "编辑图片 Markdown";
      sourceButton.setAttribute("aria-label", "编辑图片 Markdown");
      sourceButton.innerHTML = iconMarkup(Code2);
      sourceButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showSource();
      });
      frame.append(sourceButton);

      const widthButton = document.createElement("button");
      widthButton.type = "button";
      widthButton.className = "mk-cm-image-width";
      const syncWidthButton = () => {
        const nextLabel = widthMode === "fit" ? "切换为原始宽度" : "切换为适应窗口宽度";
        widthButton.dataset.tooltip = nextLabel;
        widthButton.setAttribute("aria-label", nextLabel);
        widthButton.innerHTML = iconMarkup(widthMode === "fit" ? AlignCenter : AlignJustify);
      };
      syncWidthButton();
      widthButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyWidthMode(widthMode === "fit" ? "natural" : "fit");
        syncWidthButton();
        view.requestMeasure();
      });
      frame.append(widthButton);

      const continuation = document.createElement("div");
      continuation.className = "mk-cm-image-continuation";
      continuation.setAttribute("role", "button");
      continuation.setAttribute("aria-label", "在图片后继续输入");
      continuation.tabIndex = 0;
      continuation.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        focusAfterImage();
      });
      continuation.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        focusAfterImage();
      });
      host.append(continuation);
    }

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "mk-cm-image-expand";
    previewButton.dataset.tooltip = "放大查看图片";
    previewButton.setAttribute("aria-label", "放大查看图片");
    previewButton.innerHTML = iconMarkup(Maximize2);
    frame.append(previewButton);

    void resolvePreviewImageSource(this.src, this.markdownSourcePath)
      .then((resolvedSrc) => {
        if (!host.isConnected || !resolvedSrc) throw new Error("图片无法预览");
        const image = document.createElement("img");
        image.src = resolvedSrc;
        image.alt = this.alt;
        image.addEventListener("load", () => view.requestMeasure());
        if (this.editable) {
          image.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch({
              selection: { anchor: this.blockFrom, head: this.blockTo },
            });
            view.focus();
          });
        }
        previewButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          requestMediaPreview({ src: resolvedSrc, alt: this.alt, title: this.alt || "图片预览" });
        });
        canvas.replaceChildren(image);
        delete host.dataset.state;
        view.requestMeasure();
      })
      .catch(() => {
        if (!host.isConnected) return;
        host.dataset.state = "error";
        canvas.textContent = "图片无法预览";
        previewButton.disabled = true;
        view.requestMeasure();
      });

    return container;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export const editMermaidSourceEffect = StateEffect.define<number>();
export const editTableSourceEffect = StateEffect.define<number>();
export const selectWholeTableEffect = StateEffect.define<number | null>();

function iconMarkup(icon: LucideIcon): string {
  return renderToStaticMarkup(createElement(icon, { size: 14, strokeWidth: 2 }));
}

function tableWidthModeIconMarkup(mode: TableWidthMode): string {
  return renderToStaticMarkup(createElement(TableWidthModeIcon, { mode, width: 16, height: 16 }));
}

export class MarkdownLinkIconWidget extends WidgetType {
  constructor(
    private readonly kind: "external" | "document",
    private readonly target: string,
    private readonly wikilinkFrom?: number,
  ) {
    super();
  }

  eq(other: MarkdownLinkIconWidget): boolean {
    return other.kind === this.kind && other.target === this.target && other.wikilinkFrom === this.wikilinkFrom;
  }

  toDOM(): HTMLElement {
    const icon = document.createElement("span");
    icon.className = `mk-cm-link-icon mk-cm-link-icon--${this.kind}`;
    icon.dataset.mkLinkTarget = this.target;
    if (this.wikilinkFrom !== undefined) icon.dataset.mkWikilinkFrom = String(this.wikilinkFrom);
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconMarkup(this.kind === "external" ? Globe2 : FileText);
    return icon;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Obsidian 双链在编辑器中的紧凑渲染态。源码仍保存在文档里，只在选中时还原。 */
export class MarkdownWikilinkWidget extends WidgetType {
  constructor(
    private readonly kind: "external" | "document",
    private readonly target: string,
    private readonly label: string,
    private readonly wikilinkFrom: number,
    private readonly invalid: boolean,
  ) {
    super();
  }

  eq(other: MarkdownWikilinkWidget): boolean {
    return other.kind === this.kind
      && other.target === this.target
      && other.label === this.label
      && other.wikilinkFrom === this.wikilinkFrom
      && other.invalid === this.invalid;
  }

  toDOM(): HTMLElement {
    const link = document.createElement("span");
    link.className = `mk-cm-link mk-cm-link--${this.kind} mk-cm-link--wikilink${this.invalid ? " mk-cm-link--invalid" : ""}`;
    link.dataset.mkLinkTarget = this.target;
    link.dataset.mkWikilinkFrom = String(this.wikilinkFrom);
    if (this.invalid) link.dataset.mkWikilinkInvalid = "true";
    link.setAttribute("role", "link");
    link.setAttribute("aria-label", this.invalid ? `非 Markdown 文件：${this.target}` : `打开文档：${this.target}`);
    link.title = this.invalid ? "仅支持 Markdown 文档" : this.target;

    const icon = document.createElement("span");
    icon.className = `mk-cm-link-icon mk-cm-link-icon--${this.kind}${this.invalid ? " mk-cm-link-icon--invalid" : ""}`;
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconMarkup(this.kind === "external" ? Globe2 : FileText);
    link.append(icon);
    renderWikilinkFormattedLabel(link, this.label);
    return link;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function renderWikilinkFormattedLabel(container: HTMLElement, label: string): void {
  const pattern = /(\*\*([^\*]+)\*\*|\*([^\*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(label)) !== null) {
    if (match.index > lastIndex) {
      container.append(document.createTextNode(label.slice(lastIndex, match.index)));
    }
    if (match[2] !== undefined) {
      const strong = document.createElement("strong");
      strong.className = "mk-cm-strong";
      strong.textContent = match[2];
      container.append(strong);
    } else if (match[3] !== undefined) {
      const em = document.createElement("em");
      em.className = "mk-cm-em";
      em.textContent = match[3];
      container.append(em);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < label.length) {
    container.append(document.createTextNode(label.slice(lastIndex)));
  }
}

export class MarkdownCalloutIconWidget extends WidgetType {
  constructor(
    private readonly type: string,
    private readonly tone: string,
    private readonly title: string,
    private readonly collapsed: boolean | undefined,
    private readonly calloutFrom: number | undefined,
    private readonly onToggle: ((view: EditorView) => void) | undefined,
  ) {
    super();
  }

  eq(other: MarkdownCalloutIconWidget): boolean {
    return other.type === this.type
      && other.tone === this.tone
      && other.title === this.title
      && other.collapsed === this.collapsed
      && other.calloutFrom === this.calloutFrom;
  }

  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("span");
    host.className = `mk-cm-callout-heading-prefix${this.collapsed === undefined ? "" : " mk-cm-callout-toggle"}`;
    host.innerHTML = iconMarkup(markdownCalloutIcon(this.type, this.tone as MarkdownCalloutTone));
    if (this.calloutFrom === undefined || this.collapsed === undefined) {
      host.setAttribute("aria-hidden", "true");
    } else {
      host.dataset.mkCalloutToggle = "true";
      host.dataset.mkCalloutFrom = String(this.calloutFrom);
      host.setAttribute("role", "button");
      host.setAttribute("tabindex", "0");
      host.setAttribute("aria-expanded", String(!this.collapsed));
      host.setAttribute("aria-label", this.collapsed ? "展开引用块" : "收起引用块");

      const toggle = document.createElement("span");
      toggle.className = "mk-cm-callout-fold-icon";
      toggle.setAttribute("aria-hidden", "true");
      toggle.innerHTML = iconMarkup(this.collapsed ? ChevronRight : ChevronDown);
      host.prepend(toggle);
    }
    if (this.title) {
      const title = document.createElement("span");
      title.className = "mk-cm-callout-title";
      title.textContent = this.title;
      host.append(title);
    }

    if (this.onToggle) {
      host.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      host.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onToggle?.(view);
      });
      host.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        this.onToggle?.(view);
      });
    }
    return host;
  }

  ignoreEvent(): boolean {
    return this.onToggle !== undefined;
  }
}

/** 文首 YAML 属性的紧凑预览。编辑时点击或选中属性区会恢复原始 YAML。 */
export class MarkdownFrontmatterWidget extends WidgetType {
  constructor(
    private readonly entries: readonly MarkdownFrontmatterEntry[],
    private readonly editable: boolean,
    private readonly sourceFrom: number,
  ) {
    super();
  }

  eq(other: MarkdownFrontmatterWidget): boolean {
    return other.editable === this.editable
      && other.sourceFrom === this.sourceFrom
      && other.entries.length === this.entries.length
      && other.entries.every((entry, index) => (
        entry.key === this.entries[index]?.key
        && JSON.stringify(entry.value) === JSON.stringify(this.entries[index]?.value)
      ));
  }

  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("section");
    host.className = `mk-cm-frontmatter${this.editable ? " mk-cm-frontmatter--editable" : ""}`;
    host.setAttribute("aria-label", "文档属性");
    if (this.editable) {
      host.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const row = (event.target as Element | null)?.closest<HTMLElement>(".mk-cm-frontmatter-row");
        const lineFrom = row ? Number(row.dataset.sourceFrom) : this.sourceFrom;
        const anchor = view.state.doc.lineAt(lineFrom).to;
        view.dispatch({ selection: { anchor }, scrollIntoView: true });
        view.focus();
      });
    }

    const heading = document.createElement("div");
    heading.className = "mk-cm-frontmatter-heading";
    heading.textContent = "文档属性";
    host.append(heading);

    const properties = document.createElement("div");
    properties.className = "mk-cm-frontmatter-properties";
    for (const entry of this.entries) {
      const row = document.createElement("div");
      row.className = "mk-cm-frontmatter-row";
      row.dataset.sourceFrom = String(entry.sourceFrom);

      const key = document.createElement("span");
      key.className = "mk-cm-frontmatter-key";
      key.textContent = entry.key;

      const value = document.createElement("span");
      value.className = "mk-cm-frontmatter-value";
      const values = Array.isArray(entry.value) ? entry.value : [entry.value];
      if (values.length === 0) {
        value.textContent = "-";
      } else if (Array.isArray(entry.value)) {
        values.forEach((item) => {
          const tag = document.createElement("span");
          tag.className = "mk-cm-frontmatter-tag";
          tag.textContent = item;
          value.append(tag);
        });
      } else {
        value.textContent = values[0];
      }
      row.append(key, value);
      properties.append(row);
    }
    host.append(properties);
    return measuredBlockWidget(host, "frontmatter");
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** GFM 表格的可编辑渲染态 widget。草稿只在提交时一次性写回 Markdown。 */
export class TableWidget extends WidgetType {
  private readonly cleanups = new WeakMap<HTMLElement, () => void>();
  constructor(
    private readonly model: MarkdownTable,
    private readonly source: string,
    private readonly tableFrom: number,
    private readonly tableTo: number,
    private readonly widthMode: TableWidthMode,
    private readonly documentSelectedRows: readonly number[],
    private readonly selectedFromToolbar: boolean,
    private readonly editable: boolean,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return this.hasSameRenderedTable(other)
      && other.documentSelectedRows.length === this.documentSelectedRows.length
      && other.documentSelectedRows.every((row, index) => row === this.documentSelectedRows[index]);
  }

  updateDOM(dom: HTMLElement, _view: EditorView, previous: TableWidget): boolean {
    if (!this.hasSameRenderedTable(previous)) return false;
    const cleanup = previous.cleanups.get(dom);
    if (cleanup) {
      this.cleanups.set(dom, cleanup);
      previous.cleanups.delete(dom);
    }
    if (!this.selectedFromToolbar) this.applyDocumentSelectedRows(dom);
    return true;
  }

  private hasSameRenderedTable(other: TableWidget): boolean {
    return other.source === this.source
      && other.tableFrom === this.tableFrom
      && other.tableTo === this.tableTo
      && other.widthMode === this.widthMode
      && other.selectedFromToolbar === this.selectedFromToolbar
      && other.editable === this.editable;
  }

  private applyDocumentSelectedRows(dom: HTMLElement): void {
    const selectedRows = new Set(this.documentSelectedRows);
    dom.querySelectorAll<HTMLElement>("th[data-table-row], td[data-table-row]").forEach((element) => {
      element.classList.toggle("mk-table-selected", selectedRows.has(Number(element.dataset.tableRow)));
    });
  }

  /** 阅读模式只保留表格渲染，不能进入单元格、拖拽或源码操作。 */
  private createReadonlyDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "mk-cm-table-wrapper mk-cm-table-wrapper--readonly";
    wrapper.dataset.tableFrom = String(this.tableFrom);
    wrapper.tabIndex = 0;
    wrapper.classList.toggle("is-wrap", this.widthMode === "content");
    const container = measuredBlockWidget(wrapper, "table");

    const tableScroll = document.createElement("div");
    tableScroll.className = "mk-cm-table-scroll";
    const table = document.createElement("table");
    table.className = "mk-cm-table";
    const hasDistinctWeights = Boolean(
      this.model.columnWeights
      && this.model.columnWeights.length > 0
      && !this.model.columnWeights.every((w) => w === this.model.columnWeights![0]),
    );
    if (hasDistinctWeights) {
      const colgroup = document.createElement("colgroup");
      const totalWeight = this.model.columnWeights!.reduce((sum, w) => sum + w, 0);
      this.model.columnWeights!.forEach((weight) => {
        const col = document.createElement("col");
        if (totalWeight > 0) {
          col.style.width = `${((weight / totalWeight) * 100).toFixed(2)}%`;
        }
        colgroup.append(col);
      });
      table.append(colgroup);
    }
    const buildRow = (rowIndex: number, isHeader: boolean) => {
      const row = document.createElement("tr");
      this.model.rows[rowIndex].forEach((cell, columnIndex) => {
        const element = document.createElement(isHeader ? "th" : "td");
        element.dataset.tableRow = String(rowIndex);
        element.dataset.tableColumn = String(columnIndex);
        const alignment = this.model.alignments[columnIndex] ?? "none";
        if (alignment !== "none") {
          element.style.textAlign = alignment;
        }
        const weight = this.model.columnWeights?.[columnIndex];
        if (weight !== undefined) {
          element.style.minWidth = `${Math.max(48, Math.min(320, weight * 24))}px`;
        }
        const content = renderTableInlineMarkdown(cell);
        content.removeAttribute("tabindex");
        if (alignment !== "none") {
          content.style.textAlign = alignment;
        }
        element.append(content);
        row.append(element);
      });
      return row;
    };

    if (this.model.rows.length > 0) {
      const head = document.createElement("thead");
      head.append(buildRow(0, true));
      table.append(head);
    }
    if (this.model.rows.length > 1) {
      const body = document.createElement("tbody");
      for (let rowIndex = 1; rowIndex < this.model.rows.length; rowIndex += 1) {
        body.append(buildRow(rowIndex, false));
      }
      table.append(body);
    }
    tableScroll.append(table);
    wrapper.append(tableScroll);
    this.applyDocumentSelectedRows(wrapper);
    let dragAnchor: number | null = null;
    let finishFrame: number | null = null;
    let cellSelection: TableSelection | null = null;
    let cellDrag: {
      pointerId: number;
      anchor: { row: number; column: number };
      focus: { row: number; column: number };
    } | null = null;
    const clearCellSelection = () => {
      cellSelection = null;
      wrapper.querySelectorAll(".mk-table-selected").forEach((element) => element.classList.remove("mk-table-selected"));
    };
    const applyCellSelection = (next: TableSelection) => {
      cellSelection = next;
      wrapper.querySelectorAll(".mk-table-selected").forEach((element) => element.classList.remove("mk-table-selected"));
      const bounds = tableSelectionBounds(this.model, next);
      wrapper.querySelectorAll<HTMLElement>("th[data-table-row][data-table-column], td[data-table-row][data-table-column]").forEach((element) => {
        const row = Number(element.dataset.tableRow);
        const column = Number(element.dataset.tableColumn);
        if (row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right) {
          element.classList.add("mk-table-selected");
        }
      });
    };
    const cellAtPoint = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y)
        ?.closest<HTMLElement>("th[data-table-row][data-table-column], td[data-table-row][data-table-column]");
      if (!element || !wrapper.contains(element)) return null;
      const row = Number(element.dataset.tableRow);
      const column = Number(element.dataset.tableColumn);
      return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
    };
    const beginCellSelection = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const cell = cellAtPoint(event.clientX, event.clientY);
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();
      // 表格内开始拖选时使用和编辑模式一致的单元格选区，不再同时扩展正文行选区。
      dragAnchor = null;
      const nextSelection = tableCellPointerSelection(cellSelection, cell, event.shiftKey);
      if (nextSelection.kind === "range") {
        applyCellSelection(nextSelection);
      } else {
        cellDrag = { pointerId: event.pointerId, anchor: cell, focus: cell };
        applyCellSelection(nextSelection);
      }
      wrapper.focus({ preventScroll: true });
    };
    const updateCellSelection = (event: PointerEvent) => {
      if (!cellDrag || event.pointerId !== cellDrag.pointerId) return;
      const cell = cellAtPoint(event.clientX, event.clientY);
      if (!cell || (cell.row === cellDrag.focus.row && cell.column === cellDrag.focus.column)) return;
      cellDrag.focus = cell;
      applyCellSelection({ kind: "range", anchor: cellDrag.anchor, focus: cell });
    };
    const finishCellSelection = (event: PointerEvent) => {
      if (!cellDrag || event.pointerId !== cellDrag.pointerId) return;
      updateCellSelection(event);
      cellDrag = null;
    };
    const cancelCellSelection = (event: PointerEvent) => {
      if (cellDrag?.pointerId === event.pointerId) cellDrag = null;
    };
    const clearCellSelectionOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.contains(event.target)) clearCellSelection();
    };
    const renderedRowAtPoint = (event: MouseEvent) => {
      const cell = document.elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("th[data-table-row], td[data-table-row]");
      if (!cell || !wrapper.contains(cell)) return null;
      const renderedRow = Number(cell.dataset.tableRow);
      return Number.isInteger(renderedRow) && renderedRow >= 0 ? renderedRow : null;
    };
    const applyDocumentSelection = (renderedRow: number, anchor: number) => {
      if (anchor > this.tableFrom && anchor < this.tableTo) return;
      const sourceLineIndex = renderedRow === 0 ? 0 : renderedRow + 1;
      const firstLine = view.state.doc.lineAt(this.tableFrom);
      const sourceLineNumber = firstLine.number + sourceLineIndex;
      if (sourceLineNumber > view.state.doc.lines) return;
      const sourceLine = view.state.doc.line(sourceLineNumber);
      const head = anchor <= this.tableFrom ? sourceLine.to : sourceLine.from;
      const selection = view.state.selection.main;
      if (selection.anchor !== anchor || selection.head !== head) view.dispatch({ selection: { anchor, head } });
    };
    const captureDocumentSelectionAnchor = (event: MouseEvent) => {
      dragAnchor = null;
      if (event.button !== 0 || !(event.target instanceof Node) || !view.dom.contains(event.target)) return;
      if (event.target instanceof Element) {
        const cell = event.target.closest("th[data-table-row][data-table-column], td[data-table-row][data-table-column]");
        if (cell && wrapper.contains(cell)) return;
      }
      dragAnchor = view.posAtCoords({ x: event.clientX, y: event.clientY });
    };
    const extendDocumentSelectionThroughRow = (event: MouseEvent) => {
      if ((event.buttons & 1) === 0 || dragAnchor === null) return;
      const renderedRow = renderedRowAtPoint(event);
      if (renderedRow === null) return;
      const anchor = dragAnchor;
      queueMicrotask(() => applyDocumentSelection(renderedRow, anchor));
    };
    const finishDocumentSelection = (event: MouseEvent) => {
      if (event.button !== 0 || dragAnchor === null) return;
      const renderedRow = renderedRowAtPoint(event);
      const anchor = dragAnchor;
      dragAnchor = null;
      if (renderedRow === null) return;
      if (finishFrame !== null) cancelAnimationFrame(finishFrame);
      finishFrame = requestAnimationFrame(() => {
        finishFrame = null;
        applyDocumentSelection(renderedRow, anchor);
      });
    };
    document.addEventListener("pointerdown", captureDocumentSelectionAnchor, true);
    document.addEventListener("mousedown", captureDocumentSelectionAnchor, true);
    document.addEventListener("pointerdown", clearCellSelectionOutside, true);
    document.addEventListener("pointermove", extendDocumentSelectionThroughRow, true);
    document.addEventListener("mousemove", extendDocumentSelectionThroughRow, true);
    document.addEventListener("pointerup", finishDocumentSelection, true);
    document.addEventListener("mouseup", finishDocumentSelection, true);
    table.addEventListener("pointerdown", beginCellSelection);
    table.addEventListener("pointermove", updateCellSelection);
    document.addEventListener("pointerup", finishCellSelection, true);
    document.addEventListener("pointercancel", cancelCellSelection, true);
    wrapper.addEventListener("copy", (event) => {
      if (!cellSelection) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", tableSelectionCoversWholeTable(this.model, cellSelection)
        ? serializeMarkdownTable(this.model)
        : tableSelectionToTsv(this.model, cellSelection));
    });
    wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Escape") clearCellSelection();
    });
    this.cleanups.set(container, () => {
      document.removeEventListener("pointerdown", captureDocumentSelectionAnchor, true);
      document.removeEventListener("mousedown", captureDocumentSelectionAnchor, true);
      document.removeEventListener("pointerdown", clearCellSelectionOutside, true);
      document.removeEventListener("pointermove", extendDocumentSelectionThroughRow, true);
      document.removeEventListener("mousemove", extendDocumentSelectionThroughRow, true);
      document.removeEventListener("pointerup", finishDocumentSelection, true);
      document.removeEventListener("mouseup", finishDocumentSelection, true);
      table.removeEventListener("pointerdown", beginCellSelection);
      table.removeEventListener("pointermove", updateCellSelection);
      document.removeEventListener("pointerup", finishCellSelection, true);
      document.removeEventListener("pointercancel", cancelCellSelection, true);
      if (finishFrame !== null) cancelAnimationFrame(finishFrame);
    });
    return container;
  }

  toDOM(view: EditorView): HTMLElement {
    if (!this.editable) return this.createReadonlyDOM(view);
    const wrapper = document.createElement("div");
    wrapper.className = "mk-cm-table-wrapper";
    wrapper.dataset.tableFrom = String(this.tableFrom);
    wrapper.tabIndex = 0;
    const container = measuredBlockWidget(wrapper, "table");
    wrapper.addEventListener("pointerdown", (event) => event.stopPropagation());
    const announceTableContext = () => {
      (view.dom.parentElement ?? view.dom).dispatchEvent(new CustomEvent(tableContextChangeEvent, {
        bubbles: true,
        detail: { tableFrom: this.tableFrom },
      }));
    };
    wrapper.addEventListener("pointerdown", announceTableContext, true);
    wrapper.addEventListener("focusin", announceTableContext);

    let cellDrag: {
      pointerId: number;
      anchor: { row: number; column: number };
      focus: { row: number; column: number };
      dragged: boolean;
    } | null = null;

    const extendDocumentSelectionThroughRow = (event: MouseEvent) => {
      if ((event.buttons & 1) === 0 || cellDrag) return;
      const cell = document.elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("th[data-table-row], td[data-table-row]");
      if (!cell || !wrapper.contains(cell)) return;
      const renderedRow = Number(cell.dataset.tableRow);
      if (!Number.isInteger(renderedRow) || renderedRow < 0) return;

      queueMicrotask(() => {
        const selection = view.state.selection.main;
        if (selection.empty || (selection.anchor > this.tableFrom && selection.anchor < this.tableTo)) return;
        const sourceLineIndex = renderedRow === 0 ? 0 : renderedRow + 1;
        const firstLine = view.state.doc.lineAt(this.tableFrom);
        const sourceLineNumber = firstLine.number + sourceLineIndex;
        if (sourceLineNumber > view.state.doc.lines) return;
        const sourceLine = view.state.doc.line(sourceLineNumber);
        const head = selection.anchor <= this.tableFrom ? sourceLine.to : sourceLine.from;
        if (selection.head !== head) view.dispatch({ selection: { anchor: selection.anchor, head } });
      });
    };

    let draft: MarkdownTable = {
      rows: this.model.rows.map((row) => [...row]),
      alignments: [...this.model.alignments],
      ...(this.model.columnWeights ? { columnWeights: [...this.model.columnWeights] } : {}),
    };
    let dirty = false;
    const composition = new TableCellCompositionGuard();
    const animationFrameIds = new Set<number>();
    const scheduleFrame = (callback: FrameRequestCallback) => {
      const id = requestAnimationFrame((time) => {
        animationFrameIds.delete(id);
        callback(time);
      });
      animationFrameIds.add(id);
    };
    let active: { row: number; column: number } | null = null;
    let selection: TableSelection | null = null;
    let wholeTableSelected = false;
    let clearingToolbarSelection = false;
    const clearSelectedFromToolbar = () => {
      if (!this.selectedFromToolbar || clearingToolbarSelection) return;
      clearingToolbarSelection = true;
      scheduleFrame(() => view.dispatch({ effects: selectWholeTableEffect.of(null) }));
    };
    // 默认按表格内容收缩，避免只有少量列时无意义地铺满编辑区。
    let wrapsContent = this.widthMode === "content";

    const focusCell = (row: number, column: number, selectAll = false) => {
      scheduleFrame(() => {
        const current = view.dom.querySelector<HTMLTextAreaElement>(
          `.mk-cm-table-wrapper[data-table-from="${this.tableFrom}"] .mk-cm-table-input[data-table-row="${row}"][data-table-column="${column}"]`,
        );
        if (!current) return;
        current.hidden = false;
        current.parentElement?.querySelector<HTMLElement>(".mk-cm-table-cell-content")?.classList.add("is-editing");
        current.focus();
        if (selectAll) {
          current.select();
        } else {
          const len = current.value.length;
          current.setSelectionRange(len, len);
        }
      });
    };

    const commit = (focus?: { row: number; column: number }) => {
      const previous = active;
      if (!dirty) {
        if (focus) focusCell(focus.row, focus.column, true);
        else if (previous) {
          const input = wrapper.querySelector<HTMLTextAreaElement>(`.mk-cm-table-input[data-table-row="${previous.row}"][data-table-column="${previous.column}"]`);
          if (input) input.hidden = true;
          input?.parentElement?.querySelector<HTMLElement>(".mk-cm-table-cell-content")?.classList.remove("is-editing");
        }
        return;
      }
      const insert = serializeMarkdownTable(draft);
      dirty = false;
      if (insert !== this.source) view.dispatch({ changes: { from: this.tableFrom, to: this.tableTo, insert } });
      if (focus) focusCell(focus.row, focus.column);
    };

    const cancel = () => {
      draft = {
        rows: this.model.rows.map((row) => [...row]),
        alignments: [...this.model.alignments],
        ...(this.model.columnWeights ? { columnWeights: [...this.model.columnWeights] } : {}),
      };
      dirty = false;
      wrapper.querySelectorAll<HTMLTextAreaElement>(".mk-cm-table-input").forEach((input) => {
        const row = Number(input.dataset.tableRow);
        const column = Number(input.dataset.tableColumn);
        input.value = draft.rows[row]?.[column] ?? "";
        input.hidden = true;
        input.parentElement?.querySelector<HTMLElement>(".mk-cm-table-cell-content")?.classList.remove("is-editing");
      });
      active = null;
    };

    const refreshToolbar = () => {
      const column = selection?.kind === "column" ? selection.index : -1;
      const row = selection?.kind === "row" ? selection.index : -1;
      columnTools.hidden = column < 0;
      rowTools.hidden = row < 0;
      moveColumnLeftButton.disabled = column <= 0;
      moveColumnRightButton.disabled = column < 0 || column >= draft.alignments.length - 1;
      deleteColumnButton.disabled = column < 0 || draft.alignments.length <= 1;
      insertRowAboveButton.disabled = row < 0;
      deleteRowButton.disabled = row < 0 || draft.rows.length <= 1;
    };

    const updateSelection = (next: TableSelection, selectWholeTable = false) => {
      if (next.kind === "range") {
        const bounds = tableSelectionBounds(draft, next);
        const isWholeRow = bounds.top === bounds.bottom
          && bounds.left === 0
          && bounds.right === draft.alignments.length - 1;
        const isWholeColumn = bounds.left === bounds.right
          && bounds.top === 0
          && bounds.bottom === draft.rows.length - 1;
        selection = isWholeRow && !isWholeColumn
          ? { kind: "row", index: bounds.top }
          : isWholeColumn && !isWholeRow
            ? { kind: "column", index: bounds.left }
            : next;
      } else {
        selection = next;
      }
      wholeTableSelected = selectWholeTable;
      if (!selectWholeTable) clearSelectedFromToolbar();
      wrapper.classList.toggle("is-toolbar-selected", wholeTableSelected);
      wrapper.querySelectorAll(".mk-table-selected").forEach((element) => element.classList.remove("mk-table-selected"));
      const bounds = tableSelectionBounds(draft, selection);
      wrapper.querySelectorAll<HTMLElement>("th[data-table-row][data-table-column], td[data-table-row][data-table-column]").forEach((element) => {
        const row = Number(element.dataset.tableRow);
        const column = Number(element.dataset.tableColumn);
        if (row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right) {
          element.classList.add("mk-table-selected");
        }
      });
      refreshToolbar();
    };

    const clearSelection = () => {
      selection = null;
      wholeTableSelected = false;
      wrapper.classList.remove("is-toolbar-selected");
      clearSelectedFromToolbar();
      wrapper.querySelectorAll(".mk-table-selected").forEach((element) => element.classList.remove("mk-table-selected"));
      refreshToolbar();
    };

    const cellAtPoint = (x: number, y: number) => {
      const target = document.elementFromPoint(x, y)
        ?.closest<HTMLElement>("th[data-table-row][data-table-column], td[data-table-row][data-table-column]");
      if (!target || !wrapper.contains(target)) return null;
      const row = Number(target.dataset.tableRow);
      const column = Number(target.dataset.tableColumn);
      return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
    };
    const updateCellDrag = (event: PointerEvent) => {
      if (!cellDrag || event.pointerId !== cellDrag.pointerId) return;
      const next = cellAtPoint(event.clientX, event.clientY);
      if (!next || (next.row === cellDrag.focus.row && next.column === cellDrag.focus.column)) return;
      cellDrag.focus = next;
      const dragged = next.row !== cellDrag.anchor.row || next.column !== cellDrag.anchor.column;
      cellDrag.dragged = cellDrag.dragged || dragged;
      updateSelection({ kind: "range", anchor: cellDrag.anchor, focus: next });
    };
    const finishCellDrag = (event: PointerEvent, cancelled = false) => {
      if (!cellDrag || event.pointerId !== cellDrag.pointerId) return;
      if (!cancelled) updateCellDrag(event);
      const completed = cellDrag;
      cellDrag = null;
      if (completed.dragged) wrapper.focus({ preventScroll: true });
      else if (!cancelled) {
        focusCell(completed.anchor.row, completed.anchor.column);
      }
    };
    const cancelCellDrag = (event: PointerEvent) => finishCellDrag(event, true);
    wrapper.addEventListener("pointermove", updateCellDrag);

    const dispatchOperation = (operation: TableOperation, focus: { row: number; column: number }) => {
      const next = applyTableOperation(draft, operation);
      const insert = serializeMarkdownTable(next);
      view.dispatch({ changes: { from: this.tableFrom, to: this.tableTo, insert } });
      const nextFocus = tableOperationFocus(draft, operation, focus);
      focusCell(nextFocus.row, nextFocus.column);
    };

    const makeButton = (label: string, icon: LucideIcon | string, onClick: () => void, disabled = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mk-table-tool-button";
      button.dataset.tooltip = label;
      button.setAttribute("aria-label", label);
      button.disabled = disabled;
      button.innerHTML = typeof icon === "string" ? icon : iconMarkup(icon);
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
      return button;
    };

    const toolbar = document.createElement("div");
    toolbar.className = "mk-table-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "表格操作");

    const showTableSource = () => {
      const insert = serializeMarkdownTable(draft);
      view.dispatch({
        changes: dirty && insert !== this.source
          ? { from: this.tableFrom, to: this.tableTo, insert }
          : undefined,
        selection: { anchor: this.tableFrom },
        effects: editTableSourceEffect.of(this.tableFrom),
        scrollIntoView: true,
      });
      view.focus();
    };
    const selectWholeTable = () => {
      view.dispatch({ effects: selectWholeTableEffect.of(this.tableFrom) });
    };
    const sourceButton = makeButton("编辑 Markdown 源码", Code2, showTableSource);
    const selectTableButton = makeButton("选中整张表格", Table2, selectWholeTable);
    toolbar.append(selectTableButton);

    const columnTools = document.createElement("div");
    columnTools.className = "mk-table-toolbar-group";
    columnTools.dataset.tools = "column";
    const columnIndex = () => selection?.kind === "column" ? selection.index : -1;
    const insertColumnLeftButton = makeButton("在左侧插入列", ArrowLeftToLine, () => dispatchOperation(
        { type: "insert-column", index: columnIndex(), side: "left" },
        { row: 0, column: columnIndex() },
      ));
    const insertColumnRightButton = makeButton("在右侧插入列", ArrowRightToLine, () => dispatchOperation(
        { type: "insert-column", index: columnIndex(), side: "right" },
        { row: 0, column: columnIndex() + 1 },
      ));
    const moveColumnLeftButton = makeButton("向左移动列", ArrowLeft, () => dispatchOperation(
        { type: "move-column", index: columnIndex(), direction: "left" },
        { row: 0, column: columnIndex() - 1 },
      ));
    const moveColumnRightButton = makeButton("向右移动列", ArrowRight, () => dispatchOperation(
        { type: "move-column", index: columnIndex(), direction: "right" },
        { row: 0, column: columnIndex() + 1 },
      ));
    const deleteColumnButton = makeButton("删除列", Trash2, () => dispatchOperation(
        { type: "delete-column", index: columnIndex() },
        { row: 0, column: Math.min(columnIndex(), draft.alignments.length - 2) },
      ));
    columnTools.append(
      insertColumnLeftButton,
      insertColumnRightButton,
      moveColumnLeftButton,
      moveColumnRightButton,
      deleteColumnButton,
    );

    const rowTools = document.createElement("div");
    rowTools.className = "mk-table-toolbar-group";
    rowTools.dataset.tools = "row";
    const rowIndex = () => selection?.kind === "row" ? selection.index : -1;
    const insertRowAboveButton = makeButton("在上方插入行", ArrowUpToLine, () => dispatchOperation(
        { type: "insert-row", index: rowIndex(), side: "above" },
        { row: rowIndex(), column: 0 },
      ));
    const insertRowBelowButton = makeButton("在下方插入行", ArrowDownToLine, () => dispatchOperation(
        { type: "insert-row", index: rowIndex(), side: "below" },
        { row: rowIndex() + 1, column: 0 },
      ));
    const deleteRowButton = makeButton("删除行", Trash2, () => dispatchOperation(
        { type: "delete-row", index: rowIndex() },
        { row: Math.max(0, Math.min(rowIndex(), draft.rows.length - 2)), column: 0 },
      ));
    rowTools.append(
      insertRowAboveButton,
      insertRowBelowButton,
      deleteRowButton,
    );
    const toolbarEnd = document.createElement("div");
    toolbarEnd.className = "mk-table-toolbar-end";
    const currentTableWidthMode = () => wrapsContent ? "content" : "window";
    const nextTableWidthMode = () => currentTableWidthMode() === "content" ? "window" : "content";
    const currentTableWidthModeLabel = () => currentTableWidthMode() === "window" ? "根据窗口调整布局" : "根据内容调整布局";
    const nextTableWidthModeLabel = () => nextTableWidthMode() === "window" ? "根据窗口调整布局" : "根据内容调整布局";
    const tableWidthModeTooltip = () => `当前：${currentTableWidthModeLabel()}；点击切换为${nextTableWidthModeLabel()}`;
    const wrapButton = makeButton(tableWidthModeTooltip(), tableWidthModeIconMarkup(currentTableWidthMode()), () => {
      const nextMode = nextTableWidthMode();
      wrapsContent = nextMode === "content";
      wrapper.classList.toggle("is-wrap", wrapsContent);
      const label = tableWidthModeTooltip();
      wrapButton.dataset.tooltip = label;
      wrapButton.setAttribute("aria-label", label);
      wrapButton.innerHTML = tableWidthModeIconMarkup(currentTableWidthMode());
      view.dispatch({
        effects: setTableWidthModeEffect.of({ scope: "table", tableFrom: this.tableFrom, mode: nextMode }),
      });
      announceTableContext();
      scheduleFrame(positionDragHandles);
    });
    wrapButton.classList.add("mk-table-width-mode-button");
    wrapper.classList.toggle("is-wrap", wrapsContent);
    toolbarEnd.append(wrapButton, sourceButton);
    toolbar.append(columnTools, rowTools, toolbarEnd);
    refreshToolbar();
    wrapper.append(toolbar);

    const table = document.createElement("table");
    table.className = "mk-cm-table";
    const hasDistinctWeights = Boolean(
      draft.columnWeights
      && draft.columnWeights.length > 0
      && !draft.columnWeights.every((w) => w === draft.columnWeights![0]),
    );
    if (hasDistinctWeights) {
      const colgroup = document.createElement("colgroup");
      const totalWeight = draft.columnWeights!.reduce((sum, w) => sum + w, 0);
      draft.columnWeights!.forEach((weight) => {
        const col = document.createElement("col");
        if (totalWeight > 0) {
          col.style.width = `${((weight / totalWeight) * 100).toFixed(2)}%`;
        }
        colgroup.append(col);
      });
      table.append(colgroup);
    }
    const tableScroll = document.createElement("div");
    tableScroll.className = "mk-cm-table-scroll";
    const columnDragLayer = document.createElement("div");
    columnDragLayer.className = "mk-table-column-drag-layer";
    const rowDragLayer = document.createElement("div");
    rowDragLayer.className = "mk-table-row-drag-layer";
    const columnElements = new Map<number, HTMLTableCellElement>();
    const rowElements = new Map<number, HTMLTableRowElement>();
    const columnDragHandles = new Map<number, HTMLButtonElement>();
    const rowDragHandles = new Map<number, HTMLButtonElement>();
    const columnHandleHideTimers = new Map<number, number>();
    const rowHandleHideTimers = new Map<number, number>();

    const setColumnDragHandleVisible = (column: number, visible: boolean) => {
      const handle = columnDragHandles.get(column);
      if (!handle || handle.hidden) return;
      const pending = columnHandleHideTimers.get(column);
      if (pending !== undefined) window.clearTimeout(pending);
      if (visible) {
        handle.classList.add("is-visible");
        return;
      }
      columnHandleHideTimers.set(column, window.setTimeout(() => {
        if (!handle.matches(":hover")) handle.classList.remove("is-visible");
      }, 120));
    };

    const setRowDragHandleVisible = (row: number, visible: boolean) => {
      const handle = rowDragHandles.get(row);
      if (!handle || handle.hidden) return;
      const pending = rowHandleHideTimers.get(row);
      if (pending !== undefined) window.clearTimeout(pending);
      if (visible) {
        handle.classList.add("is-visible");
        return;
      }
      rowHandleHideTimers.set(row, window.setTimeout(() => {
        if (!handle.matches(":hover")) handle.classList.remove("is-visible");
      }, 120));
    };

    const positionColumnDragHandles = () => {
      const wrapperBounds = wrapper.getBoundingClientRect();
      const scrollBounds = tableScroll.getBoundingClientRect();
      columnDragHandles.forEach((handle, column) => {
        const columnElement = columnElements.get(column);
        if (!columnElement) return;
        const columnBounds = columnElement.getBoundingClientRect();
        const isVisible = columnBounds.right > scrollBounds.left && columnBounds.left < scrollBounds.right;
        handle.hidden = !isVisible;
        if (!isVisible) handle.classList.remove("is-visible");
        handle.style.left = `${Math.round(columnBounds.left - wrapperBounds.left + columnBounds.width / 2)}px`;
        handle.style.top = `${Math.round(scrollBounds.top - wrapperBounds.top - 10)}px`;
      });
    };

    const positionRowDragHandles = () => {
      const wrapperBounds = wrapper.getBoundingClientRect();
      const scrollBounds = tableScroll.getBoundingClientRect();
      rowDragHandles.forEach((handle, row) => {
        const rowElement = rowElements.get(row);
        if (!rowElement) return;
        const rowBounds = rowElement.getBoundingClientRect();
        const isVisible = rowBounds.right > scrollBounds.left && rowBounds.left < scrollBounds.right;
        handle.hidden = !isVisible;
        if (!isVisible) handle.classList.remove("is-visible");
        handle.style.top = `${Math.round(rowBounds.top - wrapperBounds.top + rowBounds.height / 2)}px`;
      });
    };
    const positionDragHandles = () => {
      positionColumnDragHandles();
      positionRowDragHandles();
    };
    const dragHandleResizeObserver = new ResizeObserver(positionDragHandles);

    let contextMenu: HTMLElement | null = null;
    const closeContextMenu = () => {
      contextMenu?.remove();
      contextMenu = null;
    };

    const selected = () => selection ?? {
      kind: "cell" as const,
      anchor: active ?? { row: 0, column: 0 },
      focus: active ?? { row: 0, column: 0 },
    };
    const selectionOrigin = () => {
      const bounds = tableSelectionBounds(draft, selected());
      return { row: bounds.top, column: bounds.left };
    };
    const selectionIsWholeTable = () => tableSelectionCoversWholeTable(draft, selected());
    const selectionClipboardText = () => selectionIsWholeTable()
      ? serializeMarkdownTable(draft)
      : tableSelectionToTsv(draft, selected());
    const removeWholeTable = () => {
      view.dispatch({
        changes: { from: this.tableFrom, to: this.tableTo, insert: "" },
        selection: { anchor: this.tableFrom },
        scrollIntoView: true,
      });
      view.focus();
    };
    const replaceTable = (next: MarkdownTable, nextSelection?: TableSelection) => {
      draft = next;
      dirty = false;
      if (nextSelection) selection = nextSelection;
      view.dispatch({
        changes: { from: this.tableFrom, to: this.tableTo, insert: serializeMarkdownTable(next) },
      });
      const origin = nextSelection ? tableSelectionBounds(next, nextSelection) : null;
      if (origin) focusCell(origin.top, origin.left);
    };

    let reorderDrag: {
      pointerId: number;
      kind: "column" | "row";
      source: number;
      placement: number | null;
      ghost: HTMLElement;
      offsetX: number;
      offsetY: number;
    } | null = null;
    let dropIndicator: HTMLElement | null = null;
    const dragSourceElements = (kind: "column" | "row", index: number) => kind === "column"
      ? Array.from(table.querySelectorAll<HTMLElement>(`th[data-table-column="${index}"], td[data-table-column="${index}"]`))
      : Array.from(table.querySelectorAll<HTMLElement>(`tr:has([data-table-row="${index}"])`));
    const setDragSource = (kind: "column" | "row", index: number, active: boolean) => {
      dragSourceElements(kind, index).forEach((element) => element.classList.toggle("mk-table-drag-source", active));
    };
    const createDragGhost = (kind: "column" | "row", index: number, event: PointerEvent) => {
      const sourceElements = kind === "column"
        ? Array.from(table.querySelectorAll<HTMLTableCellElement>(`thead th[data-table-column="${index}"]`)).slice(0, 1)
        : Array.from(table.querySelectorAll<HTMLTableCellElement>(`tr:has([data-table-row="${index}"]) > th, tr:has([data-table-row="${index}"]) > td`));
      const firstRect = sourceElements[0]?.getBoundingClientRect();
      if (!firstRect) return null;

      const ghost = document.createElement("div");
      ghost.className = `mk-table-drag-ghost mk-table-drag-ghost--${kind}`;
      ghost.style.width = kind === "column"
        ? `${firstRect.width}px`
        : `${sourceElements.reduce((total, element) => total + element.getBoundingClientRect().width, 0)}px`;
      sourceElements.forEach((element) => {
        const rect = element.getBoundingClientRect();
        const cell = document.createElement("div");
        cell.className = "mk-table-drag-ghost-cell";
        cell.style.width = kind === "row" ? `${rect.width}px` : "100%";
        cell.style.height = `${rect.height}px`;
        const content = element.querySelector<HTMLElement>(".mk-cm-table-cell-content")?.cloneNode(true);
        if (content instanceof HTMLElement) {
          content.removeAttribute("tabindex");
          cell.append(content);
        } else {
          cell.textContent = element.textContent;
        }
        ghost.append(cell);
      });
      document.body.append(ghost);
      return {
        ghost,
        offsetX: event.clientX - firstRect.left,
        offsetY: event.clientY - firstRect.top,
      };
    };
    const positionDragGhost = (event: PointerEvent) => {
      if (!reorderDrag) return;
      reorderDrag.ghost.style.transform = `translate3d(${Math.round(event.clientX - reorderDrag.offsetX)}px, ${Math.round(event.clientY - reorderDrag.offsetY)}px, 0)`;
    };
    const clearDragPreview = () => {
      if (reorderDrag) {
        setDragSource(reorderDrag.kind, reorderDrag.source, false);
        reorderDrag.ghost.remove();
      }
    };
    const clearDropIndicator = () => {
      dropIndicator?.remove();
      dropIndicator = null;
    };
    const columnPlacementAt = (x: number, y: number) => {
      const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th[data-table-column]"));
      const bounds = table.getBoundingClientRect();
      if (headers.length === 0 || y < bounds.top || y > bounds.bottom) return null;
      for (let index = 0; index < headers.length; index++) {
        const rect = headers[index].getBoundingClientRect();
        if (x < rect.left + rect.width / 2) return index;
      }
      return headers.length;
    };
    const rowPlacementAt = (x: number, y: number) => {
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("thead tr, tbody tr"));
      const bounds = table.getBoundingClientRect();
      if (rows.length === 0 || x < bounds.left || x > bounds.right) return null;
      for (let index = 0; index < rows.length; index++) {
        const rect = rows[index].getBoundingClientRect();
        if (y < rect.top + rect.height / 2) return index;
      }
      return rows.length;
    };
    const showDropIndicator = (kind: "column" | "row", placement: number) => {
      clearDropIndicator();
      const indicator = document.createElement("div");
      indicator.className = `mk-table-drop-indicator mk-table-drop-indicator--${kind}`;
      const tableBounds = table.getBoundingClientRect();
      if (kind === "column") {
        const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th[data-table-column]"));
        const target = headers[Math.min(placement, headers.length - 1)];
        if (!target) return;
        const targetBounds = target.getBoundingClientRect();
        indicator.style.left = `${Math.round(placement >= headers.length ? targetBounds.right : targetBounds.left) - 1}px`;
        indicator.style.top = `${Math.round(tableBounds.top)}px`;
        indicator.style.height = `${Math.round(tableBounds.height)}px`;
        document.body.append(indicator);
        dropIndicator = indicator;
        return;
      }
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("thead tr, tbody tr"));
      const target = rows[Math.min(placement, rows.length - 1)];
      if (!target) return;
      const targetBounds = target.getBoundingClientRect();
      indicator.style.left = `${Math.round(tableBounds.left)}px`;
      indicator.style.top = `${Math.round(placement >= rows.length ? targetBounds.bottom : targetBounds.top) - 1}px`;
      indicator.style.width = `${Math.round(tableBounds.width)}px`;
      document.body.append(indicator);
      dropIndicator = indicator;
    };
    const updateReorderDrag = (event: PointerEvent) => {
      if (!reorderDrag || event.pointerId !== reorderDrag.pointerId) return;
      positionDragGhost(event);
      const placement = reorderDrag.kind === "column"
        ? columnPlacementAt(event.clientX, event.clientY)
        : rowPlacementAt(event.clientX, event.clientY);
      if (placement === null) {
        if (reorderDrag.placement !== null) clearDropIndicator();
        reorderDrag.placement = null;
        return;
      }
      if (placement === reorderDrag.placement) return;
      reorderDrag.placement = placement;
      showDropIndicator(reorderDrag.kind, placement);
    };
    const finishReorderDrag = (event: PointerEvent, cancelled = false) => {
      if (!reorderDrag || event.pointerId !== reorderDrag.pointerId) return;
      updateReorderDrag(event);
      const completed = reorderDrag;
      clearDragPreview();
      reorderDrag = null;
      clearDropIndicator();
      if (cancelled || completed.placement === null) return;

      // 落点是插入位置，移除源行列后需要折算成最终索引。
      const target = completed.placement - (completed.placement > completed.source ? 1 : 0);
      if (target === completed.source) return;
      if (completed.kind === "column") {
        replaceTable(
          reorderTableColumn(draft, completed.source, target),
          { kind: "column", index: target },
        );
      } else {
        replaceTable(
          reorderTableRow(draft, completed.source, target),
          { kind: "row", index: target },
        );
      }
    };
    const cancelReorderDrag = (event: PointerEvent) => finishReorderDrag(event, true);
    const beginReorderDrag = (kind: "column" | "row", index: number, event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (dirty) {
        commit();
        return;
      }
      const preview = createDragGhost(kind, index, event);
      if (!preview) return;
      reorderDrag = {
        pointerId: event.pointerId,
        kind,
        source: index,
        placement: index,
        ...preview,
      };
      setDragSource(kind, index, true);
      updateSelection(kind === "column" ? { kind, index } : { kind, index });
      positionDragGhost(event);
      showDropIndicator(kind, index);
      wrapper.focus({ preventScroll: true });
    };
    const copySelection = async () => {
      await navigator.clipboard.writeText(selectionClipboardText());
    };
    const cutSelection = async () => {
      await copySelection();
      if (selectionIsWholeTable()) {
        removeWholeTable();
        return;
      }
      replaceTable(clearTableSelection(draft, selected()), selected());
    };
    const pasteSelection = async () => {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const result = pasteTableTsv(draft, selectionOrigin(), text);
      replaceTable(result.table, result.selection);
    };

    const openContextMenu = (row: number, column: number, x: number, y: number) => {
      closeContextMenu();
      const currentBounds = selection ? tableSelectionBounds(draft, selection) : null;
      if (!currentBounds
        || row < currentBounds.top || row > currentBounds.bottom
        || column < currentBounds.left || column > currentBounds.right) {
        updateSelection({ kind: "cell", anchor: { row, column }, focus: { row, column } });
      }

      const menu = document.createElement("div");
      menu.className = "mk-table-context-menu";
      menu.setAttribute("role", "menu");
      const separator = () => {
        const element = document.createElement("div");
        element.className = "mk-table-context-separator";
        element.setAttribute("role", "separator");
        menu.append(element);
      };
      const item = (label: string, icon: LucideIcon, action: () => void | Promise<void>, disabled = false) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mk-table-context-item";
        button.setAttribute("role", "menuitem");
        button.disabled = disabled;
        button.innerHTML = `${iconMarkup(icon)}<span>${label}</span>`;
        button.addEventListener("click", () => {
          closeContextMenu();
          void action();
        });
        menu.append(button);
      };

      item("剪切", Scissors, cutSelection);
      item("复制", Copy, copySelection);
      item("粘贴", ClipboardPaste, pasteSelection);
      separator();
      item("选中当前行", Rows3, () => updateSelection({ kind: "row", index: row }));
      item("选中当前列", Columns3, () => updateSelection({ kind: "column", index: column }));
      separator();
      item("在上方插入行", ArrowUpToLine, () => dispatchOperation(
        { type: "insert-row", index: row, side: "above" },
        { row, column },
      ));
      item("在下方插入行", ArrowDownToLine, () => dispatchOperation(
        { type: "insert-row", index: row, side: "below" },
        { row: row + 1, column },
      ));
      item("在左侧插入列", ArrowLeftToLine, () => dispatchOperation(
        { type: "insert-column", index: column, side: "left" },
        { row, column },
      ));
      item("在右侧插入列", ArrowRightToLine, () => dispatchOperation(
        { type: "insert-column", index: column, side: "right" },
        { row, column: column + 1 },
      ));
      separator();
      item("向左移动列", ArrowLeft, () => dispatchOperation(
        { type: "move-column", index: column, direction: "left" },
        { row, column: column - 1 },
      ), column <= 0);
      item("向右移动列", ArrowRight, () => dispatchOperation(
        { type: "move-column", index: column, direction: "right" },
        { row, column: column + 1 },
      ), column >= draft.alignments.length - 1);
      item("删除当前行", Trash2, () => dispatchOperation(
        { type: "delete-row", index: row },
        { row: Math.min(row, draft.rows.length - 2), column },
      ), draft.rows.length <= 1);
      item("删除当前列", Trash2, () => dispatchOperation(
        { type: "delete-column", index: column },
        { row, column: Math.min(column, draft.alignments.length - 2) },
      ), draft.alignments.length <= 1);

      document.body.append(menu);
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - width - 6))}px`;
      menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - height - 6))}px`;
      contextMenu = menu;
      menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    };

    const hasNativeInputSelection = (event: ClipboardEvent) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      return Boolean(input && input.selectionStart !== input.selectionEnd);
    };
    wrapper.addEventListener("copy", (event) => {
      if (hasNativeInputSelection(event)) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", selectionClipboardText());
    });
    wrapper.addEventListener("cut", (event) => {
      if (hasNativeInputSelection(event)) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", selectionClipboardText());
      if (selectionIsWholeTable()) {
        removeWholeTable();
        return;
      }
      replaceTable(clearTableSelection(draft, selected()), selected());
    });
    wrapper.addEventListener("paste", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      event.preventDefault();
      const result = pasteTableTsv(draft, selectionOrigin(), text);
      replaceTable(result.table, result.selection);
    });
    wrapper.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selection) {
        event.preventDefault();
        replaceTable(clearTableSelection(draft, selection), selection);
      } else if (event.key === "Escape") {
        closeContextMenu();
      }
    });

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const insideContextMenu = Boolean(contextMenu?.contains(target));
      const insideTableWidthControls = target instanceof Element
        && Boolean(target.closest("[data-mk-table-width-controls]"));
      if (contextMenu && !insideContextMenu) closeContextMenu();
      if (!wrapper.contains(target) && !insideContextMenu && !insideTableWidthControls) {
        clearSelection();
        // 此时仍处在 pointerdown 捕获阶段。提前 blur/commit 会重建表格 DOM，
        // 让 CodeMirror 随后的坐标换算落到下一行；交给浏览器的正常焦点切换提交即可。
      }
    };
    const closeOnScroll = () => closeContextMenu();
    const revealColumnDragHandle = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const columnCell = event.target.closest<HTMLTableCellElement>("th[data-table-column]");
      if (!columnCell || !table.contains(columnCell)) return;
      setColumnDragHandleVisible(Number(columnCell.dataset.tableColumn), true);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("pointermove", extendDocumentSelectionThroughRow, true);
    document.addEventListener("mousemove", extendDocumentSelectionThroughRow, true);
    document.addEventListener("pointermove", updateReorderDrag, true);
    document.addEventListener("pointerup", finishCellDrag, true);
    document.addEventListener("pointercancel", cancelCellDrag, true);
    document.addEventListener("pointerup", finishReorderDrag, true);
    document.addEventListener("pointercancel", cancelReorderDrag, true);
    window.addEventListener("scroll", closeOnScroll, true);
    wrapper.addEventListener("pointerover", revealColumnDragHandle);
    this.cleanups.set(container, () => {
      closeContextMenu();
      clearDragPreview();
      animationFrameIds.forEach((id) => cancelAnimationFrame(id));
      animationFrameIds.clear();
      dragHandleResizeObserver.disconnect();
      columnDragHandles.forEach((_, column) => {
        const pending = columnHandleHideTimers.get(column);
        if (pending !== undefined) window.clearTimeout(pending);
      });
      rowDragHandles.forEach((_, row) => {
        const pending = rowHandleHideTimers.get(row);
        if (pending !== undefined) window.clearTimeout(pending);
      });
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("pointermove", extendDocumentSelectionThroughRow, true);
      document.removeEventListener("mousemove", extendDocumentSelectionThroughRow, true);
      document.removeEventListener("pointermove", updateReorderDrag, true);
      document.removeEventListener("pointerup", finishCellDrag, true);
      document.removeEventListener("pointercancel", cancelCellDrag, true);
      document.removeEventListener("pointerup", finishReorderDrag, true);
      document.removeEventListener("pointercancel", cancelReorderDrag, true);
      window.removeEventListener("scroll", closeOnScroll, true);
      wrapper.removeEventListener("pointerdown", announceTableContext, true);
      wrapper.removeEventListener("focusin", announceTableContext);
      wrapper.removeEventListener("pointerover", revealColumnDragHandle);
      tableScroll.removeEventListener("scroll", positionDragHandles);
    });

    const buildInput = (row: number, column: number) => {
      const cell = document.createElement("div");
      cell.className = "mk-cm-table-cell";
      const alignment = draft.alignments[column] ?? "none";
      const rendered = renderTableInlineMarkdown(draft.rows[row]?.[column] ?? "");
      rendered.dataset.tableRow = String(row);
      rendered.dataset.tableColumn = String(column);
      rendered.tabIndex = 0;
      rendered.setAttribute("aria-label", `第 ${row + 1} 行，第 ${column + 1} 列`);
      if (alignment !== "none") {
        rendered.style.textAlign = alignment;
      }

      const input = document.createElement("textarea");
      input.className = "mk-cm-table-input";
      input.hidden = true;
      input.value = draft.rows[row]?.[column] ?? "";
      input.dataset.tableRow = String(row);
      input.dataset.tableColumn = String(column);
      input.setAttribute("aria-label", `第 ${row + 1} 行，第 ${column + 1} 列`);
      if (alignment !== "none") {
        input.style.textAlign = alignment;
      }
      input.addEventListener("focus", () => {
        active = { row, column };
        updateSelection({ kind: "cell", anchor: { row, column }, focus: { row, column } });
      });
      input.addEventListener("pointerdown", (event) => {
        if (active && (active.row !== row || active.column !== column) && dirty) {
          event.preventDefault();
          event.stopPropagation();
          commit({ row, column });
        }
      });
      input.addEventListener("input", () => {
        if (!composition.acceptsInput) {
          input.value = draft.rows[row]?.[column] ?? "";
          return;
        }
        draft.rows[row][column] = input.value;
        dirty = true;
      });
      input.addEventListener("compositionstart", () => composition.start());
      input.addEventListener("compositionend", () => {
        if (composition.end() === "cancelled") {
          input.value = draft.rows[row]?.[column] ?? "";
          return;
        }
        draft.rows[row][column] = input.value;
        dirty = true;
        if (document.activeElement !== input) commit();
      });
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        const modifier = event.ctrlKey || event.metaKey;
        if (!dirty && modifier && event.key.toLowerCase() === "z") {
          event.preventDefault();
          (event.shiftKey ? redo : undo)(view);
          focusCell(row, column);
        } else if (!dirty && modifier && event.key.toLowerCase() === "y") {
          event.preventDefault();
          redo(view);
          focusCell(row, column);
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !composition.composing && !event.isComposing) {
          event.preventDefault();
          input.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          composition.cancel();
          cancel();
          input.blur();
        }
      });
      input.addEventListener("blur", () => {
        if (!composition.composing) commit();
        if (active?.row === row && active.column === column) active = null;
      });

      rendered.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (active && (active.row !== row || active.column !== column) && dirty) {
          commit({ row, column });
          return;
        }
        const current = selection;
        const nextSelection = tableCellPointerSelection(current, { row, column }, event.shiftKey);
        if (nextSelection.kind === "range") {
          updateSelection(nextSelection);
          rendered.focus();
          return;
        }

        const anchor = { row, column };
        cellDrag = { pointerId: event.pointerId, anchor, focus: anchor, dragged: false };
        updateSelection(nextSelection);
      });
      rendered.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === "F2") {
          event.preventDefault();
          focusCell(row, column);
        } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const rect = rendered.getBoundingClientRect();
          openContextMenu(row, column, rect.left + 8, rect.top + 8);
        }
      });
      rendered.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(row, column, event.clientX, event.clientY);
      });
      input.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(row, column, event.clientX, event.clientY);
      });
      cell.append(rendered, input);
      return cell;
    };

    const buildDragHandle = (kind: "column" | "row", index: number) => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `mk-table-${kind}-drag-handle`;
      handle.dataset.tooltip = kind === "column" ? "拖动列" : "拖动行";
      handle.setAttribute("aria-label", kind === "column" ? `拖动第 ${index + 1} 列` : `拖动第 ${index + 1} 行`);
      handle.innerHTML = iconMarkup(kind === "column" ? GripHorizontal : GripVertical);
      handle.addEventListener("pointerdown", (event) => beginReorderDrag(kind, index, event));
      if (kind === "column") {
        handle.addEventListener("pointerenter", () => setColumnDragHandleVisible(index, true));
        handle.addEventListener("pointerleave", () => setColumnDragHandleVisible(index, false));
      } else {
        handle.addEventListener("pointerenter", () => setRowDragHandleVisible(index, true));
        handle.addEventListener("pointerleave", () => setRowDragHandleVisible(index, false));
      }
      return handle;
    };

    const buildRow = (rowIndex: number, isHeader: boolean): HTMLTableRowElement => {
      const tr = document.createElement("tr");
      draft.rows[rowIndex].forEach((_, colIndex) => {
        const el = document.createElement(isHeader ? "th" : "td");
        el.dataset.tableRow = String(rowIndex);
        el.dataset.tableColumn = String(colIndex);
        const alignment = draft.alignments[colIndex] ?? "none";
        if (alignment !== "none") {
          el.style.textAlign = alignment;
        }
        const weight = draft.columnWeights?.[colIndex];
        if (weight !== undefined) {
          el.style.minWidth = `${Math.max(48, Math.min(320, weight * 24))}px`;
        }
        el.append(buildInput(rowIndex, colIndex));
        if (isHeader) {
          const columnHandle = buildDragHandle("column", colIndex);
          columnElements.set(colIndex, el);
          columnDragHandles.set(colIndex, columnHandle);
          columnDragLayer.append(columnHandle);
          el.addEventListener("pointerenter", () => setColumnDragHandleVisible(colIndex, true));
          el.addEventListener("pointerleave", () => setColumnDragHandleVisible(colIndex, false));
        }
        if (colIndex === 0) {
          const rowHandle = buildDragHandle("row", rowIndex);
          rowDragHandles.set(rowIndex, rowHandle);
          rowDragLayer.append(rowHandle);
          el.addEventListener("pointerenter", () => setRowDragHandleVisible(rowIndex, true));
          el.addEventListener("pointerleave", () => setRowDragHandleVisible(rowIndex, false));
        }
        tr.appendChild(el);
      });
      rowElements.set(rowIndex, tr);
      return tr;
    };

    if (draft.rows.length > 0) {
      const thead = document.createElement("thead");
      thead.appendChild(buildRow(0, true));
      table.appendChild(thead);
    }

    if (draft.rows.length > 1) {
      const tbody = document.createElement("tbody");
      for (let i = 1; i < draft.rows.length; i++) {
        tbody.appendChild(buildRow(i, false));
      }
      table.appendChild(tbody);
    }

    tableScroll.appendChild(table);
    wrapper.append(tableScroll, columnDragLayer, rowDragLayer);
    tableScroll.addEventListener("scroll", positionDragHandles);
    dragHandleResizeObserver.observe(wrapper);
    scheduleFrame(positionDragHandles);
    if (this.selectedFromToolbar) {
      updateSelection({
        kind: "range",
        anchor: { row: 0, column: 0 },
        focus: {
          row: draft.rows.length - 1,
          column: Math.max(draft.alignments.length, ...draft.rows.map((row) => row.length)) - 1,
        },
      }, this.selectedFromToolbar);
      if (this.selectedFromToolbar) scheduleFrame(() => wrapper.focus({ preventScroll: true }));
    } else if (this.documentSelectedRows.length > 0) {
      this.applyDocumentSelectedRows(wrapper);
    }
    return container;
  }

  destroy(dom: HTMLElement): void {
    this.cleanups.get(dom)?.();
    this.cleanups.delete(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }
}
