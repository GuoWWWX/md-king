// Computed SVG/CSS colors are RGB; assert actual readability across theme palettes.
export function contrastRatio(first, second) {
  const luminance = color => {
    const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (values?.length !== 3) throw new Error(`Expected computed RGB color: ${color}`);
    return values.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
