import { CheckSquare, Edit3, Star, Trash2 } from "lucide-react";
import { ContextMenu } from "radix-ui";
import { toast } from "sonner";
import { WordPreviewPage } from "@/components/templates/word-preview-page";
import { Badge } from "@/components/ui/badge";
import { AppSurface, PrimaryActionButton, SoftActionButton } from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { mergeTemplateStyleConfig } from "@/lib/style-manager-data";
import { getTemplateCategory } from "@/lib/template-categories";
import { cn } from "@/lib/utils";
import type { Template, TemplateStyleConfig } from "@/types";

const contextMenuItemClass = "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:data-[highlighted]:bg-zinc-800";

type TemplateGalleryCardProps = {
  template: Template;
  previewMarkdown?: string;
  previewStyleConfig?: TemplateStyleConfig;
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

export function TemplateGalleryCard({ template, previewMarkdown, previewStyleConfig, isCurrent, isPreviewed, isSelected, onPreview, onToggleSelect, onUse, onSetDefault, onEdit, onStyleManager, onDelete }: TemplateGalleryCardProps) {
  const category = getTemplateCategory(template.tags, template.isBuiltIn);
  const cardPreviewStyleConfig = previewStyleConfig ?? mergeTemplateStyleConfig(template.id);
  const visibleTags = template.isBuiltIn ? [] : template.tags.filter((tag) => tag !== category && tag !== "内置").slice(0, 4);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <AppSurface
          as="article"
          padding="sm"
          radius="sm"
          interactive
          data-mk-context-menu
          className={cn(
            "mk-template-card group relative cursor-pointer overflow-hidden transition",
            isPreviewed && "mk-template-card-previewed border-blue-200 bg-white/86 shadow-[inset_3px_0_0_rgba(37,99,235,0.72)] dark:border-blue-500/60 dark:bg-zinc-900/86 dark:shadow-[inset_3px_0_0_rgba(59,130,246,0.82)]",
            isSelected && "bg-white/88 dark:bg-zinc-900/74",
          )}
          onClick={() => onPreview(template)}
        >
      {isPreviewed ? (
        <span className="mk-template-card-active-ring pointer-events-none absolute inset-1 rounded-[10px] border border-blue-200/70 dark:border-blue-500/50" />
      ) : null}

      <div className="mk-template-card-preview mb-2.5 h-44 overflow-hidden rounded-[8px] border border-slate-200/80 bg-slate-100/70 text-xs shadow-inner shadow-slate-200/70 dark:border-zinc-700/70 dark:bg-zinc-950/70 dark:shadow-none">
        {template.previewImagePath ? (
          <img src={template.previewImagePath} alt={`${template.name} 预览`} className="h-full w-full rounded-md bg-white object-contain dark:bg-zinc-950" />
        ) : (
          <WordPreviewPage
            styleConfig={cardPreviewStyleConfig}
            markdown={previewMarkdown}
            showHeader={false}
            zoom={60}
            className="pointer-events-none h-full max-h-none rounded-none border-0 bg-transparent p-0 shadow-none"
            viewportClassName="mk-template-preview-viewport rounded-[8px] bg-white px-1 py-1 overflow-hidden"
          />
        )}
        <div className="sr-only">{template.previewImagePath ? "用户模板预览图" : "根据模板样式生成的 Word 缩略预览"}</div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border text-white",
            isSelected ? "border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500" : "border-blue-200 bg-white/70 dark:border-zinc-600 dark:bg-zinc-900/72",
          )}
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
            <h3 className="truncate text-sm font-semibold text-slate-950 dark:text-zinc-50">{template.name}</h3>
            {isCurrent ? <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" /> : null}
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs leading-4 text-slate-500 dark:text-zinc-400">{template.description ?? "Word/WPS 参考样式模板"}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {template.isDefault ? <Badge className="rounded-full bg-blue-600 text-white hover:bg-blue-600">默认</Badge> : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="rounded-full bg-blue-50 text-blue-700 dark:bg-blue-500/16 dark:text-blue-200">{category}</Badge>
        {visibleTags.map((tag) => (
          <Badge key={tag} variant="secondary" className="rounded-full bg-white/70 text-slate-500 dark:bg-zinc-800/76 dark:text-zinc-400">{tag}</Badge>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <PrimaryActionButton className="h-8 rounded-[8px] text-xs" size="sm" onClick={(event) => { event.stopPropagation(); onPreview(template); onUse(template); }}>使用</PrimaryActionButton>
        <SoftActionButton className="h-8 rounded-[8px] text-xs" size="sm" onClick={(event) => { event.stopPropagation(); onPreview(template); return template.isDefault ? toast.info("当前已经是默认模板") : onSetDefault(template); }}>{template.isDefault ? "已默认" : "设默认"}</SoftActionButton>
      </div>

      {template.isBuiltIn ? (
        <SoftActionButton className="mt-1.5 h-8 w-full rounded-[8px] text-xs" size="sm" onClick={(event) => { event.stopPropagation(); onPreview(template); onStyleManager(template); }}>
          <Edit3 className="size-4" />
          编辑样式
        </SoftActionButton>
      ) : (
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <SoftActionButton className="h-8 rounded-[8px] text-xs" size="sm" onClick={(event) => { event.stopPropagation(); onPreview(template); onEdit(template); }}><Edit3 className="size-4" />模板信息</SoftActionButton>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 justify-center rounded-[8px] text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-950/35 dark:hover:text-red-200"
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
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-44 rounded-lg border border-slate-200 bg-white p-1.5 text-slate-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onPreview(template)}>预览模板</ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => { onPreview(template); onUse(template); }}>使用此模板</ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onToggleSelect(template)}>选择模板</ContextMenu.Item>
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => onSetDefault(template)} disabled={template.isDefault}>设为默认模板</ContextMenu.Item>
          <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
          {template.isBuiltIn ? (
            <ContextMenu.Item className={contextMenuItemClass} onSelect={() => { onPreview(template); onStyleManager(template); }}>编辑样式</ContextMenu.Item>
          ) : (
            <ContextMenu.Item className={contextMenuItemClass} onSelect={() => { onPreview(template); onEdit(template); }}>编辑模板信息</ContextMenu.Item>
          )}
          <ContextMenu.Item className={contextMenuItemClass} onSelect={() => { onPreview(template); onStyleManager(template); }}>打开样式管理器</ContextMenu.Item>
          <ContextMenu.Item className={cn(contextMenuItemClass, "text-red-600 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700 dark:text-red-300 dark:data-[highlighted]:bg-red-500/12 dark:data-[highlighted]:text-red-200")} onSelect={() => onDelete(template)} disabled={template.isBuiltIn}>删除模板</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
