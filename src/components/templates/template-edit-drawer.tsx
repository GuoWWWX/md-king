import { Copy, ExternalLink, FileText, Save, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AppSurface, PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Template } from "@/types";

type TemplateEditDrawerProps = {
  open: boolean;
  template?: Template;
  onOpenChange: (open: boolean) => void;
  onOpenStyleManager: (template?: Template) => void;
};

export function TemplateEditDrawer({ open, template, onOpenChange, onOpenStyleManager }: TemplateEditDrawerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="left-auto right-0 top-0 h-screen max-h-screen w-[560px] max-w-[calc(100vw-1rem)] translate-x-0 translate-y-0 overflow-hidden rounded-l-xl rounded-r-none p-0 sm:max-w-[560px]" showCloseButton={false}>
        <div className="flex h-full flex-col bg-white">
          <DialogHeader className="border-b border-slate-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-xl font-bold">编辑模板</DialogTitle>
                <DialogDescription className="mt-1">修改模板信息，或用 Word/WPS 编辑真实 DOCX 样式。</DialogDescription>
              </div>
              <SoftActionButton onClick={() => onOpenChange(false)}>关闭</SoftActionButton>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
            {template?.isBuiltIn ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <div className="flex items-center gap-2 font-semibold"><TriangleAlert className="size-4" />编辑内置模板</div>
                <p className="mt-2 leading-6">内置模板不能直接覆盖。你可以复制一份作为自定义模板，然后编辑它。</p>
              </div>
            ) : null}

            <AppSurface as="section" variant="plain" radius="sm" padding="none" className="p-4">
              <h3 className="font-semibold text-slate-950">模板预览</h3>
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
                <div className="h-28 rounded-xl bg-gradient-to-br from-indigo-50 to-slate-100 p-4">
                  <div className="h-3 w-24 rounded-full bg-indigo-200" />
                  <div className="mt-3 space-y-2"><div className="h-2 rounded bg-slate-200" /><div className="h-2 w-3/4 rounded bg-slate-200" /></div>
                </div>
              </div>
            </AppSurface>

            <section className="space-y-3">
              <h3 className="font-semibold text-slate-950">基础信息</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="模板名称"><Input defaultValue={template?.name ?? ""} /></Field>
                <Field label="分类"><Input defaultValue={template?.tags[0] ?? ""} /></Field>
              </div>
              <Field label="标签"><Input defaultValue={template?.tags.join(" / ") ?? ""} /></Field>
              <Field label="说明"><Textarea defaultValue={template?.description ?? ""} /></Field>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="text-sm font-medium">设为默认模板</span><Switch checked={template?.isDefault ?? false} /></div>
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="font-semibold text-slate-950">模板文件</h3>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-slate-800"><FileText className="size-4 text-indigo-600" />当前文件</p>
                <p className="mt-1 break-all text-slate-500">{template?.referenceDocxPath || "内置模板暂未绑定真实 reference.docx"}</p>
                <p className="mt-3 text-xs leading-5 text-slate-500">你可以用 Word/WPS 打开这个模板，修改标题、正文、表格、代码块、页边距、页眉页脚等样式。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <SoftActionButton size="sm" onClick={() => toast.info("将打开 Word/WPS 编辑模板文件") }><ExternalLink className="size-4" />用 Word/WPS 打开编辑</SoftActionButton>
                  <SoftActionButton size="sm" disabled title="替换文件入口接入后启用">替换 DOCX 文件</SoftActionButton>
                  <Button size="sm" variant="ghost" onClick={() => onOpenStyleManager(template)}>打开样式管理器</Button>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-semibold text-slate-950">样式诊断</h3>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                真实 DOCX 样式诊断尚未接入。当前不会显示伪造的检测结果。
              </div>
              <SoftActionButton size="sm" disabled title="真实诊断接入后启用">重新诊断</SoftActionButton>
            </section>

            <section className="rounded-lg border border-red-100 bg-red-50 p-4">
              <h3 className="font-semibold text-red-700">危险操作</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm"><Copy className="size-4" />复制模板</Button>
                <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700"><Trash2 className="size-4" />删除模板</Button>
              </div>
            </section>
          </div>

          <DialogFooter className="border-t border-slate-200 p-4">
            <SoftActionButton onClick={() => onOpenChange(false)}>取消</SoftActionButton>
            <PrimaryActionButton disabled title="模板元信息写回接入后启用"><Save className="size-4" />保存元信息</PrimaryActionButton>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}
