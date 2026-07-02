import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

type SettingRowProps = {
  label: string;
  description: string;
  checked?: boolean;
  badge?: string;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

export function SettingRow({ label, description, checked, badge, disabled = false, onCheckedChange }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[12px] border border-white/70 bg-white/58 px-4 py-3">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-950">{label}</p>
          {badge ? <Badge variant="secondary" className="shrink-0 rounded-full bg-blue-50 px-2 py-0 text-[11px] text-blue-700">{badge}</Badge> : null}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      {checked !== undefined ? <Switch className="shrink-0" checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} /> : null}
    </div>
  );
}
