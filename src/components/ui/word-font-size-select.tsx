import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";

type WordFontSizeSelectProps = {
  value: number;
  onChange: (value: number) => void;
  className?: string;
};

const chineseFontSizeOptions = [
  { label: "初号", value: 42 },
  { label: "小初", value: 36 },
  { label: "一号", value: 26 },
  { label: "小一", value: 24 },
  { label: "二号", value: 22 },
  { label: "小二", value: 18 },
  { label: "三号", value: 16 },
  { label: "小三", value: 15 },
  { label: "四号", value: 14 },
  { label: "小四", value: 12 },
  { label: "五号", value: 10.5 },
  { label: "小五", value: 9 },
  { label: "六号", value: 7.5 },
  { label: "小六", value: 6.5 },
  { label: "七号", value: 5.5 },
  { label: "八号", value: 5 },
];

const wordPointSizes = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

function formatSizeValue(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "").replace(/\.$/, "");
}

export function WordFontSizeSelect({ value, onChange, className }: WordFontSizeSelectProps) {
  const selectedValue = formatSizeValue(value);
  const hasSelectedValue = [...chineseFontSizeOptions.map((option) => option.value), ...wordPointSizes].some((optionValue) => optionValue === value);

  return (
    <Select value={selectedValue} onValueChange={(nextValue) => onChange(Number(nextValue))}>
      <SelectTrigger className={className ?? "h-11 w-full rounded-lg bg-slate-50"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {!hasSelectedValue ? (
          <>
            <SelectGroup>
              <SelectLabel>当前值</SelectLabel>
              <SelectItem value={selectedValue}>{formatSizeValue(value)}</SelectItem>
            </SelectGroup>
            <SelectSeparator />
          </>
        ) : null}
        <SelectGroup>
          <SelectLabel>中文字号</SelectLabel>
          {chineseFontSizeOptions.map((option) => (
            <SelectItem key={option.label} value={formatSizeValue(option.value)}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>数字字号</SelectLabel>
          {wordPointSizes
            .filter((size) => !chineseFontSizeOptions.some((option) => option.value === size))
            .map((size) => (
              <SelectItem key={size} value={formatSizeValue(size)}>
                {formatSizeValue(size)}
              </SelectItem>
            ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
