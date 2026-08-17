import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { filterWordFontOptions, findWordFontOption } from "@/lib/word-font-options";
import { cn } from "@/lib/utils";

type WordFontPickerProps = {
  value: string;
  options: readonly string[];
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
};

export function WordFontPicker({ value, options, onValueChange, className, disabled = false }: WordFontPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const filteredOptions = useMemo(() => filterWordFontOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) setQuery(value);
  }, [open, value]);

  function selectFont(font: string) {
    onValueChange(font);
    setQuery(font);
    setOpen(false);
    inputRef.current?.focus();
  }

  function restoreValue() {
    setQuery(value);
    setOpen(false);
  }

  function selectMatchedFont() {
    const exact = findWordFontOption(options, query);
    if (exact) {
      selectFont(exact);
      return;
    }
    if (filteredOptions.length === 1) selectFont(filteredOptions[0]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      restoreValue();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectMatchedFont();
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Input
        ref={inputRef}
        value={query}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label="选择或搜索字体"
        className="h-9 pr-9 bg-slate-50 dark:bg-zinc-900/72"
        onFocus={(event) => {
          setOpen(true);
          event.currentTarget.select();
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (!containerRef.current?.contains(document.activeElement)) restoreValue();
          }, 0);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        title="显示字体列表"
        aria-label="显示字体列表"
        disabled={disabled}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 transition hover:text-slate-700 disabled:pointer-events-none dark:text-zinc-500 dark:hover:text-zinc-200"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setOpen((current) => !current);
          inputRef.current?.focus();
        }}
      >
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
          {filteredOptions.length ? filteredOptions.map((font) => (
            <button
              key={font}
              type="button"
              className={cn(
                "flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-sm transition hover:bg-slate-100 dark:hover:bg-zinc-800",
                font === value && "bg-slate-100 text-slate-950 dark:bg-zinc-800 dark:text-zinc-50",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectFont(font)}
            >
              <span className="truncate" style={{ fontFamily: `"${font}", sans-serif` }}>{font}</span>
              {font === value ? <Check className="ml-2 size-4 shrink-0" /> : null}
            </button>
          )) : <p className="px-2 py-2 text-sm text-slate-500 dark:text-zinc-400">未找到匹配字体</p>}
        </div>
      ) : null}
    </div>
  );
}
