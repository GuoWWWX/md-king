import { useEffect, useState } from "react";
import { AlertTriangle, FilePlus2, FolderOpen, FolderPlus, Trash2 } from "lucide-react";
import { PrimaryActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/// 名称校验放在提交前而非输入中：边打字边报红在中文输入法下会因为组合期的半成品文本狂闪。
function validateEntryName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "名称不能为空";
  if (/[\\/:*?"<>|]/.test(trimmed)) return '名称不能包含 \\ / : * ? " < > | 字符';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(trimmed)) return "该名称是 Windows 保留名，请换一个";
  if (/[ .]$/.test(trimmed)) return "名称不能以空格或点结尾";
  return undefined;
}

type CreateEntryDialogProps = {
  open: boolean;
  isDir: boolean;
  parentLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => Promise<void> | void;
};

export function CreateEntryDialog({ open, isDir, parentLabel, onOpenChange, onConfirm }: CreateEntryDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(isDir ? "新建文件夹" : "未命名.md");
    setError(undefined);
    setBusy(false);
  }, [open, isDir]);

  async function submit() {
    const message = validateEntryName(name);
    if (message) {
      setError(message);
      return;
    }

    setBusy(true);
    try {
      await onConfirm(name.trim());
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12 dark:border-zinc-800">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-950 dark:text-zinc-50">
            {isDir ? <FolderPlus className="size-4 text-blue-600 dark:text-blue-400" /> : <FilePlus2 className="size-4 text-blue-600 dark:text-blue-400" />}
            {isDir ? "新建文件夹" : "新建文件"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs leading-5">
            将创建在 <span className="font-semibold text-slate-700 dark:text-zinc-200">{parentLabel}</span> 下{isDir ? "" : "，不写扩展名时自动补 .md"}。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 px-5 py-4">
          <Input
            autoFocus
            value={name}
            onChange={(event) => { setName(event.target.value); setError(undefined); }}
            onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
            placeholder={isDir ? "文件夹名称" : "文件名称"}
            aria-invalid={Boolean(error)}
            aria-label={isDir ? "文件夹名称" : "文件名称"}
          />
          {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}
        </div>

        <DialogFooter className="m-0 rounded-none border-x-0 border-b-0 px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <PrimaryActionButton onClick={() => void submit()} disabled={busy}>{busy ? "创建中…" : "创建"}</PrimaryActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type RenameEntryDialogProps = {
  open: boolean;
  currentName: string;
  isDir: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => Promise<void> | void;
};

export function RenameEntryDialog({ open, currentName, isDir, onOpenChange, onConfirm }: RenameEntryDialogProps) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(currentName);
    setError(undefined);
    setBusy(false);
  }, [open, currentName]);

  async function submit() {
    const message = validateEntryName(name);
    if (message) {
      setError(message);
      return;
    }
    if (name.trim() === currentName) {
      onOpenChange(false);
      return;
    }

    setBusy(true);
    try {
      await onConfirm(name.trim());
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "重命名失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12 dark:border-zinc-800">
          <DialogTitle className="text-base font-bold text-slate-950 dark:text-zinc-50">重命名{isDir ? "文件夹" : "文件"}</DialogTitle>
          <DialogDescription className="mt-1 text-xs leading-5">当前名称：{currentName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 px-5 py-4">
          <Input
            autoFocus
            value={name}
            onChange={(event) => { setName(event.target.value); setError(undefined); }}
            onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
            aria-invalid={Boolean(error)}
            aria-label="新名称"
          />
          {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}
        </div>

        <DialogFooter className="m-0 rounded-none border-x-0 border-b-0 px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <PrimaryActionButton onClick={() => void submit()} disabled={busy}>{busy ? "保存中…" : "保存"}</PrimaryActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DeleteEntryDialogProps = {
  open: boolean;
  entries: Array<{ name: string; isDir: boolean; hasChildren: boolean }>;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
};

export function DeleteEntryDialog({ open, entries, onOpenChange, onConfirm }: DeleteEntryDialogProps) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const entry = entries[0];
  const multiple = entries.length > 1;
  const deletesChildren = entries.some((target) => target.isDir && target.hasChildren);

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setBusy(false);
  }, [open]);

  async function submit() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12 dark:border-zinc-800">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-950 dark:text-zinc-50">
            <Trash2 className="size-4 text-red-600 dark:text-red-400" />
            {multiple ? "删除多个项目" : `删除${entry?.isDir ? "文件夹" : "文件"}`}
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs leading-5">
            {multiple ? <>确定删除已选的 <span className="font-semibold text-slate-700 dark:text-zinc-200">{entries.length}</span> 个项目吗？</> : <>确定删除 <span className="font-semibold text-slate-700 dark:text-zinc-200">{entry?.name ?? "该项目"}</span> 吗？</>}
            {deletesChildren ? "包含内容的文件夹会连同内部文件一起删除，" : ""}此操作不可撤销。
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="px-5 pt-4 text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}

        <DialogFooter className="m-0 rounded-none border-x-0 border-b-0 px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={busy}>{busy ? "删除中…" : "确认删除"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type RemoveRecentVaultDialogProps = {
  open: boolean;
  root?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
};

export function RemoveRecentVaultDialog({ open, root, onOpenChange, onConfirm }: RemoveRecentVaultDialogProps) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setBusy(false);
  }, [open]);

  async function submit() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "移除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12 dark:border-zinc-800">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-950 dark:text-zinc-50">
            <FolderOpen className="size-4 text-slate-500 dark:text-zinc-400" />
            移除最近目录
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs leading-5">
            确定从最近打开的目录中移除 <span className="font-semibold text-slate-700 dark:text-zinc-200">{root ?? "该目录"}</span> 吗？这不会删除磁盘上的任何文件。
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="px-5 pt-4 text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}

        <DialogFooter className="m-0 rounded-none border-x-0 border-b-0 px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={busy}>{busy ? "移除中…" : "确认移除"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OpenVaultLocationDialogProps = {
  open: boolean;
  currentRoot?: string;
  targetRoot?: string;
  canOpenNewWindow?: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCurrent: () => Promise<void> | void;
  onOpenNewWindow: () => Promise<void> | void;
};

export function OpenVaultLocationDialog({ open, currentRoot, targetRoot, canOpenNewWindow = true, onOpenChange, onOpenCurrent, onOpenNewWindow }: OpenVaultLocationDialogProps) {
  const [error, setError] = useState<string>();
  const [busyAction, setBusyAction] = useState<"current" | "window">();

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setBusyAction(undefined);
  }, [open]);

  async function submit(action: "current" | "window") {
    setBusyAction(action);
    setError(undefined);
    try {
      if (action === "current") await onOpenCurrent();
      else await onOpenNewWindow();
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "打开目录失败");
    } finally {
      setBusyAction(undefined);
    }
  }

  const busy = busyAction !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12 dark:border-zinc-800">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-950 dark:text-zinc-50">
            <FolderOpen className="size-4 text-blue-600 dark:text-blue-400" />
            打开目录
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs leading-5">
            当前窗口正在打开 <span className="font-semibold text-slate-700 dark:text-zinc-200">{currentRoot ?? "另一个目录"}</span>。请选择 <span className="font-semibold text-slate-700 dark:text-zinc-200">{targetRoot ?? "新目录"}</span> 的打开位置。
            在当前窗口打开会关闭现有的文档和图片标签；在新窗口打开会保留当前工作区。
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="px-5 pt-4 text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}

        <DialogFooter className="m-0 flex-wrap gap-2 rounded-none border-x-0 border-b-0 px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          <Button variant="outline" onClick={() => void submit("current")} disabled={busy}>在当前窗口打开</Button>
          <PrimaryActionButton
            onClick={() => void submit("window")}
            disabled={busy || !canOpenNewWindow}
            title={canOpenNewWindow ? undefined : "浏览器预览不支持打开新的项目窗口"}
          >
            {busyAction === "window" ? "打开中…" : "在新窗口打开"}
          </PrimaryActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type SaveConflictChoice = "overwrite" | "reload" | "cancel";

type SaveConflictDialogProps = {
  open: boolean;
  filePath?: string;
  onOpenChange: (open: boolean) => void;
  onChoose: (choice: SaveConflictChoice) => Promise<void> | void;
};

/// 三选一而非静默覆盖：磁盘上那份可能是另一个编辑器刚写进去的，谁赢必须由用户决定。
export function SaveConflictDialog({ open, filePath, onOpenChange, onChoose }: SaveConflictDialogProps) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  async function choose(choice: SaveConflictChoice) {
    setBusy(true);
    try {
      await onChoose(choice);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) void choose("cancel"); }}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogHeader className="border-b border-slate-200 px-5 py-4 dark:border-zinc-800">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-950 dark:text-zinc-50">
            <AlertTriangle className="size-4 text-amber-500" />
            文件已被其他程序修改
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs leading-5">
            {filePath ? <span className="font-semibold text-slate-700 dark:text-zinc-200">{filePath}</span> : "当前文件"} 在你编辑期间被外部改动。请选择保留哪一份，两份内容无法自动合并。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 px-5 py-4 text-xs leading-5 text-slate-600 dark:text-zinc-300">
          <p><span className="font-bold text-slate-800 dark:text-zinc-100">覆盖磁盘版本</span>：用编辑器里的内容写回，磁盘上的外部改动会丢失。</p>
          <p><span className="font-bold text-slate-800 dark:text-zinc-100">放弃本地改动</span>：重新读取磁盘内容，编辑器里未保存的改动会丢失。</p>
          <p><span className="font-bold text-slate-800 dark:text-zinc-100">稍后处理</span>：暂停自动保存，先手动把内容复制出来。</p>
        </div>

        <DialogFooter className="m-0 flex-wrap gap-2 rounded-none border-x-0 border-b-0 px-5 py-3">
          <Button variant="ghost" onClick={() => void choose("cancel")} disabled={busy}>稍后处理</Button>
          <Button variant="outline" onClick={() => void choose("reload")} disabled={busy}>放弃本地改动并重载</Button>
          <Button variant="destructive" onClick={() => void choose("overwrite")} disabled={busy}>覆盖磁盘版本</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
