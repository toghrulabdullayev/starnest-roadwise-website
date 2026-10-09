const NUMBER = /\d+(?:[.,]\d+)?/g;

function normalizeNumber(token: string): string {
  return token.replace(",", ".").replace(/^0+(?=\d)/, "");
}

export function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map(normalizeNumber);
}

export function ungroundedNumbers(texts: string[], serializedInput: string): string[] {
  const allowed = new Set(numbersIn(serializedInput));
  const invented = new Set<string>();
  for (const text of texts) {
    for (const n of numbersIn(text)) {
      if (!allowed.has(n)) invented.add(n);
    }
  }
  return [...invented];
}
