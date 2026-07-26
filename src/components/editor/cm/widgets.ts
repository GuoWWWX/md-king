import { WidgetType } from "@codemirror/view";
import { getCachedMermaidSvg, renderMermaid } from "@/lib/mermaid";

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
    const host = document.createElement("div");
    host.className = "mk-cm-mermaid";
    host.setAttribute("role", "img");

    const cached = getCachedMermaidSvg(this.source, this.dark);
    if (cached) {
      host.innerHTML = cached.svg;
      return host;
    }

    host.dataset.state = "loading";
    host.textContent = "正在渲染图表…";

    void renderMermaid(this.source, this.dark)
      .then(({ svg }) => {
        // 容器可能已经被 CM 回收（用户快速滚动或改了源码），
        // 这时候往里写东西没有意义，isConnected 判掉。
        if (!host.isConnected) return;
        delete host.dataset.state;
        host.innerHTML = svg;
      })
      .catch((error: unknown) => {
        if (!host.isConnected) return;
        host.dataset.state = "error";
        // 语法错误要给出原文，否则用户不知道图为什么画不出来。
        host.textContent = error instanceof Error ? error.message : "图表渲染失败";
      });

    return host;
  }

  /** 不吞事件：点击照常落到编辑器上，光标进入后就还原成源码。 */
  ignoreEvent(): boolean {
    return false;
  }
}
