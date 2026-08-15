import { CheckCircle2, CheckSquare, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock3, FileText, RotateCcw, Search, Trash2, XCircle, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HistoryRecordCard } from "@/components/history/history-record-card";
import { WorkspacePageHeader } from "@/components/layout/page-header";
import { appPageMeta } from "@/components/layout/page-meta";
import { AppSurface } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipAnchor, TooltipButton } from "@/components/ui/tooltip";
import { clearHistoryRemote, saveHistory } from "@/lib/tauri";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import type { HistoryItem } from "@/types";

function groupHistory(items: HistoryItem[]) {
  const today = new Date().toDateString();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toDateString();

  return {
    今天: items.filter((item) => new Date(item.createdAt).toDateString() === today),
    昨天: items.filter((item) => new Date(item.createdAt).toDateString() === yesterday),
    更早: items.filter((item) => {
      const date = new Date(item.createdAt).toDateString();
      return date !== today && date !== yesterday;
    }),
  };
}

export function HistoryPage() {
  const { history, templates, setHistory } = useAppStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [templateId, setTemplateId] = useState("all");
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);

  const filteredHistory = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return history.filter((item) => {
      const matchesQuery = !keyword || [item.inputPath, item.outputPath, item.errorMessage].filter(Boolean).join(" ").toLowerCase().includes(keyword);
      const matchesStatus = status === "all" || item.status === status;
      const matchesTemplate = templateId === "all" || item.templateId === templateId;
      return matchesQuery && matchesStatus && matchesTemplate;
    });
  }, [history, query, status, templateId]);

  const historyPageCount = Math.max(1, Math.ceil(filteredHistory.length / historyPageSize));
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const historyPageStart = (currentHistoryPage - 1) * historyPageSize;
  const pagedHistory = useMemo(
    () => filteredHistory.slice(historyPageStart, historyPageStart + historyPageSize),
    [filteredHistory, historyPageStart, historyPageSize],
  );
  const grouped = groupHistory(pagedHistory);
  const filteredHistoryIds = useMemo(() => filteredHistory.map((item) => item.id), [filteredHistory]);
  const filteredHistoryIdSet = useMemo(() => new Set(filteredHistoryIds), [filteredHistoryIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedFilteredCount = selectedIds.filter((id) => filteredHistoryIdSet.has(id)).length;
  const isCurrentFilterAllSelected = filteredHistoryIds.length > 0 && filteredHistoryIds.every((id) => selectedIdSet.has(id));
  const successCount = filteredHistory.filter((item) => item.status === "success").length;
  const failedCount = filteredHistory.filter((item) => item.status === "failed").length;
  const pendingCount = filteredHistory.filter((item) => item.status === "pending").length;
  // 在整个筛选结果里找选中项，而不是只在当前页找：否则翻页会静默把右侧详情
  // 换成新一页的第一条，用户以为自己还在看原来那条记录。
  const selectedRecord = filteredHistory.find((item) => item.id === selectedHistoryId) ?? pagedHistory[0];
  const selectedTemplateName = selectedRecord ? templates.find((template) => template.id === selectedRecord.templateId)?.name ?? selectedRecord.templateId ?? "未指定模板" : "";
  const hasActiveFilters = query.trim() !== "" || status !== "all" || templateId !== "all";

  useEffect(() => {
    setHistoryPage(1);
  }, [query, status, templateId]);

  useEffect(() => {
    if (historyPage > historyPageCount) setHistoryPage(historyPageCount);
  }, [historyPage, historyPageCount]);

  function resetFilters() {
    setQuery("");
    setStatus("all");
    setTemplateId("all");
  }

  async function handleClearHistory() {
    if (history.length === 0) {
      toast.info("当前没有可清空的转换历史");
      return;
    }

    try {
      const nextHistory = await clearHistoryRemote();
      setHistory(nextHistory);
      setSelectedIds([]);
      setSelectedHistoryId(null);
      toast.success("转换历史已清空");
    } catch (error) {
      setHistory([]);
      setSelectedIds([]);
      setSelectedHistoryId(null);
      toast.error(userFacingErrorMessage(error, "远程清空失败，已清空本地视图"));
    }
  }

  async function deleteHistory(ids: string[]) {
    const targetIds = Array.from(new Set(ids));
    const targetIdSet = new Set(targetIds);
    const targets = history.filter((item) => targetIdSet.has(item.id));
    if (targets.length === 0) return;

    const previousHistory = history;
    const previousSelectedIds = selectedIds;
    const previousSelectedHistoryId = selectedHistoryId;
    const nextHistory = history.filter((item) => !targetIdSet.has(item.id));
    setHistory(nextHistory);
    setSelectedIds((current) => current.filter((id) => !targetIdSet.has(id)));
    if (selectedHistoryId && targetIdSet.has(selectedHistoryId)) {
      setSelectedHistoryId(null);
    }

    try {
      const saved = await saveHistory(nextHistory);
      setHistory(saved);
      toast.success(`已删除 ${targets.length} 条历史记录`);
    } catch (error) {
      // 回滚必须连选中态一起恢复，否则记录回来了、勾选和详情却没了。
      setHistory(previousHistory);
      setSelectedIds(previousSelectedIds);
      setSelectedHistoryId(previousSelectedHistoryId);
      toast.error(userFacingErrorMessage(error, "删除历史记录失败"));
    }
  }

  function toggleSelect(item: HistoryItem) {
    setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]);
  }

  function selectCurrentFilter() {
    if (filteredHistoryIds.length === 0) return;
    setSelectedIds((current) => Array.from(new Set([...current, ...filteredHistoryIds])));
  }

  function unselectCurrentFilter() {
    setSelectedIds((current) => current.filter((id) => !filteredHistoryIdSet.has(id)));
  }

  function toggleCurrentFilterSelection() {
    if (isCurrentFilterAllSelected) {
      unselectCurrentFilter();
    } else {
      selectCurrentFilter();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-hidden">
      <WorkspacePageHeader
        meta={appPageMeta.history}
        actions={(
          <Button variant="outline" size="sm" className="shrink-0" onClick={resetFilters} disabled={!hasActiveFilters}>
            <RotateCcw className="size-3.5" />
            重置筛选
          </Button>
        )}
      />
      <div className="mk-history-workspace grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-1 overflow-hidden">
      <AppSurface as="section" padding="none" className="flex min-h-0 flex-col overflow-hidden">
        <div className="grid shrink-0 grid-cols-[minmax(220px,1fr)_112px_154px_auto] gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-zinc-700/70 max-[1180px]:grid-cols-[minmax(180px,1fr)_120px_auto] max-[760px]:grid-cols-1">
          <div className="relative min-w-0 max-[1180px]:col-span-3 max-[760px]:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
            <Input className="h-9 rounded-[6px] border-slate-200 bg-white pl-9 text-sm dark:border-zinc-700 dark:bg-zinc-950/60" placeholder="搜索文件名或输出路径" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-full rounded-[6px] border-slate-200 bg-white text-xs dark:border-zinc-700 dark:bg-zinc-950/60 data-[size=default]:h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="success">成功</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
              <SelectItem value="pending">处理中</SelectItem>
            </SelectContent>
          </Select>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger className="h-9 w-full rounded-[6px] border-slate-200 bg-white text-xs dark:border-zinc-700 dark:bg-zinc-950/60 data-[size=default]:h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模板</SelectItem>
              {templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 px-3 text-xs max-[760px]:w-full" onClick={handleClearHistory} disabled={history.length === 0}>
            <Trash2 className="size-3.5" />
            清空历史
          </Button>
        </div>

        <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2 dark:border-zinc-700/70">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-300">
            <button
              type="button"
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-[4px] border text-white transition",
                isCurrentFilterAllSelected
                  ? "border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500"
                  : "border-slate-300 bg-white hover:border-blue-400 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:border-zinc-500",
                filteredHistoryIds.length === 0 && "cursor-not-allowed opacity-45 hover:border-slate-300 dark:hover:border-zinc-600",
              )}
              disabled={filteredHistoryIds.length === 0}
              onClick={toggleCurrentFilterSelection}
              aria-label="全选当前筛选"
              aria-pressed={isCurrentFilterAllSelected}
            >
              {isCurrentFilterAllSelected ? <CheckSquare className="size-3" /> : null}
            </button>
            <span>全选当前筛选</span>
            <span className="tabular-nums text-slate-400 dark:text-zinc-500">{selectedFilteredCount}/{filteredHistory.length}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 rounded-[6px] px-2 text-xs",
              selectedIds.length > 0 ? "text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-500/12 dark:hover:text-red-200" : "text-slate-400 hover:text-slate-400 dark:text-zinc-500 dark:hover:text-zinc-500",
            )}
            onClick={() => void deleteHistory(selectedIds)}
            disabled={selectedIds.length === 0}
          >
            <Trash2 className="size-3.5" />
            删除选中{selectedIds.length > 0 ? ` ${selectedIds.length}` : ""}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {filteredHistory.length === 0 ? (
            <section className="flex h-full min-h-[240px] flex-col items-center justify-center p-8 text-center">
              <div className="mb-3 flex size-12 items-center justify-center rounded-[10px] bg-blue-50 text-blue-700 dark:bg-blue-500/16 dark:text-blue-200">
                <Clock3 className="size-6" />
              </div>
              <h3 className="text-sm font-black text-slate-950 dark:text-zinc-50">暂无转换历史</h3>
              <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500 dark:text-zinc-400">{hasActiveFilters ? "当前筛选条件下没有记录，可以重置筛选查看全部历史。" : "完成第一次 Markdown 转 DOCX 后，记录会显示在这里。"}</p>
            </section>
          ) : (
            <div className="space-y-5">
              {Object.entries(grouped).map(([group, items]) => items.length > 0 ? (
                <section key={group} className="space-y-2">
                  <h3 className="text-xs font-black text-blue-700/70 dark:text-blue-300/80">{group}</h3>
                  <div className="grid gap-2">
                    {items.map((item) => (
                      <HistoryRecordCard
                        key={item.id}
                        item={item}
                        templates={templates}
                        selected={selectedRecord?.id === item.id}
                        checked={selectedIdSet.has(item.id)}
                        onSelect={(record) => setSelectedHistoryId(record.id)}
                        onToggleChecked={toggleSelect}
                        onDelete={(record) => void deleteHistory([record.id])}
                      />
                    ))}
                  </div>
                </section>
              ) : null)}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-zinc-700/70 dark:text-zinc-400">
          <span>
            {filteredHistory.length === 0 ? "共 0 条" : `显示 ${historyPageStart + 1}-${Math.min(historyPageStart + historyPageSize, filteredHistory.length)}，共 ${filteredHistory.length} 条`}
          </span>
          <div className="ml-auto flex items-center justify-end gap-2">
            <Select
              value={String(historyPageSize)}
              onValueChange={(value) => {
                setHistoryPageSize(Number(value));
                setHistoryPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-[96px] rounded-[6px] border-slate-200 bg-white text-xs dark:border-zinc-700 dark:bg-zinc-950/60 data-[size=default]:h-7" aria-label="每页显示条数">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} 条/页</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <TooltipButton variant="ghost" size="icon-xs" onClick={() => setHistoryPage(1)} disabled={currentHistoryPage === 1} tooltip="第一页" aria-label="第一页">
                <ChevronsLeft className="size-3.5" />
              </TooltipButton>
              <TooltipButton variant="ghost" size="icon-xs" onClick={() => setHistoryPage((page) => Math.max(1, page - 1))} disabled={currentHistoryPage === 1} tooltip="上一页" aria-label="上一页">
                <ChevronLeft className="size-3.5" />
              </TooltipButton>
              <span className="min-w-[76px] text-center font-semibold text-slate-700 dark:text-zinc-200">第 {currentHistoryPage} / {historyPageCount} 页</span>
              <TooltipButton variant="ghost" size="icon-xs" onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))} disabled={currentHistoryPage === historyPageCount} tooltip="下一页" aria-label="下一页">
                <ChevronRight className="size-3.5" />
              </TooltipButton>
              <TooltipButton variant="ghost" size="icon-xs" onClick={() => setHistoryPage(historyPageCount)} disabled={currentHistoryPage === historyPageCount} tooltip="最后一页" aria-label="最后一页">
                <ChevronsRight className="size-3.5" />
              </TooltipButton>
            </div>
          </div>
        </footer>
      </AppSurface>

      <AppSurface as="aside" padding="none" className="mk-history-detail flex min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-700/70">
          <h3 className="text-sm font-black text-slate-950 dark:text-zinc-50">统计概览</h3>
          <span className="text-xs font-semibold text-slate-400 dark:text-zinc-500">当前筛选</span>
        </div>
        <div className="grid shrink-0 grid-cols-2 border-b border-slate-200 dark:border-zinc-700/70">
          <StatMetric className="border-b border-r border-slate-200 dark:border-zinc-700/70" icon={CheckCircle2} label="成功" value={String(successCount)} tone="text-emerald-600" />
          <StatMetric className="border-b border-slate-200 dark:border-zinc-700/70" icon={XCircle} label="失败" value={String(failedCount)} tone="text-red-600" />
          <StatMetric className="border-r border-slate-200 dark:border-zinc-700/70" icon={Clock3} label="总数" value={String(filteredHistory.length)} tone="text-blue-600" />
          <StatMetric icon={Clock3} label="处理中" value={String(pendingCount)} tone="text-amber-500" />
        </div>

        <section className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-slate-200 px-4 py-3 dark:border-zinc-700/70">
            <h3 className="text-sm font-black text-slate-950 dark:text-zinc-50">记录详情</h3>
          </div>
          {selectedRecord ? (
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
              <div className="flex items-start gap-3 border-b border-slate-100 pb-3 dark:border-zinc-800">
                <FilePreviewIcon status={selectedRecord.status} simulated={selectedRecord.simulated} />
                <div className="min-w-0 flex-1">
                  <TooltipAnchor content={selectedRecord.inputPath}>
                    <p className="truncate text-sm font-black text-slate-950 dark:text-zinc-50">{selectedRecord.inputPath}</p>
                  </TooltipAnchor>
                  <p className="mt-1 text-xs font-semibold text-blue-700/70 dark:text-blue-300/80">{selectedTemplateName}</p>
                </div>
              </div>
              <DetailLine label="输出" value={selectedRecord.outputPath ?? "暂无输出路径"} />
              <DetailLine label="状态" value={selectedRecord.simulated ? "浏览器预览" : selectedRecord.status === "success" ? "转换成功" : selectedRecord.status === "failed" ? "转换失败" : "处理中"} />
              <DetailLine label="时间" value={new Date(selectedRecord.createdAt).toLocaleString()} />
              {selectedRecord.durationMs !== undefined ? <DetailLine label="耗时" value={`${selectedRecord.durationMs} ms`} /> : null}
              {selectedRecord.errorMessage ? <p className="mt-3 border-l-2 border-red-500 bg-red-50/70 px-3 py-2 text-xs leading-5 text-red-700 dark:bg-red-500/12 dark:text-red-200">{selectedRecord.errorMessage}</p> : null}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center p-6 text-center">
              <FilePreviewIcon />
              <p className="mt-3 text-sm font-black text-slate-950 dark:text-zinc-50">{filteredHistory.length === 0 ? "暂无记录详情" : "选择一条记录"}</p>
              <p className="mt-1.5 max-w-[220px] text-xs leading-5 text-slate-500 dark:text-zinc-400">{filteredHistory.length === 0 ? "完成转换后，这里会展示最近记录的输出路径和状态。" : "转换详情、输出路径和错误信息会展示在这里。"}</p>
            </div>
          )}
        </section>
      </AppSurface>
      </div>
    </div>
  );
}

function StatMetric({ icon: Icon, label, value, tone, className }: { icon: LucideIcon; label: string; value: string; tone: string; className?: string }) {
  return (
    <article className={cn("flex min-h-[76px] items-center justify-between gap-2 px-4 py-3", className)}>
      <div>
        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">{label}</p>
        <p className="mt-1 text-xl font-black text-slate-950 dark:text-zinc-50">{value}</p>
      </div>
      <Icon className={`size-5 shrink-0 ${tone}`} />
    </article>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-slate-100 py-2.5 dark:border-zinc-800">
      <p className="pt-0.5 text-[11px] font-bold text-slate-400 dark:text-zinc-500">{label}</p>
      <p className="break-words text-xs font-semibold leading-5 text-slate-700 dark:text-zinc-300">{value}</p>
    </div>
  );
}

function FilePreviewIcon({ status, simulated = false }: { status?: HistoryItem["status"]; simulated?: boolean }) {
  const isFailed = status === "failed";
  const isPending = status === "pending";
  return (
    <div className={isFailed ? "flex size-12 shrink-0 items-center justify-center rounded-[16px] bg-red-600 text-white shadow-[0_14px_32px_rgba(220,38,38,0.2)]" : simulated || isPending ? "flex size-12 shrink-0 items-center justify-center rounded-[16px] bg-amber-500 text-white shadow-[0_14px_32px_rgba(245,158,11,0.2)]" : "flex size-12 shrink-0 items-center justify-center rounded-[16px] bg-blue-600 text-white shadow-[0_14px_32px_rgba(37,99,235,0.24)]"}>
      {isFailed ? <XCircle className="size-6" /> : isPending ? <Clock3 className="size-6" /> : <FileText className="size-6" />}
    </div>
  );
}
