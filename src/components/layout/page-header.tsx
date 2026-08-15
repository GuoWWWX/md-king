import type { ReactNode } from "react";
import { AppSurface } from "@/components/ui/app-surface";
import { cn } from "@/lib/utils";

export type PageMeta = {
  title: string;
  description: string;
  tags?: string[];
};

type PageHeaderProps = {
  meta: PageMeta;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ meta, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3 dark:border-zinc-800", className)}>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-black text-slate-950 dark:text-zinc-50">{meta.title}</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500 dark:text-zinc-400">{meta.description}</p>
      </div>
      {actions ? <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </header>
  );
}

export function WorkspacePageHeader({ meta, actions }: Pick<PageHeaderProps, "meta" | "actions">) {
  return (
    <AppSurface as="section" padding="none" className="shrink-0">
      <PageHeader meta={meta} actions={actions} className="border-b-0 px-4 py-3" />
    </AppSurface>
  );
}
