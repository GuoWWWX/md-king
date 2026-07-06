import { CheckSquare, Edit3, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { WordPreviewPage } from "@/components/templates/word-preview-page";
import { Badge } from "@/components/ui/badge";
import { AppSurface, PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { mergeTemplateStyleConfig } from "@/lib/style-manager-data";
import { getTemplateCategory } from "@/lib/template-categories";
import { cn } from "@/lib/utils";
import type { Template } from "@/types";

type TemplateGalleryCardProps = {
  template: Template;
  isCurrent?: boolean;
  isPreviewed?: boolean;
  isSelected?: boolean;
  onPreview: (template: Template) => void;
  onToggleSelect: (template: Template) => void;
  onUse: (template: Template) => void;
  onSetDefault: (template: Template) => void;
  onEdit: (template: Template) => void;
  onStyleManager: (template: Template) => void;
  onDelete: (template: Template) => void;
};

export function TemplateGalleryCard({ template, isCurrent, isPreviewed, isSelected, onPreview, onToggleSelect, onUse, onSetDefault, onEdit, onStyleManager, onDelete }: TemplateGalleryCardProps) {
  const category = getTemplateCategory(template.tags, template.isBuiltIn);
  const previewStyleConfig = mergeTemplateStyleConfig(template.id);
  const previewMarkdown = createTemplatePreviewMarkdown(template, category);
  const visibleTags = template.isBuiltIn ? [] : template.tags.filter((tag) => tag !== category && tag !== "内置").slice(0, 4);

  return (
    <AppSurface
      as="article"
      radius="sm"
      interactive
      className={cn(
        "mk-template-card group relative cursor-pointer overflow-hidden transition",
        isPreviewed && "border-blue-200 bg-white/86 shadow-[inset_3px_0_0_rgba(37,99,235,0.72)]",
        isSelected && "bg-white/88",
      )}
      onClick={() => onPreview(template)}
    >
      {isPreviewed ? (
        <span className="mk-template-card-active-ring pointer-events-none absolute inset-1 rounded-[10px] border border-blue-200/70" />
      ) : null}

      <div className="mk-template-card-preview mb-3 h-44 overflow-hidden rounded-[10px] border border-slate-200/80 bg-slate-100/70 text-xs shadow-inner shadow-slate-200/70">
        {template.previewImagePath ? (
          <img src={template.previewImagePath} alt={`${template.name} 预览`} className="h-full w-full rounded-md object-cover" />
        ) : (
          <WordPreviewPage
            styleConfig={previewStyleConfig}
            markdown={previewMarkdown}
            showHeader={false}
            showPageFooter={false}
            zoom={74}
            pageWidth={620}
            pageMinHeight={780}
            className="pointer-events-none h-full max-h-none rounded-none border-0 bg-transparent p-0 shadow-none"
            viewportClassName="mk-template-preview-viewport rounded-[10px] bg-gradient-to-br from-white/86 to-slate-100/80 px-1 py-1 overflow-hidden"
          />
        )}
        <div className="sr-only">{template.previewImagePath ? "用户模板预览图" : "根据模板样式生成的 Word 缩略预览"}</div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-lg border text-white", isSelected ? "border-blue-600 bg-blue-600" : "border-blue-200 bg-white/70")}
          onClick={(event) => {
            event.stopPropagation();
            onPreview(template);
            onToggleSelect(template);
          }}
          aria-label={`选择 ${template.name}`}
        >
          {isSelected ? <CheckSquare className="size-4" /> : null}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-slate-950">{template.name}</h3>
            {isCurrent ? <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" /> : null}
          </div>
          <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-slate-500">{template.description ?? "Word/WPS 参考样式模板"}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {template.isDefault ? <Badge className="rounded-full bg-blue-600 text-white hover:bg-blue-600">默认</Badge> : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="rounded-full bg-blue-50 text-blue-700">{category}</Badge>
        {visibleTags.map((tag) => (
          <Badge key={tag} variant="secondary" className="rounded-full bg-white/70 text-slate-500">{tag}</Badge>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <PrimaryActionButton className="h-9 rounded-[9px]" size="sm" onClick={(event) => { event.stopPropagation(); onPreview(template); onUse(template); }}>使用</PrimaryActionButton>
        <SoftActionButton className="h-9 rounded-[9px]" size="sm" onClick={(event) => { event.stopPropagation(); onPreview(template); return template.isDefault ? toast.info("当前已经是默认模板") : onSetDefault(template); }}>{template.isDefault ? "已默认" : "设默认"}</SoftActionButton>
      </div>

      {template.isBuiltIn ? (
        <SoftActionButton className="mt-2 h-9 w-full rounded-[9px]" size="sm" onClick={(event) => { event.stopPropagation(); onPreview(template); onStyleManager(template); }}>
          <Edit3 className="size-4" />
          编辑样式
        </SoftActionButton>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <SoftActionButton className="h-9 rounded-[9px]" size="sm" onClick={(event) => { event.stopPropagation(); onPreview(template); onEdit(template); }}><Edit3 className="size-4" />模板信息</SoftActionButton>
          <Button
            variant="ghost"
            size="sm"
            className="justify-center text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(template);
            }}
            title="删除模板"
          >
            <Trash2 className="size-4" />
            删除
          </Button>
        </div>
      )}
    </AppSurface>
  );
}

function createTemplatePreviewMarkdown(template: Template, category: string) {
  const text = `${template.name} ${category} ${template.tags.join(" ")}`;
  if (/技术|代码|开发|API/i.test(text)) {
    return "# 技术方案\n\n## 接口概览\n\n- Markdown 解析\n- Word 样式映射\n\n```ts\nconvert(markdown, template)\n```\n\n| 模块 | 状态 |\n| --- | --- |\n| 预览 | 正常 |";
  }

  if (/公文|正式|政务|通知/i.test(text)) {
    return "# 关于材料报送的通知\n\n## 一、总体要求\n\n正文段落用于展示公文模板的标题、行距和段落间距。\n\n> 请按统一格式提交材料。\n\n| 项目 | 要求 |\n| --- | --- |\n| 格式 | 统一 |";
  }

  if (/论文|学术|研究/i.test(text)) {
    return "# 研究报告标题\n\n## 摘要\n\n本文用于预览学术类模板的标题层级、正文和表格样式。\n\n| 指标 | 结果 |\n| --- | --- |\n| 样本 | 120 |";
  }

  return "# 项目报告\n\n## 核心结论\n\n这是一段报告正文，用于快速展示默认模板的标题、正文、引用和表格。\n\n> 关键内容可以在这里突出展示。\n\n| 字段 | 样式 | 备注 |\n| --- | --- | --- |\n| 标题 | 加粗 | 层级清晰 |";
}
