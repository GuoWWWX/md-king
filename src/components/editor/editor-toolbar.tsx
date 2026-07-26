import type { EditorView } from "@codemirror/view";
import { Bold, ChevronDown, Code2, Image, Italic, Link, List, ListOrdered, Quote, Table2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipButton, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * 编辑器工具栏。
 *
 * 从 conversion-input-card.tsx 的 textarea selection 版本迁移而来：
 * 那边靠 `textarea.selectionStart/End` 拼字符串再回写整个 value，
 * 这里改成 CM 的 dispatch({changes, selection})——差别不只是写法，
 * 全量回写会让 CM 把整篇文档当成一次改动，undo 一步退回全文，装饰层也要整体重建。
 */

type ToolbarAction = "bold" | "italic" | "strike" | "code" | "quote" | "link" | "image" | "table";
type ListKind = "bullet" | "ordered" | "task";

export type EditorToolbarProps = {
  /** 传 null 表示 view 还没挂载（首帧或已卸载），此时所有按钮走 disabled 分支。 */
  getView: () => EditorView | null;
  disabled?: boolean;
  className?: string;
  /** 右侧插槽：放放大/折叠这类容器级按钮，工具栏本身不关心它们的语义。 */
  trailing?: ReactNode;
};

const toolbarGroups: Array<{ label: string; items: Array<{ action: ToolbarAction; label: string; icon: LucideIcon }> }> = [
  {
    label: "格式",
    items: [
      { action: "bold", label: "加粗", icon: Bold },
      { action: "italic", label: "斜体", icon: Italic },
    ],
  },
  {
    label: "结构",
    items: [{ action: "quote", label: "引用块", icon: Quote }],
  },
  {
    label: "插入",
    items: [
      { action: "link", label: "链接", icon: Link },
      { action: "image", label: "图片", icon: Image },
      { action: "table", label: "表格", icon: Table2 },
    ],
  },
];

const headingOptions = [
  { level: 1, label: "一级标题" },
  { level: 2, label: "二级标题" },
  { level: 3, label: "三级标题" },
  { level: 4, label: "四级标题" },
  { level: 5, label: "五级标题" },
  { level: 6, label: "六级标题" },
] as const;

const listOptions: Array<{ kind: ListKind; label: string; marker: string; icon: LucideIcon }> = [
  { kind: "bullet", label: "无序列表", marker: "-", icon: List },
  { kind: "ordered", label: "有序列表", marker: "1.", icon: ListOrdered },
  { kind: "task", label: "任务列表", marker: "- [ ]", icon: List },
];

export function EditorToolbar({ getView, disabled = false, className, trailing }: EditorToolbarProps) {
  /** 统一入口：拿不到 view 或处于禁用态就整体不动文档，避免各处重复判空。 */
  function withView(run: (view: EditorView) => void) {
    if (disabled) return;
    const view = getView();
    if (!view || view.state.readOnly) return;
    run(view);
    // 菜单项点完焦点在 DropdownMenu 上，不抢回来的话紧接着敲字会丢。
    view.focus();
  }

  /**
   * 用 before/after 包裹当前选区。选区为空时插入占位文本并选中它，
   * 用户可以直接覆盖着打字——比把光标放在中间更省一次操作。
   */
  function wrapSelection(before: string, after = before, placeholder = "文本") {
    withView((view) => {
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to);
      const body = selected || placeholder;
      const insert = `${before}${body}${after}`;
      view.dispatch({
        changes: { from, to, insert },
        // 无论有无选区都选中正文部分：有选区时保持原选中范围，空选区时选中占位符。
        selection: { anchor: from + before.length, head: from + before.length + body.length },
        scrollIntoView: true,
      });
    });
  }

  /**
   * 行首插入型元素（标题、列表、引用）。
   *
   * 关键点是「当前行非空就先换行」——直接在半行中间插 `## ` 会得到
   * `正在写的文字## 标题` 这种不成立的 Markdown。
   */
  function insertLinePrefix(marker: string, placeholder: string) {
    withView((view) => {
      const { from, to } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);
      const selected = view.state.sliceDoc(from, to);
      const body = selected || placeholder;
      // 光标已在行首、或行首到光标之间只有空白，就地插入；否则另起一行。
      const prefix = view.state.sliceDoc(line.from, from).trim() === "" ? "" : "\n";
      const insert = `${prefix}${marker} ${body}`;
      const bodyStart = from + prefix.length + marker.length + 1;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: bodyStart, head: bodyStart + body.length },
        scrollIntoView: true,
      });
    });
  }

  /** 块级插入（表格、代码块）：前后都要保证空行，否则 Markdown 会把它并进上一段。 */
  function insertBlock(body: string, cursorOffset: number, selectLength = 0) {
    withView((view) => {
      const { from, to } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);
      const prefix = view.state.sliceDoc(line.from, from).trim() === "" ? "" : "\n";
      const insert = `${prefix}${body}`;
      const anchor = from + prefix.length + cursorOffset;
      view.dispatch({
        changes: { from, to, insert },
        selection: selectLength > 0 ? { anchor, head: anchor + selectLength } : { anchor },
        scrollIntoView: true,
      });
    });
  }

  function handleAction(action: ToolbarAction) {
    switch (action) {
      case "bold":
        wrapSelection("**");
        return;
      case "italic":
        wrapSelection("*");
        return;
      case "strike":
        wrapSelection("~~");
        return;
      case "code":
        wrapSelection("`", "`", "代码");
        return;
      case "quote":
        insertLinePrefix(">", "引用内容");
        return;
      case "link":
        // 光标落在 URL 上（跳过 `[链接文本](`），因为文案通常要改、地址一定要填。
        insertBlock("[链接文本](https://)", 12, 8);
        return;
      case "image":
        insertBlock("![图片说明](图片地址)", 12, 4);
        return;
      case "table":
        insertBlock("| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n", 2, 3);
        return;
      default:
        return;
    }
  }

  function handleCodeBlock() {
    withView((view) => {
      const { from, to } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);
      const selected = view.state.sliceDoc(from, to);
      const body = selected || "代码";
      const prefix = view.state.sliceDoc(line.from, from).trim() === "" ? "" : "\n";
      const insert = `${prefix}\`\`\`\n${body}\n\`\`\`\n`;
      // 光标停在开头 ``` 的行尾，方便紧接着补语言标识。
      const anchor = from + prefix.length + 3;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor }, scrollIntoView: true });
    });
  }

  function handleList(kind: ListKind) {
    const option = listOptions.find((item) => item.kind === kind);
    if (!option) return;
    insertLinePrefix(option.marker, kind === "task" ? "待办事项" : "列表项");
  }

  return (
    <div className={cn("flex h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-700/70 dark:bg-slate-950/35", className)}>
      <div className="scrollbar-none flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden py-1 text-slate-700 dark:text-slate-300">
        <ToolbarMenuButton label="标题级别" triggerText="H" disabled={disabled}>
          <DropdownMenuLabel>标题级别</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {headingOptions.map(({ level, label }) => (
            <DropdownMenuItem key={level} onSelect={() => insertLinePrefix("#".repeat(level), "标题")}>
              <span className="w-7 font-mono text-xs text-slate-400 dark:text-zinc-500">H{level}</span>
              {label}
            </DropdownMenuItem>
          ))}
        </ToolbarMenuButton>

        <ToolbarMenuButton label="列表样式" icon={List} disabled={disabled}>
          <DropdownMenuLabel>列表样式</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {listOptions.map(({ kind, label, marker, icon: Icon }) => (
            <DropdownMenuItem key={kind} onSelect={() => handleList(kind)}>
              <Icon className="size-3.5 text-slate-500 dark:text-zinc-400" />
              <span className="min-w-0 flex-1">{label}</span>
              <span className="font-mono text-xs text-slate-400 dark:text-zinc-500">{marker}</span>
            </DropdownMenuItem>
          ))}
        </ToolbarMenuButton>

        <ToolbarMenuButton label="代码格式" icon={Code2} disabled={disabled}>
          <DropdownMenuLabel>代码格式</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => handleAction("code")}>
            <Code2 className="size-3.5 text-slate-500 dark:text-zinc-400" />
            行内代码
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleCodeBlock}>
            <Code2 className="size-3.5 text-slate-500 dark:text-zinc-400" />
            代码块
          </DropdownMenuItem>
        </ToolbarMenuButton>

        <ToolbarMenuSeparator />

        {toolbarGroups.map((group, groupIndex) => (
          <div key={group.label} className="flex shrink-0 items-center gap-1" aria-label={group.label}>
            {groupIndex > 0 ? <ToolbarMenuSeparator /> : null}
            {group.items.map(({ action, label, icon: Icon }) => (
              <TooltipButton
                key={action}
                type="button"
                className="mk-editor-tool-button flex size-8 items-center justify-center rounded-[8px] border border-transparent text-slate-700 transition hover:-translate-y-px hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800/80 dark:hover:text-white"
                disabled={disabled}
                tooltip={label}
                tooltipSide="bottom"
                aria-label={label}
                onClick={() => handleAction(action)}
              >
                <Icon className="size-3.5" />
              </TooltipButton>
            ))}
          </div>
        ))}
      </div>

      {trailing ? <div className="flex shrink-0 items-center gap-1">{trailing}</div> : null}
    </div>
  );
}

function ToolbarMenuSeparator() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-slate-200 dark:bg-zinc-700" aria-hidden="true" />;
}

function ToolbarMenuButton({ label, icon: Icon, triggerText, disabled = false, children }: { label: string; icon?: LucideIcon; triggerText?: string; disabled?: boolean; children: ReactNode }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mk-editor-tool-button flex h-8 items-center gap-1 rounded-[8px] border border-transparent px-2 text-slate-700 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800/80 dark:hover:text-white"
              disabled={disabled}
              aria-label={label}
            >
              {triggerText ? <span className="text-sm font-bold leading-none">{triggerText}</span> : Icon ? <Icon className="size-3.5" /> : null}
              <ChevronDown className="size-3 opacity-65" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-36 p-1.5">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
