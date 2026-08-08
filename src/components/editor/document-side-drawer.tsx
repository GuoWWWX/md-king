import { FileText, ListTree, X, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { markdownOutlineRevealEvent, parseMarkdownOutline } from "@/lib/document-outline";
import { cn } from "@/lib/utils";
import { useDocumentTabsStore } from "@/stores/document-tabs-store";

export type DocumentDrawerView = "outline" | "info";

type DocumentSideDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: DocumentDrawerView;
  onViewChange: (view: DocumentDrawerView) => void;
  className?: string;
};

export function DocumentSideDrawer({ open, onOpenChange, view, onViewChange, className }: DocumentSideDrawerProps) {
  const tabs = useDocumentTabsStore((state) => state.tabs);
  const activeTabId = useDocumentTabsStore((state) => state.activeTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const outline = useMemo(() => parseMarkdownOutline(activeTab?.content ?? ""), [activeTab?.content]);

  function revealHeading(line: number) {
    if (!activeTab) return;
    window.dispatchEvent(new CustomEvent(markdownOutlineRevealEvent, { detail: { tabId: activeTab.id, line } }));
  }

  if (!open) return null;

  return (
    <aside className={cn("mk-document-side-panel mk-card flex h-full min-h-0 w-[340px] max-w-[40vw] shrink-0 flex-col overflow-hidden rounded-[5px] border border-slate-200 bg-white shadow-none dark:border-zinc-700 dark:bg-[#202020]", className)} aria-label="文档侧栏">
      <header className="flex shrink-0 items-center border-b border-slate-200 px-2 dark:border-zinc-800" role="tablist" aria-label="文档侧栏选项">
        <DrawerTab active={view === "outline"} icon={ListTree} label="文档目录" onClick={() => onViewChange("outline")} />
        <DrawerTab active={view === "info"} icon={FileText} label="文档信息" onClick={() => onViewChange("info")} />
        <Button variant="ghost" size="icon-sm" className="ml-auto rounded-[5px] text-slate-500 dark:text-zinc-400" title="关闭文档侧栏" aria-label="关闭文档侧栏" onClick={() => onOpenChange(false)}>
          <X className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {view === "outline" ? (
            !activeTab ? (
              <EmptyState>打开 Markdown 文档后显示标题目录。</EmptyState>
            ) : outline.length === 0 ? (
              <EmptyState>当前文档没有 Markdown 标题。</EmptyState>
            ) : (
              <nav aria-label="Markdown 文档目录" className="space-y-0.5">
                {outline.map((item) => (
                  <button
                    key={`${item.line}-${item.text}`}
                    type="button"
                    className="flex h-8 w-full items-center rounded-[5px] pr-2 text-left text-xs text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                    style={{ paddingLeft: `${8 + (item.level - 1) * 14}px` }}
                    onClick={() => revealHeading(item.line)}
                    title={`第 ${item.line} 行：${item.text}`}
                  >
                    <span className="truncate">{item.text}</span>
                  </button>
                ))}
              </nav>
            )
          ) : activeTab ? (
            <dl className="divide-y divide-slate-100 text-sm dark:divide-zinc-800">
              <InfoRow label="文件名称" value={activeTab.title} />
              <InfoRow label="文件类型" value={activeTab.kind === "vault" ? "本地 Markdown 文档" : "临时 Markdown 文档"} />
              <InfoRow label="文件路径" value={activeTab.path ?? "尚未保存到磁盘"} />
              <InfoRow label="编辑状态" value={activeTab.dirty ? "未保存修改" : "已保存"} />
              <InfoRow label="正文长度" value={`${activeTab.content.length.toLocaleString()} 个字符`} />
            </dl>
          ) : (
            <EmptyState>尚未打开 Markdown 文档。</EmptyState>
          )}
      </div>
    </aside>
  );
}

function DrawerTab({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-[5px] border-b-2 px-3 text-xs font-semibold transition-colors",
        active
          ? "border-slate-700 bg-slate-100 text-slate-950 shadow-sm dark:border-zinc-300 dark:bg-zinc-700 dark:text-zinc-50"
          : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
      )}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-2 py-10 text-center text-xs leading-5 text-slate-500 dark:text-zinc-400">{children}</p>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 py-2.5">
      <dt className="text-xs text-slate-500 dark:text-zinc-400">{label}</dt>
      <dd className="break-words text-xs leading-5 text-slate-800 dark:text-zinc-100">{value}</dd>
    </div>
  );
}
