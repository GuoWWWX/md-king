export function containsWordChineseText(text: string) {
  return /[\u3400-\u9fff]/u.test(text);
}

// A quote can be a separate emphasis token, so use the whole paragraph's context.
export function splitWordPreviewQuotes(text: string, chineseContext = containsWordChineseText(text)) {
  const pieces: Array<{ text: string; chineseQuote: boolean }> = [];
  for (const character of text) {
    const chineseQuote = chineseContext && /[“”‘’]/u.test(character);
    const previous = pieces[pieces.length - 1];
    if (previous?.chineseQuote === chineseQuote) previous.text += character;
    else pieces.push({ text: character, chineseQuote });
  }
  return pieces;
}
