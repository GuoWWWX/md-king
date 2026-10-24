import { useState } from "react";
import { Languages } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/hooks/use-language";
import { normalizeLanguage, t } from "@/lib/i18n";
import { saveAppConfig } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";

export function LanguageMenu() {
  const language = useLanguage();
  const config = useAppStore((state) => state.appConfig);
  const [saving, setSaving] = useState(false);

  async function changeLanguage(value: string) {
    if (!config || saving || value === language) return;
    const nextLanguage = normalizeLanguage(value);
    const previousLanguage = config.language;
    const store = useAppStore.getState();
    store.setAppConfig({ ...config, language: nextLanguage });
    setSaving(true);
    try {
      await saveAppConfig({ ...config, language: nextLanguage });
    } catch {
      const current = useAppStore.getState();
      if (current.appConfig) current.setAppConfig({ ...current.appConfig, language: previousLanguage });
      toast.error(t("切换语言失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="mk-sidebar-icon-button size-9 shrink-0 rounded-[8px] px-0" title={t("语言 / Language")} tooltipSide="right" aria-label={t("语言 / Language")} disabled={!config || saving}>
          <Languages className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-40">
        <DropdownMenuRadioGroup value={language} onValueChange={(value) => void changeLanguage(value)}>
          <DropdownMenuRadioItem value="zh" lang="zh-CN">简体中文</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en" lang="en">English</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
