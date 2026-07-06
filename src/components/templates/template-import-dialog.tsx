import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FilePlus, FileUp, Loader2 } from "lucide-react";
import { PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { selectDocxFile } from "@/lib/tauri";
import { userFacingErrorMessage } from "@/lib/user-facing-errors";
import type { ImportTemplateRequest, Template } from "@/types";

type TemplateImportDialogProps = {
  open: boolean;
  mode: "import" | "create";
  groups: string[];
  onOpenChange: (open: boolean) => void;
  onImport: (request: ImportTemplateRequest) => Promise<Template>;
  onCreate: (request: Omit<ImportTemplateRequest, "referenceDocxPath">) => Promise<Template>;
};

export function TemplateImportDialog({ open, mode, groups, onOpenChange, onImport, onCreate }: TemplateImportDialogProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("我的模板");
  const [description, setDescription] = useState("");
  const [referenceDocxPath, setReferenceDocxPath] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setCategory("我的模板");
    setDescription("");
    setReferenceDocxPath("");
    setIsDefault(false);
  }, [mode, open]);

  async function handleSelectReferenceDocx() {
    try {
      const selected = await selectDocxFile();
      if (!selected) return;
      setReferenceDocxPath(selected);
      toast.success("已选择参考 DOCX 文件");
    } catch (error) {
      toast.error(userFacingErrorMessage(error, "选择参考 DOCX 失败"));
    }
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("请填写模板名称");
      return;
    }
    if (mode === "import" && !referenceDocxPath.trim()) {
      toast.error("请填写参考 DOCX 文件路径");
      return;
    }
    if (mode === "import" && !referenceDocxPath.trim().toLowerCase().endsWith(".docx")) {
      toast.error("参考 DOCX 路径必须指向 .docx 文件");
      return;
    }

    setIsSubmitting(true);
    try {
      const base = {
        name: name.trim(),
        description: description.trim() || undefined,
        tags: [category.trim() || "我的模板", "自定义"],
        isDefault,
      };
      if (mode === "import") {
        await onImport({ ...base, referenceDocxPath: referenceDocxPath.trim() });
        toast.success("模板已导入");
      } else {
        await onCreate(base);
        toast.success("模板已创建，可继续进入样式编辑器定义样式");
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(userFacingErrorMessage(error, mode === "import" ? "导入模板失败" : "创建模板失败"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const isImport = mode === "import";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {isImport ? <FileUp className="size-5 text-indigo-600 dark:text-indigo-300" /> : <FilePlus className="size-5 text-indigo-600 dark:text-indigo-300" />}
            {isImport ? "导入 Word/WPS 样式模板" : "创建自定义模板"}
          </DialogTitle>
          <DialogDescription>
            {isImport
              ? "选择一个 .docx 文件作为参考样式。模板正文不会进入新文档，系统主要使用其中的标题、正文、表格等样式。"
              : "无需先准备 DOCX，你可以先创建模板信息，再进入样式管理器自定义标题、正文、代码块和页面设置。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="template-name">模板名称</Label>
              <Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-category">模板分组</Label>
              <Input id="template-category" list="template-groups" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="我的模板 / 商务 / 公文" />
              <datalist id="template-groups">
                {groups.filter((group) => group !== "全部" && group !== "系统").map((group) => <option key={group} value={group} />)}
              </datalist>
            </div>
          </div>
          {isImport ? (
            <div className="space-y-2">
              <Label htmlFor="reference-docx-path">参考 DOCX 路径</Label>
              <div className="flex gap-2">
                <Input id="reference-docx-path" value={referenceDocxPath} onChange={(event) => setReferenceDocxPath(event.target.value)} placeholder="D:/Documents/report-style.docx" />
                <SoftActionButton type="button" onClick={handleSelectReferenceDocx}>选择文件</SoftActionButton>
              </div>
              <p className="text-xs text-slate-500 dark:text-zinc-400">请选择包含目标标题、正文、表格等样式的 .docx 文件，导入后可继续在样式管理器中微调。</p>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="template-description">模板说明</Label>
            <Textarea id="template-description" value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-20" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-zinc-700/70 dark:bg-zinc-900/72">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-zinc-50">设为默认模板</p>
              <p className="text-xs text-slate-500 dark:text-zinc-400">保存后转换页默认使用这个模板。</p>
            </div>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </div>
        </div>

        <DialogFooter>
          <SoftActionButton onClick={() => onOpenChange(false)} disabled={isSubmitting}>取消</SoftActionButton>
          <PrimaryActionButton onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : isImport ? <FileUp className="size-4" /> : <FilePlus className="size-4" />}
            {isImport ? "导入模板" : "创建模板"}
          </PrimaryActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
