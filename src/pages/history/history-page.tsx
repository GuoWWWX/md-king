import { CheckCircle2, CheckSquare, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock3, FileText, RotateCcw, Search, Trash2, XCircle, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HistoryRecordCard } from "@/components/history/history-record-card";
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
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-4 overflow-hidden max-[1080px]:grid-cols-1">
      <section className="flex min-h-0 flex-col overflow-hidden">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black tracking-[-0.04em] text-blue-950 dark:text-zinc-50">转换历史</h2>
            <p className="mt-1 text-sm text-blue-900/58 dark:text-zinc-400">查找 DOCX 输出、复制路径，或重新触发转换流程。</p>
          </div>
          <Button variant="outline" className="rounded-[12px] border-white/70 bg-white/68 dark:border-zinc-700 dark:bg-zinc-900" onClick={resetFilters} disabled={!hasActiveFilters}>
            <RotateCcw className="size-4" />
            重置筛选
          </Button>
        </div>

        <div className="mk-history-filter-panel mb-3 grid shrink-0 grid-cols-[minmax(280px,1fr)_132px_180px_auto] gap-2 rounded-[12px] border border-slate-200 bg-white p-3 dark:border-zinc-700/70 dark:bg-zinc-900/72 max-[1180px]:grid-cols-[132px_minmax(240px,1fr)_auto] max-[760px]:grid-cols-1">
          <div className="relative min-w-0 max-[1180px]:col-span-3 max-[760px]:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
            <Input className="h-11 rounded-[10px] border-slate-200 bg-white pl-9 text-sm dark:border-zinc-700 dark:bg-zinc-950/60" placeholder="搜索文件名或输出路径" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-11 w-full rounded-[10px] border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-950/60 data-[size=default]:h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="success">成功</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
              <SelectItem value="pending">处理中</SelectItem>
            </SelectContent>
          </Select>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger className="h-11 w-full rounded-[10px] border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-950/60 data-[size=default]:h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模板</SelectItem>
              {templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" className="h-11 rounded-[10px] border-slate-200 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-950/60 max-[760px]:w-full" onClick={handleClearHistory} disabled={history.length === 0}>
            <Trash2 className="size-4" />
            清空历史
          </Button>
        </div>

        <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-[12px] border border-blue-100/60 bg-white/32 px-3 py-2.5 dark:border-zinc-700/70 dark:bg-zinc-900/60">
          <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-zinc-300">
            <button
              type="button"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-lg border text-white transition",
                isCurrentFilterAllSelected
                  ? "border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500"
                  : "border-blue-200 bg-white/70 hover:border-blue-300 hover:bg-white dark:border-zinc-600 dark:bg-zinc-900/70 dark:hover:border-zinc-500 dark:hover:bg-zinc-800",
                filteredHistoryIds.length === 0 && "cursor-not-allowed opacity-45 hover:border-blue-200 hover:bg-white/70 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/70",
              )}
              disabled={filteredHistoryIds.length === 0}
              onClick={toggleCurrentFilterSelection}
              aria-label="全选当前筛选"
              aria-pressed={isCurrentFilterAllSelected}
            >
              {isCurrentFilterAllSelected ? <CheckSquare className="size-4" /> : null}
            </button>
            <span>全选当前筛选</span>
            <span className="text-slate-400 dark:text-zinc-500">{selectedFilteredCount}/{filteredHistory.length}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "rounded-[12px]",
              selectedIds.length > 0 ? "text-red-600 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200" : "text-slate-400 hover:text-slate-400 dark:text-zinc-500 dark:hover:text-zinc-500",
            )}
            onClick={() => void deleteHistory(selectedIds)}
            disabled={selectedIds.length === 0}
          >
            <Trash2 className="size-4" />
            删除选中{selectedIds.length > 0 ? ` ${selectedIds.length}` : ""}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {filteredHistory.length === 0 ? (
            <section className="flex min-h-[280px] flex-col items-center justify-center rounded-[14px] border border-dashed border-blue-100/80 bg-white/24 p-8 text-center dark:border-zinc-700/70 dark:bg-zinc-900/50">
              <div className="mb-4 flex size-14 items-center justify-center rounded-[14px] bg-blue-50 text-blue-600 shadow-inner dark:bg-blue-500/16 dark:text-blue-200">
                <Clock3 className="size-7" />
              </div>
              <h3 className="font-black text-slate-950 dark:text-zinc-50">暂无转换历史</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-zinc-400">{hasActiveFilters ? "当前筛选条件下没有记录，可以重置筛选查看全部历史。" : "完成第一次 Markdown 转 DOCX 后，记录会显示在这里。"}</p>
            </section>
          ) : (
          <div className="space-y-5">
          {Object.entries(grouped).map(([group, items]) => items.length > 0 ? (
            <section key={group} className="space-y-3">
              <h3 className="text-sm font-black text-blue-700/70 dark:text-blue-300/80">{group}</h3>
              <div className="grid gap-3">
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
        <div className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-blue-100/70 bg-white/54 px-3 py-2 text-xs text-slate-500 dark:border-zinc-700/70 dark:bg-zinc-900/60 dark:text-zinc-400">
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
              <SelectTrigger className="h-8 w-[104px] rounded-[9px] border-slate-200 bg-white text-xs dark:border-zinc-700 dark:bg-zinc-950/60 data-[size=default]:h-8" aria-label="每页显示条数">
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
        </div>
      </section>

      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1 max-[1080px]:hidden">
        <AppSurface as="section">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-black text-blue-950 dark:text-zinc-50">统计概览</h3>
            <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-zinc-800/70 dark:text-blue-200">当前筛选</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={CheckCircle2} label="成功" value={String(successCount)} tone="text-emerald-600" compact />
            <StatCard icon={XCircle} label="失败" value={String(failedCount)} tone="text-red-600" compact />
            <StatCard icon={Clock3} label="总数" value={String(filteredHistory.length)} tone="text-blue-600" compact />
            <StatCard icon={Clock3} label="处理中" value={String(pendingCount)} tone="text-amber-500" compact />
          </div>
        </AppSurface>

        <AppSurface as="section" className="shrink-0">
          <h3 className="text-sm font-black text-blue-950 dark:text-zinc-50">记录详情</h3>
          {selectedRecord ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-[16px] border border-blue-100 bg-white/58 p-4 dark:border-zinc-700/70 dark:bg-zinc-900/72">
                <div className="flex items-start gap-3">
                  <FilePreviewIcon status={selectedRecord.status} simulated={selectedRecord.simulated} />
                  <div className="min-w-0 flex-1">
                    <TooltipAnchor content={selectedRecord.inputPath}>
                      <p className="truncate text-sm font-black text-blue-950 dark:text-zinc-50">{selectedRecord.inputPath}</p>
                    </TooltipAnchor>
                    <p className="mt-1 text-xs font-semibold text-blue-700/70 dark:text-blue-300/80">{selectedTemplateName}</p>
                  </div>
                </div>
              </div>
              <DetailLine label="输出" value={selectedRecord.outputPath ?? "暂无输出路径"} />
              <DetailLine label="状态" value={selectedRecord.simulated ? "浏览器预览" : selectedRecord.status === "success" ? "转换成功" : selectedRecord.status === "failed" ? "转换失败" : "处理中"} />
              <DetailLine label="时间" value={new Date(selectedRecord.createdAt).toLocaleString()} />
              {selectedRecord.durationMs !== undefined ? <DetailLine label="耗时" value={`${selectedRecord.durationMs} ms`} /> : null}
              {selectedRecord.errorMessage ? <p className="rounded-[12px] bg-red-50 p-3 text-xs leading-5 text-red-700 dark:bg-red-500/12 dark:text-red-200">{selectedRecord.errorMessage}</p> : null}
            </div>
          ) : (
            <div className="mt-4 flex min-h-[220px] flex-col items-center justify-center rounded-[16px] border border-dashed border-blue-200 bg-white/48 p-6 text-center dark:border-zinc-700/70 dark:bg-zinc-900/60">
              <FilePreviewIcon />
              <p className="mt-4 text-sm font-black text-blue-950 dark:text-zinc-50">{filteredHistory.length === 0 ? "暂无记录详情" : "选择一条记录"}</p>
              <p className="mt-2 text-xs leading-5 text-blue-900/55 dark:text-zinc-400">{filteredHistory.length === 0 ? "完成转换后，这里会展示最近记录的输出路径和状态。" : "转换详情、输出路径和错误信息会展示在这里。"}</p>
            </div>
          )}
        </AppSurface>
      </aside>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone, compact = false }: { icon: LucideIcon; label: string; value: string; tone: string; compact?: boolean }) {
  return (
    <article className={compact ? "rounded-[10px] border border-blue-100/60 bg-white/28 p-3 dark:border-zinc-700/70 dark:bg-zinc-900/60" : "rounded-[12px] border border-blue-100/60 bg-white/32 p-5 dark:border-zinc-700/70 dark:bg-zinc-900/60"}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">{label}</p>
          <p className={compact ? "mt-1 text-xl font-black tracking-[-0.05em] text-slate-950 dark:text-zinc-50" : "mt-2 text-3xl font-black tracking-[-0.05em] text-slate-950 dark:text-zinc-50"}>{value}</p>
        </div>
        <div className={compact ? "flex size-9 items-center justify-center rounded-[10px] bg-white/68 shadow-sm dark:bg-zinc-800/70" : "flex size-12 items-center justify-center rounded-xl bg-white/68 shadow-sm dark:bg-zinc-800/70"}>
          <Icon className={`${compact ? "size-5" : "size-6"} ${tone}`} />
        </div>
      </div>
    </article>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-white/70 bg-white/54 px-3 py-2 dark:border-zinc-700/70 dark:bg-zinc-900/72">
      <p className="text-[11px] font-bold text-blue-900/45 dark:text-zinc-500">{label}</p>
      <p className="mt-1 break-words text-xs font-semibold leading-5 text-slate-700 dark:text-zinc-300">{value}</p>
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
