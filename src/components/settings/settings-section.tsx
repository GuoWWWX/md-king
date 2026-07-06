import { type LucideIcon } from "lucide-react";
import { AppSurface } from "@/components/ui/app-surface";

type SettingsSectionProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
};

export function SettingsSection({ title, description, icon: Icon, children }: SettingsSectionProps) {
  return (
    <AppSurface as="section" className="space-y-3" padding="md">
      <div className="space-y-1.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-zinc-50">
          {Icon ? <Icon className="size-4 text-blue-600 dark:text-blue-300" /> : null}
          {title}
        </h3>
        {description ? <p className="text-xs leading-5 text-slate-500 dark:text-zinc-400">{description}</p> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </AppSurface>
  );
}
