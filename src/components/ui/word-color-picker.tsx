import { Check, ChevronDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ColorOption = {
  name: string;
  value: string;
};

type ColorColumn = {
  name: string;
  colors: string[];
};

type WordColorPickerProps = {
  value: string;
  onChange: (value: string) => void;
  autoColor?: string;
  autoLabel?: string;
  className?: string;
};

const themeColorColumns: ColorColumn[] = [
  { name: "白色", colors: ["#FFFFFF", "#F2F2F2", "#D9D9D9", "#BFBFBF", "#A6A6A6", "#7F7F7F"] },
  { name: "黑色", colors: ["#F2F2F2", "#D9D9D9", "#A6A6A6", "#7F7F7F", "#404040", "#000000"] },
  { name: "浅灰", colors: ["#F7F7F7", "#E7E6E6", "#D0CECE", "#AEAAAA", "#757171", "#3A3838"] },
  { name: "深蓝灰", colors: ["#E8EDF5", "#D9E2F3", "#B4C6E7", "#8EAADB", "#44546A", "#2F3B4A"] },
  { name: "蓝色", colors: ["#EAF3FB", "#DDEBF7", "#BDD7EE", "#9DC3E6", "#5B9BD5", "#2E75B6"] },
  { name: "橙色", colors: ["#FEF0E8", "#FCE4D6", "#F8CBAD", "#F4B183", "#ED7D31", "#C55A11"] },
  { name: "绿色", colors: ["#ECF6E8", "#E2F0D9", "#C6E0B4", "#A9D18E", "#70AD47", "#548235"] },
  { name: "青色", colors: ["#E7F6FB", "#DDEBF7", "#B7DEE8", "#92CDDC", "#00B0F0", "#0070C0"] },
  { name: "紫色", colors: ["#F4E6F2", "#EADCF8", "#D9BDEB", "#C79FE2", "#A64D79", "#7030A0"] },
  { name: "草绿", colors: ["#EEF8E8", "#E2F0D9", "#C5E0B4", "#A9D18E", "#92D050", "#70AD47"] },
];

const themeColors = themeColorColumns[0].colors.flatMap((_, rowIndex) =>
  themeColorColumns.map((column) => ({
    name: column.name,
    value: column.colors[rowIndex],
    tone: rowIndex + 1,
  })),
);

const standardColors: ColorOption[] = [
  { name: "深红", value: "#C00000" },
  { name: "红色", value: "#FF0000" },
  { name: "橙黄", value: "#FFC000" },
  { name: "黄色", value: "#FFFF00" },
  { name: "浅绿", value: "#92D050" },
  { name: "绿色", value: "#00B050" },
  { name: "青蓝", value: "#00B0F0" },
  { name: "蓝色", value: "#0070C0" },
  { name: "深蓝", value: "#002060" },
  { name: "紫色", value: "#7030A0" },
];

export function WordColorPicker({ value, onChange, autoColor = "#111827", autoLabel = "自动", className }: WordColorPickerProps) {
  const [open, setOpen] = useState(false);
  const normalizedValue = normalizeColor(value);
  const normalizedAuto = normalizeColor(autoColor);
  const selectedLabel = useMemo(() => findColorLabel(normalizedValue) ?? normalizedValue, [normalizedValue]);

  function chooseColor(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
  }

  function handleHexChange(nextValue: string) {
    onChange(nextValue.trim().toUpperCase());
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("h-10 w-full justify-between rounded-lg border-slate-200 bg-slate-50 px-3 text-slate-900 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-50 dark:hover:bg-zinc-800", className)}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <ColorSwatch color={normalizedValue} selected={false} />
            <span className="truncate text-sm font-semibold">{selectedLabel}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-slate-500 dark:text-zinc-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-[318px] rounded-xl border border-slate-200 bg-white p-3 text-slate-900 shadow-xl shadow-slate-900/12 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50">
        <button
          type="button"
          className="flex h-10 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-semibold text-slate-900 outline-none transition hover:bg-slate-100 focus-visible:bg-slate-100 dark:text-zinc-50 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800"
          onClick={() => chooseColor(normalizedAuto)}
        >
          <ColorSwatch color={normalizedAuto} selected={normalizedValue === normalizedAuto} />
          {autoLabel}
        </button>

        <ColorSection title="主题颜色">
          <div className="grid grid-cols-10 gap-1.5">
            {themeColors.map((color) => (
              <SwatchButton key={`${color.name}-${color.value}-${color.tone}`} color={color.value} label={`${color.name} ${color.tone}`} selected={normalizeColor(color.value) === normalizedValue} onClick={chooseColor} />
            ))}
          </div>
        </ColorSection>

        <ColorSection title="标准色">
          <div className="grid grid-cols-10 gap-1.5">
            {standardColors.map((color) => (
              <SwatchButton key={color.value} color={color.value} label={color.name} selected={normalizeColor(color.value) === normalizedValue} onClick={chooseColor} />
            ))}
          </div>
        </ColorSection>

        <div className="mt-3 border-t border-slate-200 pt-3 dark:border-zinc-700">
          <label className="text-xs font-semibold text-slate-500 dark:text-zinc-400">HEX 颜色值</label>
          <Input className="mt-1.5 h-9 rounded-lg bg-slate-50 font-mono text-sm uppercase dark:bg-zinc-950" value={value} onChange={(event) => handleHexChange(event.target.value)} />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3">
      <div className="mb-2 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500 dark:bg-zinc-800 dark:text-zinc-300">{title}</div>
      {children}
    </section>
  );
}

function SwatchButton({ color, label, selected, onClick }: { color: string; label: string; selected: boolean; onClick: (value: string) => void }) {
  const normalizedColor = normalizeColor(color);

  return (
    <button
      type="button"
      title={label}
      aria-label={`${label} ${normalizedColor}`}
      className={cn(
        "group relative size-6 rounded-[4px] border border-slate-300 outline-none transition hover:scale-105 hover:ring-2 hover:ring-slate-300 focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-zinc-600 dark:hover:ring-zinc-500 dark:focus-visible:ring-zinc-400",
        selected && "ring-2 ring-slate-900 dark:ring-zinc-100",
      )}
      style={{ backgroundColor: normalizedColor }}
      onClick={() => onClick(normalizedColor)}
    >
      {selected ? <Check className={cn("absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2", isDarkColor(normalizedColor) ? "text-white" : "text-slate-950")} /> : null}
    </button>
  );
}

function ColorSwatch({ color, selected }: { color: string; selected: boolean }) {
  return (
    <span
      className={cn("relative size-5 shrink-0 rounded-[5px] border border-slate-300 shadow-sm dark:border-zinc-600", selected && "ring-2 ring-slate-900 dark:ring-zinc-100")}
      style={{ backgroundColor: color }}
    />
  );
}

function normalizeColor(color: string) {
  const nextColor = color.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(nextColor)) {
    const [, r, g, b] = nextColor;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  if (/^#[0-9a-fA-F]{6}$/.test(nextColor)) {
    return nextColor.toUpperCase();
  }

  return nextColor || "#111827";
}

function findColorLabel(color: string) {
  if (color === "#111827") return "自动";
  for (const column of themeColorColumns) {
    if (column.colors.some((item) => normalizeColor(item) === color)) return color;
  }

  return standardColors.find((item) => normalizeColor(item.value) === color)?.name;
}

function isDarkColor(color: string) {
  if (!/^#[0-9A-F]{6}$/.test(color)) return true;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 < 145;
}
