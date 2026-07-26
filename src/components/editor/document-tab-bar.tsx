import { ClipboardPaste, FilePlus2, FileText, FileType2, Plus, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ContextMenu } from "radix-ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDocumentTabsStore, type DocumentTab } from "@/stores/document-tabs-store";
import { cn } from "@/lib/utils";

type DocumentTabBarProps = {
  onNewDocument: () => void;
  onImportFile?: () => void | Promise<void>;
  onBatchImport?: () => void | Promise<void>;
  onPasteClipboard: () => void | Promise<void>;
  /// 关闭一个有内容的临时标签前问一次。不传就直接关。
  onConfirmCloseScratch?: (tab: DocumentTab) => Promise<boolean>;
  /// 右侧额外按钮，比如「展开预览」。
  trailing?: ReactNode;
  className?: string;
};

export function DocumentTabBar({ onNewDocument, onImportFile, onBatchImport, onPasteClipboard, onConfirmCloseScratch, trailing, className }: DocumentTabBarProps) {
  const tabs = useDocumentTabsStore((state) => state.tabs);
  const activeTabId = useDocumentTabsStore((state) => state.activeTabId);
  const setActiveTab = useDocumentTabsStore((state) => state.setActiveTab);
  const closeTab = useDocumentTabsStore((state) => state.closeTab);
  const closeOtherTabs = useDocumentTabsStore((state) => state.closeOtherTabs);
  const closeAllTabs = useDocumentTabsStore((state) => state.closeAllTabs);
  const listRef = useRef<HTMLDivElement>(null);

  // 切到被滚动条挡住的标签时把它带回视野，否则用键盘或程序化激活后
  // 用户看不到当前在哪个文档上。
  useEffect(() => {
    if (!activeTabId) return;
    const node = listRef.current?.querySelector(`[data-tab-id="${activeTabId}"]`);
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  async function requestClose(tab: DocumentTab) {
    // vault 标签的内容在磁盘上，关了还能从文件树打开；临时标签关了就真没了。
    if (tab.kind === "scratch" && tab.dirty && onConfirmCloseScratch) {
      const confirmed = await onConfirmCloseScratch(tab);
      if (!confirmed) return;
    }
    closeTab(tab.id);
  }

  function handleAuxClick(event: ReactMouseEvent, tab: DocumentTab) {
    // 中键关闭：浏览器和编辑器的通用习惯，实现成本几乎为零。
    if (event.button !== 1) return;
    event.preventDefault();
    void requestClose(tab);
  }

  return (
    <div className={cn("flex h-10 shrink-0 items-center gap-1 rounded-[10px] border border-slate-200 bg-white px-1 dark:border-zinc-700/70 dark:bg-zinc-900/80", className)}>
      <div ref={listRef} className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden" role="tablist" aria-label="打开的文档">
        {tabs.length === 0 ? (
          <span className="truncate px-2 text-xs text-slate-400 dark:text-zinc-500">从左侧文件树打开文档，或新建一个</span>
        ) : (
          tabs.map((tab) => (
            <DocumentTabItem
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              tabCount={tabs.length}
              onSelect={() => setActiveTab(tab.id)}
              onRequestClose={() => void requestClose(tab)}
              onAuxClick={(event) => handleAuxClick(event, tab)}
              onCloseOthers={() => closeOtherTabs(tab.id)}
              onCloseAll={closeAllTabs}
            />
          ))
        )}
      </div>

      {trailing}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-7 shrink-0 rounded-[8px] text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="新建或导入文档"
            tooltipSide="bottom"
            aria-label="新建或导入文档"
          >
            <Plus className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40 p-1.5">
          <DropdownMenuItem onSelect={onNewDocument}>
            <FilePlus2 className="size-3.5 text-slate-500 dark:text-zinc-400" />
            新建文档
          </DropdownMenuItem>
          {onImportFile ? (
            <DropdownMenuItem onSelect={() => void Promise.resolve(onImportFile())}>
              <UploadCloud className="size-3.5 text-slate-500 dark:text-zinc-400" />
              导入文件
            </DropdownMenuItem>
          ) : null}
          {onBatchImport ? (
            <DropdownMenuItem onSelect={() => void Promise.resolve(onBatchImport())}>
              <UploadCloud className="size-3.5 text-slate-500 dark:text-zinc-400" />
              批量导入
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void Promise.resolve(onPasteClipboard())}>
            <ClipboardPaste className="size-3.5 text-slate-500 dark:text-zinc-400" />
            粘贴剪贴板
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

type DocumentTabItemProps = {
  tab: DocumentTab;
  active: boolean;
  tabCount: number;
  onSelect: () => void;
  onRequestClose: () => void;
  onAuxClick: (event: ReactMouseEvent) => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
};

const contextItemClass = "relative flex cursor-default select-none items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:data-[highlighted]:bg-zinc-800";

function DocumentTabItem({ tab, active, tabCount, onSelect, onRequestClose, onAuxClick, onCloseOthers, onCloseAll }: DocumentTabItemProps) {
  const [hoveringClose, setHoveringClose] = useState(false);
  const Icon = tab.kind === "scratch" ? FileType2 : FileText;
  // 脏标记平时是个圆点，鼠标移到它上面才变成关闭叉——VS Code 的做法，
  // 既能一眼看出未保存，又不必为关闭按钮单独留位置。
  const showDot = tab.dirty && !hoveringClose;

  return (
    // 用 ContextMenu 而不是「受控 DropdownMenu + 隐藏 trigger」：后者会给
    // trigger 挂上 pointer 事件，把同级关闭按钮的点击一并吞掉。
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          data-tab-id={tab.id}
          role="tab"
          aria-selected={active}
          tabIndex={0}
          title={tab.path ?? tab.title}
          className={cn(
            "group flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] border px-2 text-xs font-bold transition",
            active
              ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/16 dark:text-blue-100"
              : "border-transparent text-slate-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            // 临时文档没有落盘，用虚线边框提示它随时可能丢。
            tab.kind === "scratch" && "border-dashed",
            tab.kind === "scratch" && !active && "border-slate-300 dark:border-zinc-600",
          )}
          onClick={onSelect}
          onAuxClick={onAuxClick}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect();
            }
          }}
        >
          <Icon className="size-3.5 shrink-0 opacity-70" />
          <span className="max-w-[160px] truncate">{tab.title}</span>
          <button
            type="button"
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-[4px] transition",
              active ? "hover:bg-blue-200/70 dark:hover:bg-blue-500/30" : "hover:bg-slate-200 dark:hover:bg-zinc-700",
              !tab.dirty && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
            aria-label={`关闭 ${tab.title}`}
            onMouseEnter={() => setHoveringClose(true)}
            onMouseLeave={() => setHoveringClose(false)}
            onFocus={() => setHoveringClose(true)}
            onBlur={() => setHoveringClose(false)}
            onClick={(event) => {
              event.stopPropagation();
              onRequestClose();
            }}
          >
            {showDot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : <X className="size-3" />}
          </button>
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-36 rounded-[10px] border border-slate-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <ContextMenu.Item className={contextItemClass} onSelect={onRequestClose}>关闭</ContextMenu.Item>
          <ContextMenu.Item className={contextItemClass} onSelect={onCloseOthers} disabled={tabCount <= 1}>关闭其他</ContextMenu.Item>
          <ContextMenu.Item className={contextItemClass} onSelect={onCloseAll}>关闭全部</ContextMenu.Item>
          {tab.path ? (
            <>
              <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
              <ContextMenu.Item className={contextItemClass} onSelect={() => void navigator.clipboard.writeText(tab.path ?? "")}>复制路径</ContextMenu.Item>
            </>
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
