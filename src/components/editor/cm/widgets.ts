import { WidgetType } from "@codemirror/view";

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
