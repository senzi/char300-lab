import type { DiffSummary, DiffUnit, TextToken } from "./types";
import { tokenize } from "./tokenizer.ts";

export function diffTexts(previous: string, current: string): DiffUnit[] {
  return diffTokens(tokenize(previous), tokenize(current));
}

export function diffTokens(previous: TextToken[], current: TextToken[]): DiffUnit[] {
  const rows = previous.length + 1;
  const cols = current.length + 1;
  const lcs = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = previous.length - 1; row >= 0; row -= 1) {
    for (let col = current.length - 1; col >= 0; col -= 1) {
      if (sameToken(previous[row], current[col])) {
        lcs[row][col] = lcs[row + 1][col + 1] + 1;
      } else {
        lcs[row][col] = Math.max(lcs[row + 1][col], lcs[row][col + 1]);
      }
    }
  }

  const diff: DiffUnit[] = [];
  let row = 0;
  let col = 0;

  while (row < previous.length && col < current.length) {
    if (sameToken(previous[row], current[col])) {
      diff.push({ op: "KEEP", token: current[col] });
      row += 1;
      col += 1;
    } else if (lcs[row + 1][col] >= lcs[row][col + 1]) {
      diff.push({ op: "DELETE", token: previous[row] });
      row += 1;
    } else {
      diff.push({ op: "INSERT", token: current[col] });
      col += 1;
    }
  }

  while (row < previous.length) {
    diff.push({ op: "DELETE", token: previous[row] });
    row += 1;
  }

  while (col < current.length) {
    diff.push({ op: "INSERT", token: current[col] });
    col += 1;
  }

  return diff;
}

export function summarizeDiff(previous: string, current: string): DiffSummary {
  const summary: DiffSummary = {
    han: { insert: 0, delete: 0 },
    number: { insert: 0, delete: 0 },
    latin: { insert: 0, delete: 0 },
    punctuation: { insert: 0, delete: 0 }
  };

  for (const unit of diffTexts(previous, current)) {
    if (unit.op === "KEEP") {
      continue;
    }

    const group =
      unit.token.kind === "han"
        ? summary.han
        : unit.token.kind === "latin"
          ? summary.latin
          : unit.token.kind === "number"
            ? summary.number
            : summary.punctuation;
    if (unit.op === "INSERT") {
      group.insert += 1;
    } else {
      group.delete += 1;
    }
  }

  return summary;
}

function sameToken(left: TextToken, right: TextToken): boolean {
  return left.kind === right.kind && left.value === right.value;
}
