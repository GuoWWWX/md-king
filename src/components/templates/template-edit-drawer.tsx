import { FileText, Loader2, Palette, Save, TriangleAlert, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { selectDocxFile } from "@/lib/tauri";
import type { Template } from "@/types";

type TemplateEditDrawerProps = {
  open: boolean;
  template?: Template;
  groups: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (template: Template) => Promise<void>;
  onSetDefault: (template: Template) => Promise<void>;
  onOpenStyleManager: (template?: Template) => void;
};

export function TemplateEditDrawer({ open, template, groups, onOpenChange, onSave, onSetDefault, onOpenStyleManager }: TemplateEditDrawerProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [description, setDescription] = useState("");
  const [referenceDocxPath, setReferenceDocxPath] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canEditMetadata = Boolean(template && !template.isBuiltIn);
  const categoryOptions = useMemo(() => groups.filter((group) => group !== "全部" && group !== "系统"), [groups]);
  const hasChanges = template ? (
    name.trim() !== template.name ||
    description.trim() !== (template.description ?? "") ||
    referenceDocxPath.trim() !== template.referenceDocxPath ||
    isDefault !== template.isDefault ||
    normalizeTags(category, tagsText).join("\n") !== template.tags.join("\n")
  ) : false;

  useEffect(() => {
    if (!open || !template) return;
    const [firstTag = "未分组", ...restTags] = template.tags;
    setName(template.name);
    setCategory(firstTag);
    setTagsText(restTags.join(" / "));
    setDescription(template.description ?? "");
    setReferenceDocxPath(template.referenceDocxPath);
    setIsDefault(template.isDefault);
  }, [open, template]);

  async function handleSelectReferenceDocx() {
    try {
      const selected = await selectDocxFile();
      if (!selected) return;
      setReferenceDocxPath(selected);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "选择 reference.docx 失败");
    }
  }

  async function handleSetDefault() {
    if (!template || isDefault) return;
    setIsDefault(true);
    if (canEditMetadata) return;

    setIsSaving(true);
    try {
      await onSetDefault(template);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSave() {
    if (!template || !canEditMetadata) return;
    const nextName = name.trim();
    if (!nextName) {
      toast.error("请填写模板名称");
      return;
    }
    const nextReferenceDocxPath = referenceDocxPath.trim();
    if (nextReferenceDocxPath && !nextReferenceDocxPath.toLowerCase().endsWith(".docx")) {
      toast.error("reference.docx 路径必须指向 .docx 文件");
      return;
    }

    const nextTemplate: Template = {
      ...template,
      name: nextName,
      description: description.trim() || undefined,
      referenceDocxPath: nextReferenceDocxPath,
      tags: normalizeTags(category, tagsText),
      isDefault,
      updatedAt: new Date().toISOString(),
    };

    setIsSaving(true);
    try {
      await onSave(nextTemplate);
      toast.success(`已保存「${nextTemplate.name}」`);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="left-auto right-0 top-0 h-screen max-h-screen w-[480px] max-w-[calc(100vw-0.75rem)] translate-x-0 translate-y-0 overflow-hidden rounded-l-[8px] rounded-r-none border-l border-slate-200 p-0 sm:max-w-[480px]" showCloseButton={false}>
        <div className="flex h-full flex-col bg-white">
          <DialogHeader className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="truncate text-base font-semibold text-slate-950">编辑模板</DialogTitle>
                <DialogDescription className="mt-1 truncate text-xs text-slate-500">{template?.name ?? "未选择模板"}</DialogDescription>
              </div>
              <Button variant="ghost" size="icon-sm" className="rounded-[8px]" onClick={() => onOpenChange(false)} aria-label="关闭">
                <X className="size-4" />
              </Button>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
            {template?.isBuiltIn ? (
              <div className="flex items-center gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                <TriangleAlert className="size-4 shrink-0" />
                <span className="min-w-0">内置模板信息已锁定，可设为默认或进入样式管理器。</span>
              </div>
            ) : null}

            <section className="space-y-3 rounded-[8px] border border-slate-200 bg-white p-3">
              <SectionTitle>模板信息</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="模板名称"><Input value={name} onChange={(event) => setName(event.target.value)} disabled={!canEditMetadata || isSaving} /></Field>
                <Field label="分组">
                  <Input value={category} list="template-edit-groups" onChange={(event) => setCategory(event.target.value)} disabled={!canEditMetadata || isSaving} />
                  <datalist id="template-edit-groups">
                    {categoryOptions.map((group) => <option key={group} value={group} />)}
                  </datalist>
                </Field>
              </div>
              <Field label="标签"><Input value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="多个标签用 / 或逗号分隔" disabled={!canEditMetadata || isSaving} /></Field>
              <Field label="说明"><Textarea className="min-h-20 resize-none" value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canEditMetadata || isSaving} /></Field>
              <div className="flex items-center justify-between gap-3 rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-sm font-medium text-slate-800">默认模板</span>
                {isDefault ? (
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">当前默认</span>
                ) : (
                  <Button variant="outline" size="sm" className="h-7 rounded-[8px]" disabled={isSaving} onClick={() => void handleSetDefault()}>
                    设为默认
                  </Button>
                )}
              </div>
            </section>

            <section className="space-y-3 rounded-[8px] border border-slate-200 bg-white p-3">
              <SectionTitle>模板文件</SectionTitle>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><FileText className="size-3.5" />Reference DOCX</Label>
                <div className="flex gap-2">
                  <Input value={referenceDocxPath} onChange={(event) => setReferenceDocxPath(event.target.value)} placeholder="选择或填写 .docx 文件路径" disabled={!canEditMetadata || isSaving} />
                  <SoftActionButton className="h-8 rounded-[8px]" size="sm" disabled={!canEditMetadata || isSaving} onClick={handleSelectReferenceDocx}>
                    <Upload className="size-4" />
                    选择
                  </SoftActionButton>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-sm font-medium text-slate-800">样式设置</span>
                <Button size="sm" variant="outline" className="h-7 rounded-[8px]" onClick={() => onOpenStyleManager(template)}>
                  <Palette className="size-4" />
                  打开
                </Button>
              </div>
            </section>

          </div>

          <DialogFooter className="m-0 flex-row justify-end gap-2 rounded-none border-t border-slate-200 bg-white px-4 py-3">
            <SoftActionButton className="h-8 rounded-[8px]" onClick={() => onOpenChange(false)}>取消</SoftActionButton>
            <PrimaryActionButton className="h-8 rounded-[8px]" disabled={!canEditMetadata || !hasChanges || isSaving} onClick={() => void handleSave()}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存
            </PrimaryActionButton>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-slate-950">{children}</h3>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs font-medium text-slate-500">{label}</Label>{children}</div>;
}

function normalizeTags(category: string, tagsText: string) {
  const group = category.trim() || "未分组";
  const tags = tagsText
    .split(/[\/,，、]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => tag !== group);
  return Array.from(new Set([group, ...tags]));
}
