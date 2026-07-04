import type { TextToken, TokenKind, TokenStats } from "./types";

const hanRegex = /\p{Script=Han}/u;
const latinRegex = /\p{Script=Latin}/u;
const digitRegex = /[0-9]/;
const punctuationRegex = /[\p{P}\p{S}]/u;

export function tokenize(input: string): TextToken[] {
  const tokens: TextToken[] = [];
  const chars = Array.from(input);

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];

    if (digitRegex.test(char)) {
      let value = char;
      while (index + 1 < chars.length && digitRegex.test(chars[index + 1])) {
        index += 1;
        value += chars[index];
      }
      tokens.push({ value, kind: "number" });
      continue;
    }

    if (latinRegex.test(char)) {
      let value = char;
      while (index + 1 < chars.length && latinRegex.test(chars[index + 1])) {
        index += 1;
        value += chars[index];
      }
      tokens.push({ value, kind: "latin" });
      continue;
    }

    const kind = classifyChar(char);
    if (kind) {
      tokens.push({ value: char, kind });
    }
  }

  return tokens;
}

export function getTokenStats(input: string): TokenStats {
  const tokens = tokenize(input);
  const han_units = tokens.filter((token) => token.kind === "han").length;
  const latin_units = tokens.filter((token) => token.kind === "latin").length;
  const number_units = tokens.filter((token) => token.kind === "number").length;
  const punctuation_units = tokens.filter((token) => token.kind === "punctuation").length;

  return {
    text_units: han_units + latin_units + number_units,
    punctuation_units,
    total_units: han_units + latin_units + number_units + punctuation_units,
    han_units,
    latin_units,
    number_units
  };
}

function classifyChar(char: string): TokenKind | null {
  if (hanRegex.test(char)) {
    return "han";
  }

  if (punctuationRegex.test(char)) {
    return "punctuation";
  }

  return null;
}
