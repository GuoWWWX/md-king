import { FileText, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TooltipButton } from "@/components/ui/tooltip";
import { searchVault } from "@/lib/vault";
import { parseVaultError } from "@/lib/user-facing-errors";
import type { VaultSearchMatch, VaultSearchOptions, VaultSearchResponse } from "@/types/vault";

type GlobalSearchDialogProps = {
  open: boolean;
  root?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (result: VaultSearchMatch) => void | Promise<void>;
};

const defaultSearchOptions: VaultSearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
};

function pathParent(path: string) {
  const segments = path.split("/");
  segments.pop();
  return segments.join("/") || "仓库根目录";
}

function highlightRange(text: string, start: number | null, end: number | null) {
  if (start === null || end === null || start < 0 || end <= start || end > text.length) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-[2px] bg-yellow-200/80 px-0.5 text-inherit dark:bg-yellow-500/30">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

export function GlobalSearchDialog({ open, root, onOpenChange, onSelect }: GlobalSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<VaultSearchResponse>();
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [options, setOptions] = useState<VaultSearchOptions>(defaultSearchOptions);
  const requestVersionRef = useRef(0);
  const rootName = useMemo(() => {
    const segments = root?.split(/[\\/]/).filter(Boolean) ?? [];
    return segments[segments.length - 1] ?? "当前仓库";
  }, [root]);

  useEffect(() => {
    setQuery("");
    setResponse(undefined);
    setErrorMessage(undefined);
  }, [root]);

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current;
    const hasQuery = query.trim().length > 0;
    if (!open || !root || !hasQuery) {
      setIsSearching(false);
      setErrorMessage(undefined);
      if (!hasQuery) setResponse(undefined);
      return undefined;
    }

    setIsSearching(true);
    setErrorMessage(undefined);
    const timer = window.setTimeout(() => {
      void searchVault(root, query, options)
        .then((result) => {
          if (requestVersion !== requestVersionRef.current) return;
          setResponse(result);
        })
        .catch((error) => {
          if (requestVersion !== requestVersionRef.current) return;
          setResponse(undefined);
          setErrorMessage(parseVaultError(error, "全局搜索失败").message);
        })
        .finally(() => {
          if (requestVersion === requestVersionRef.current) setIsSearching(false);
        });
    }, 240);

    return () => window.clearTimeout(timer);
  }, [open, options, query, root]);

  const results = response?.results ?? [];
  const hasQuery = query.trim().length > 0;

  function handleEnter() {
    const first = results[0];
    if (first) void onSelect(first);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="mk-global-search-description"
        className="flex h-[min(620px,calc(100vh-64px))] w-[min(720px,calc(100vw-32px))] max-w-[720px] flex-col gap-0 overflow-hidden border border-slate-200 bg-white p-0 shadow-2xl dark:border-zinc-700 dark:bg-[#202020] sm:max-w-[720px]"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-700">
          <Search className="size-4 shrink-0 text-slate-500 dark:text-zinc-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm font-semibold">全局搜索</DialogTitle>
            <DialogDescription id="mk-global-search-description" className="mt-1 truncate text-xs">
              {root ? `搜索 ${rootName} 中的文件名和文档内容` : "打开目录后可搜索文件名和文档内容"}
            </DialogDescription>
          </div>
          <TooltipButton
            tooltip="关闭"
            tooltipSide="bottom"
            aria-label="关闭全局搜索"
            size="icon-sm"
            className="shrink-0 text-slate-500 dark:text-zinc-400"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </TooltipButton>
        </DialogHeader>

        <div className="border-b border-slate-200 p-3 dark:border-zinc-700">
          <div className="flex h-9 items-center rounded-[4px] border border-border bg-card py-0 pl-2 pr-[3px] transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50">
            {isSearching ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-slate-400 dark:text-zinc-500" aria-label="正在搜索" />
            ) : (
              <Search className="size-4 shrink-0 text-slate-400 dark:text-zinc-500" aria-hidden />
            )}
            <Input
              autoFocus
              value={query}
              disabled={!root}
              aria-label="全局搜索关键词"
              aria-invalid={Boolean(errorMessage)}
              placeholder={root ? "搜索文件名或文档内容" : "请先打开目录"}
              className="mk-global-search-input h-[34px] flex-1 rounded-none border-0 bg-transparent px-[7px] py-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleEnter();
              }}
            />
            <SearchOptionButton
              label="区分大小写"
              active={options.caseSensitive}
              disabled={!root}
              onClick={() => setOptions((value) => ({ ...value, caseSensitive: !value.caseSensitive }))}
            >Aa</SearchOptionButton>
            <SearchOptionButton
              label="全词匹配"
              active={options.wholeWord}
              disabled={!root}
              onClick={() => setOptions((value) => ({ ...value, wholeWord: !value.wholeWord }))}
            >词</SearchOptionButton>
            <SearchOptionButton
              label="正则表达式"
              active={options.regexp}
              disabled={!root}
              onClick={() => setOptions((value) => ({ ...value, regexp: !value.regexp }))}
            >.*</SearchOptionButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="全局搜索结果">
          {!root ? (
            <SearchEmptyState>请先从左侧文件树打开一个目录。</SearchEmptyState>
          ) : !hasQuery ? (
            <SearchEmptyState>输入关键词后，将同时搜索文件名和 Markdown、TXT 文档内容。</SearchEmptyState>
          ) : errorMessage ? (
            <SearchEmptyState>{errorMessage}</SearchEmptyState>
          ) : !isSearching && response && results.length === 0 ? (
            <SearchEmptyState>没有找到“{query}”</SearchEmptyState>
          ) : (
            results.map((result) => (
              <button
                key={`${result.kind}:${result.path}:${result.line ?? 0}`}
                type="button"
                role="option"
                aria-selected="false"
                className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition-colors hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:border-zinc-800 dark:hover:bg-[#2e2e2e] dark:focus-visible:bg-[#2e2e2e]"
                onClick={() => void onSelect(result)}
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-slate-400 dark:text-zinc-500" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-zinc-100">{highlightRange(result.name, result.matchStart, result.matchEnd)}</span>
                    <span className="shrink-0 text-[11px] text-slate-400 dark:text-zinc-500">
                      {result.kind === "fileName" ? "文件名" : `正文 · 第 ${result.line} 行`}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-zinc-500">{pathParent(result.path)}</span>
                  {result.preview ? (
                    <span className="mt-1 block truncate text-xs leading-5 text-slate-600 dark:text-zinc-300">{highlightRange(result.preview, result.previewMatchStart, result.previewMatchEnd)}</span>
                  ) : null}
                </span>
              </button>
            ))
          )}
        </div>

        {response && hasQuery ? (
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400 dark:border-zinc-700 dark:text-zinc-500">
            <span>{response.results.length} 条结果 · 已扫描 {response.scannedFiles} 个文件</span>
            <span className="truncate text-right">
              {response.truncated ? "结果较多，仅显示前 200 条" : response.skippedFiles > 0 ? `跳过 ${response.skippedFiles} 个过大或不可读取的文件` : ""}
            </span>
          </footer>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SearchOptionButton({ label, active, children, ...props }: {
  label: string;
  active: boolean;
  children: ReactNode;
} & Omit<React.ComponentProps<typeof TooltipButton>, "tooltip" | "children">) {
  return (
    <TooltipButton
      {...props}
      type="button"
      tooltip={label}
      aria-label={label}
      aria-pressed={active}
      size="icon-xs"
      className="mk-global-search-option size-6 shrink-0 font-semibold"
    >
      {children}
    </TooltipButton>
  );
}

function SearchEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center px-8 text-center text-sm text-slate-400 dark:text-zinc-500">
      {children}
    </div>
  );
}
