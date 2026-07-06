import { Badge } from "@/components/ui/badge";

export type PageMeta = {
  eyebrow: string;
  title: string;
  description: string;
  tags?: string[];
};

type PageHeaderProps = {
  meta: PageMeta;
};

export function PageHeader({ meta }: PageHeaderProps) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="text-[11px] font-bold text-blue-700/55">{meta.eyebrow}</div>
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="shrink-0 text-2xl font-black tracking-[-0.045em] text-slate-950 md:text-3xl">{meta.title}</h2>
          <p className="hidden min-w-0 truncate text-sm text-slate-500 lg:block">{meta.description}</p>
        </div>
      </div>
      {meta.tags?.length ? (
        <div className="hidden shrink-0 flex-wrap gap-2 md:flex">
          {meta.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="mk-chip rounded-full px-3 py-1 text-xs font-bold text-blue-900/70">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
