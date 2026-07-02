import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type StatusPillProps = {
  icon?: LucideIcon;
  label: string;
  tone?: "default" | "success" | "warning" | "danger" | "indigo";
  className?: string;
};

const toneClassName = {
  default: "border-slate-200 bg-white text-slate-600",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
};

export function StatusPill({ icon: Icon, label, tone = "default", className }: StatusPillProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", toneClassName[tone], className)}>
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}
