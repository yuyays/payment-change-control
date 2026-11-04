/**
 * Unicode handling for domain comparison.
 *
 * Two separate concerns, deliberately kept apart:
 *  - `decodePunycode` turns an `xn--` label back into its Unicode form.
 *  - `foldConfusables` maps characters that look like Latin letters onto Latin.
 *
 * They are used only for *lookalike* detection. Equality is always decided on the
 * ASCII form, because a homoglyph domain is not the registered domain.
 */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let value = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  value += Math.floor(value / numPoints);

  let k = 0;
  while (value > ((BASE - TMIN) * TMAX) >> 1) {
    value = Math.floor(value / (BASE - TMIN));
    k += BASE;
  }

  return k + Math.floor(((BASE - TMIN + 1) * value) / (value + SKEW));
}

function decodeDigit(codePoint: number): number {
  if (codePoint >= 48 && codePoint <= 57) return codePoint - 22; // 0-9
  if (codePoint >= 65 && codePoint <= 90) return codePoint - 65; // A-Z
  if (codePoint >= 97 && codePoint <= 122) return codePoint - 97; // a-z
  return BASE;
}

/** RFC 3492 decoder. Input is the label without the `xn--` prefix. */
export function decodePunycode(input: string): string {
  const output: number[] = [];

  const basic = input.lastIndexOf("-");
  const basicLength = basic < 0 ? 0 : basic;
  for (let index = 0; index < basicLength; index += 1) {
    output.push(input.charCodeAt(index));
  }

  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  let position = basicLength > 0 ? basicLength + 1 : 0;

  while (position < input.length) {
    const previous = i;
    let weight = 1;

    for (let k = BASE; ; k += BASE) {
      if (position >= input.length) throw new Error("punycode: truncated input");
      const digit = decodeDigit(input.charCodeAt(position));
      position += 1;
      if (digit >= BASE) throw new Error("punycode: invalid digit");

      i += digit * weight;
      const threshold = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < threshold) break;
      weight *= BASE - threshold;
    }

    const outputLength = output.length + 1;
    bias = adapt(i - previous, outputLength, previous === 0);
    n += Math.floor(i / outputLength);
    i %= outputLength;
    output.splice(i, 0, n);
    i += 1;
  }

  return String.fromCodePoint(...output);
}

/**
 * Characters that render like Latin letters. Covers the common Cyrillic and Greek
 * confusables; this is a mitigation, not a complete Unicode confusable table.
 */
const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  һ: "h",
  ӏ: "l",
  к: "k",
  м: "m",
  н: "h",
  т: "t",
  в: "b",
  // Greek
  α: "a",
  β: "b",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  // Latin lookalikes in other ranges
  ı: "i",
  ɡ: "g",
  ɑ: "a",
};

export function foldConfusables(text: string): string {
  let folded = "";
  for (const character of text) {
    folded += CONFUSABLES[character] ?? character;
  }
  return folded;
}

/** Decode `xn--` labels, leave everything else alone. */
export function decodePunycodeLabels(domain: string): string {
  return domain
    .split(".")
    .map((label) => {
      if (!label.startsWith("xn--")) return label;
      try {
        return decodePunycode(label.slice(4));
      } catch {
        return label;
      }
    })
    .join(".");
}
