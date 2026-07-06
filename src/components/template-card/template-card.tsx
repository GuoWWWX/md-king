import { ArrowRight, Check, FileText } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/stores/app-store";
import type { Template } from "@/types";

type TemplateCardProps = {
  template: Template;
};

export function TemplateCard({ template }: TemplateCardProps) {
  const { currentTemplateId, setActivePage, setCurrentTemplateId } = useAppStore();
  const isCurrent = currentTemplateId === template.id;

  function useForCurrentConvert() {
    setCurrentTemplateId(template.id);
    setActivePage("convert");
    toast.success(`已选择「${template.name}」作为本次转换模板`);
  }

  return (
    <Card className="min-w-0 bg-card/80">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{template.name}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {template.isDefault ? <Badge>默认</Badge> : null}
            {isCurrent ? (
              <Badge variant="secondary">
                <Check className="size-3" />
                本次使用
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {template.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
        <p className="truncate text-xs text-muted-foreground">{template.referenceDocxPath || "内置模板配置"}</p>
        <Button className="w-full" variant={isCurrent ? "secondary" : "outline"} onClick={useForCurrentConvert}>
          {isCurrent ? <FileText className="size-4" /> : <ArrowRight className="size-4" />}
          {isCurrent ? "已用于本次转换" : "用于本次转换"}
        </Button>
      </CardContent>
    </Card>
  );
}
