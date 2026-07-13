import type { DiffSummary, DiffUnit, TextToken } from "./types";
import { tokenize } from "./tokenizer.ts";

export type DiffContentSegment = {
  value: string;
  op: "KEEP" | "INSERT" | null;
};

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

export function alignDiffToContent(content: string, units: DiffUnit[]): DiffContentSegment[] | null {
  const segments: DiffContentSegment[] = [];
  let cursor = 0;
  const appendSegment = (value: string, op: DiffContentSegment["op"]): void => {
    if (!value) {
      return;
    }
    const previous = segments.at(-1);
    if (previous?.op === op) {
      previous.value += value;
    } else {
      segments.push({ value, op });
    }
  };

  for (const unit of units) {
    if (unit.op === "DELETE") {
      continue;
    }

    const tokenStart = content.indexOf(unit.token.value, cursor);
    if (tokenStart < 0) {
      return null;
    }
    if (tokenStart > cursor) {
      appendSegment(content.slice(cursor, tokenStart), null);
    }
    appendSegment(unit.token.value, unit.op);
    cursor = tokenStart + unit.token.value.length;
  }

  if (cursor < content.length) {
    appendSegment(content.slice(cursor), null);
  }

  return segments;
}

function sameToken(left: TextToken, right: TextToken): boolean {
  return left.kind === right.kind && left.value === right.value;
}
