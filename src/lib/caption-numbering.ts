type CaptionNumberingStyle = { captionNumbering: boolean; captionNumberFormat: string };

export function formatCaptionText(source: string, number: number, style: CaptionNumberingStyle) {
  if (!style.captionNumbering) return source;
  const format = style.captionNumberFormat;
  const match = format.match(/\d+(?:[.-]\d+)*/);
  const label = match
    ? format.replace(match[0], () => {
      const separator = Math.max(match[0].lastIndexOf("."), match[0].lastIndexOf("-"));
      return `${match[0].slice(0, separator + 1)}${number}`;
    })
    : `${format.trim()} ${number}`.trim();
  const title = source.replace(/^\s*(?:(?:图|表|Figure|Table)\s*)?(?:[A-Za-z][.-])?\d+(?:[.-]\d+)*[.、:：]?\s*/, "").trim();
  return `${label} ${title}`;
}
