import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useUpdaterStore } from "@/stores/updater-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Download,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  Rocket,
} from "lucide-react";

function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0 || isNaN(bytesPerSec)) return "-- KB/s";
  return `${formatBytes(bytesPerSec)}/s`;
}

export function UpdateDialog() {
  const {
    dialogOpen,
    setDialogOpen,
    currentVersion,
    latestRelease,
    status,
    downloadProgress,
    errorMessage,
    startDownload,
    cancelDownload,
    installAndRelaunch,
    ignoreCurrentRelease,
  } = useUpdaterStore();

  if (!latestRelease) return null;

  const newVersion = latestRelease.tag_name;
  const isDownloading = status === "downloading" || status === "cancelling";
  const isInstalling = status === "installing";
  const isBusy = isDownloading || isInstalling;
  const isReady = status === "ready_to_install";
  const isError = status === "error";

  async function handleOpenBrowser() {
    if (!latestRelease) return;
    try {
      await openUrl(latestRelease.html_url);
    } catch {
      window.open(latestRelease.html_url, "_blank");
    }
  }

  async function handleManualDownload() {
    if (!latestRelease) return;
    const asset =
      latestRelease.assets.find((a) => a.name.toLowerCase().endsWith("-setup.exe")) ??
      latestRelease.assets.find((a) => a.name.toLowerCase().endsWith(".exe"));
    const url = asset ? asset.browser_download_url : latestRelease.html_url;
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={(open) => !isBusy && setDialogOpen(open)}>
      <DialogContent className="max-w-[480px] p-6 sm:max-w-[500px]" showCloseButton={!isBusy}>
        <DialogHeader className="space-y-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400">
              <Sparkles className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-slate-900 dark:text-zinc-100">
                发现新版本
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 dark:text-zinc-400">
                MD King 有新版本发布，推荐升级以获取最新功能与修复
              </DialogDescription>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">
              当前: v{currentVersion}
            </span>
            <span className="text-xs text-slate-400">→</span>
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-950/80 dark:text-amber-300">
              最新: {newVersion}
            </span>
            {latestRelease.published_at && (
              <span className="ml-auto text-[11px] text-slate-400">
                {new Date(latestRelease.published_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </DialogHeader>

        {/* 更新日志区域 */}
        <div className="mt-3 space-y-1.5">
          <div className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
            {latestRelease.name || "更新内容"}
          </div>
          <div className="max-h-[160px] overflow-y-auto rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 text-xs leading-relaxed text-slate-600 whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
            {latestRelease.body || "本次发布包含稳定性增强与问题修复。"}
          </div>
        </div>

        {/* 状态与进度反馈区 */}
        <div className="mt-4 space-y-3">
          {isDownloading && (
            <div className="space-y-2 rounded-lg border border-amber-200/60 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  {status === "cancelling" ? "正在取消下载..." : downloadProgress.percent >= 100 ? "正在校验安装包..." : "正在下载安装包..."}
                </span>
                <span className="font-mono text-xs font-bold text-amber-800 dark:text-amber-200">
                  {downloadProgress.percent.toFixed(1)}%
                </span>
              </div>
              <Progress value={downloadProgress.percent} className="h-2 bg-amber-200/50 dark:bg-zinc-800" />
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400">
                <span>
                  {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
                </span>
                <span>速度: {formatSpeed(downloadProgress.speedBytesPerSec)}</span>
              </div>
            </div>
          )}

          {isReady && (
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>安装包已通过校验。{errorMessage ? "自动安装未完成：" + errorMessage + "。请重试安装。" : "正在准备安装。"}</span>
            </div>
          )}

          {isInstalling && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">正在安装更新，软件即将关闭并自动重启。</p>
          )}

          {isError && (
            <div className="space-y-1.5 rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertCircle className="size-4 text-rose-600 dark:text-rose-400" />
                <span>下载更新遇到问题</span>
              </div>
              <p className="text-[11px] text-rose-700/90 dark:text-rose-300/90">
                {errorMessage || "网络连接中断，请重试或前往浏览器下载"}
              </p>
            </div>
          )}
        </div>

        {!isBusy && !isReady && (
          <p className="mt-3 text-[11px] text-slate-500 dark:text-zinc-400">立即更新会下载并校验安装包，保存草稿后自动静默升级、重启。Windows 可能要求确认系统权限。</p>
        )}

        {/* 底部操作按钮 */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-zinc-800">
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              onClick={handleOpenBrowser}
              title="在浏览器中查看此 Release"
            >
              <ExternalLink className="size-3.5" />
              <span>Release 主页</span>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {!isBusy && !isReady && !isError && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-slate-500 dark:text-zinc-400"
                  onClick={ignoreCurrentRelease}
                >
                  忽略此版本
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setDialogOpen(false)}
                >
                  稍后
                </Button>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 bg-amber-600 text-xs font-bold text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-zinc-950 dark:hover:bg-amber-400"
                  onClick={startDownload}
                  disabled={status === "checking"}
                >
                  <Download className="size-3.5" />
                  <span>{status === "checking" ? "检查中..." : "立即更新"}</span>
                </Button>
              </>
            )}

            {isDownloading && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400"
                disabled={status === "cancelling"}
                onClick={cancelDownload}
              >
                <X className="size-3.5" />
                <span>取消下载</span>
              </Button>
            )}

            {isReady && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setDialogOpen(false)}
                >
                  稍后安装
                </Button>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                  onClick={() => installAndRelaunch(true)}
                >
                  <Rocket className="size-3.5" />
                  <span>立即安装升级</span>
                </Button>
              </>
            )}

            {isError && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleManualDownload}
                >
                  浏览器下载
                </Button>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 bg-amber-600 text-xs font-bold text-white hover:bg-amber-700"
                  onClick={startDownload}
                >
                  <RefreshCw className="size-3.5" />
                  <span>重试下载</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
