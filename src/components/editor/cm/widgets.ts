import { EditorView, WidgetType } from "@codemirror/view";
import { getCachedMermaidSvg, renderMermaid } from "@/lib/mermaid";

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

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
    btn.title = "复制代码";
    btn.innerHTML = COPY_ICON;

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
    return false;
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
    span.textContent = this.depth % 3 === 0 ? "•" : this.depth % 3 === 1 ? "◦" : "▪";
    // 屏幕阅读器不该念出这个纯装饰字符，源码里的 `-` 才是语义所在。
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  /** 圆点是纯展示，不吞事件——让点击照常落到编辑器上定位光标。 */
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
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return other.source === this.source && other.dark === this.dark;
  }

  toDOM(): HTMLElement {
    // 分两层：外层挂语言标签和边框，内层专门放 SVG。
    // 不分层的话 innerHTML 会把标签一起冲掉。
    const host = document.createElement("div");
    host.className = "mk-cm-mermaid";
    host.dataset.codeLanguage = "mermaid";

    const canvas = document.createElement("div");
    canvas.className = "mk-cm-mermaid-canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Mermaid 图表");
    host.append(canvas);

    const cached = getCachedMermaidSvg(this.source, this.dark);
    if (cached) {
      canvas.innerHTML = cached.svg;
      return host;
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

    return host;
  }

  /** 不吞事件：点击照常落到编辑器上，光标进入后就还原成源码。 */
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * GFM 表格的渲染态 widget。
 *
 * 每行带源码位置信息，点击某行时精确把光标定位到该行源码处。
 * update 只在 docChanged 时重建，光标移入不切换源码态，
 * 用户可以直接在渲染态下点击定位、输入修改。
 */
export class TableWidget extends WidgetType {
  constructor(
    private readonly rows: { cells: { text: string; sourceFrom: number }[]; sourceFrom: number }[],
    private readonly source: string,
    private readonly tableFrom: number,
    private readonly tableTo: number,
    private readonly rawLines: string[],
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "mk-cm-table-wrapper";

    const table = document.createElement("table");
    table.className = "mk-cm-table";

    /** 重新拼装所有行（含原始分隔行），在指定列前/后插入空列，或在指定行前/后插入空行。 */
    const rebuildSource = (action: { type: "insert-col"; colIndex: number; after: boolean } | { type: "insert-row"; rowIndex: number; after: boolean }) => {
      const lines = [...this.rawLines];
      if (action.type === "insert-col") {
        const { colIndex, after } = action;
        return lines.map((line) => {
          const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
          const insertAt = after ? colIndex + 1 : colIndex;
          // 分隔行插入 ---- 格，其他行插入空格
          const isSepar = /^[\s:|\\-]+$/.test(cells[0] ?? "");
          cells.splice(insertAt, 0, isSepar ? " ---- " : "  ");
          return `| ${cells.join(" | ")} |`;
        }).join("\n");
      } else {
        // insert-row
        const headerLine = lines[0] ?? "";
        const colCount = headerLine.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").length;
        const newRow = `| ${Array(colCount).fill("  ").join(" | ")} |`;
        // rawLines 中 index 0=header, 1=separator, 2+= body rows
        // action.rowIndex 是在 this.rows（已过滤分隔行）中的行号
        // 转换到 rawLines 中的位置：header(0) + separator(1) + body offset
        // rowIndex=0 是 header，body 行从 rowIndex=1 开始对应 rawLines[2+]
        const rawInsertAt = action.rowIndex === 0
          ? (action.after ? 2 : 1)   // after header: before separator→不允许，after header→ 插在separator前
          : 2 + (action.rowIndex - 1) + (action.after ? 1 : 0);
        lines.splice(rawInsertAt, 0, newRow);
        return lines.join("\n");
      }
    };

    const showContextMenu = (e: MouseEvent, colIndex: number, rowIndex: number) => {
      e.preventDefault();
      // 移除旧菜单
      document.querySelectorAll(".mk-table-ctx-menu").forEach((el) => el.remove());

      const menu = document.createElement("div");
      menu.className = "mk-table-ctx-menu";
      menu.style.cssText = `position:fixed;z-index:9999;background:var(--popover,#fff);border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,0.12);min-width:160px;font-size:13px;`;

      const items: { label: string; action: Parameters<typeof rebuildSource>[0] }[] = [
        { label: "在左侧插入列", action: { type: "insert-col", colIndex, after: false } },
        { label: "在右侧插入列", action: { type: "insert-col", colIndex, after: true } },
        { label: "在上方插入行", action: { type: "insert-row", rowIndex, after: false } },
        { label: "在下方插入行", action: { type: "insert-row", rowIndex, after: true } },
      ];

      for (const item of items) {
        const el = document.createElement("div");
        el.textContent = item.label;
        el.style.cssText = "padding:6px 10px;border-radius:5px;cursor:pointer;color:var(--foreground,#0f172a);";
        el.addEventListener("mouseenter", () => { el.style.background = "var(--accent,#f1f5f9)"; });
        el.addEventListener("mouseleave", () => { el.style.background = ""; });
        el.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          menu.remove();
          const newSource = rebuildSource(item.action);
          view.dispatch({
            changes: { from: this.tableFrom, to: this.tableTo, insert: newSource },
            selection: { anchor: this.tableFrom },
          });
          view.focus();
        });
        menu.appendChild(el);
      }

      document.body.appendChild(menu);
      const rect = { left: e.clientX, top: e.clientY };
      menu.style.left = `${Math.min(rect.left, window.innerWidth - 180)}px`;
      menu.style.top = `${Math.min(rect.top, window.innerHeight - 200)}px`;

      const close = () => { menu.remove(); document.removeEventListener("mousedown", close); };
      setTimeout(() => document.addEventListener("mousedown", close), 0);
    };

    const buildRow = (rowIndex: number, isHeader: boolean): HTMLTableRowElement => {
      const tr = document.createElement("tr");
      const row = this.rows[rowIndex];
      row.cells.forEach((cell, colIndex) => {
        const el = document.createElement(isHeader ? "th" : "td");
        el.textContent = cell.text;
        // 左键点击：把光标定位到该格的源码位置（触发 selection → StateField 重建 → 切源码态）
        el.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          view.dispatch({ selection: { anchor: cell.sourceFrom } });
          view.focus();
        });
        // 右键：上下文菜单
        el.addEventListener("contextmenu", (e) => {
          showContextMenu(e, colIndex, rowIndex);
        });
        tr.appendChild(el);
      });
      return tr;
    };

    if (this.rows.length > 0) {
      const thead = document.createElement("thead");
      thead.appendChild(buildRow(0, true));
      table.appendChild(thead);
    }

    if (this.rows.length > 1) {
      const tbody = document.createElement("tbody");
      for (let i = 1; i < this.rows.length; i++) {
        tbody.appendChild(buildRow(i, false));
      }
      table.appendChild(tbody);
    }

    wrapper.appendChild(table);
    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
