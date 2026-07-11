import assert from "node:assert/strict";
import test from "node:test";
import { diffTexts, summarizeDiff } from "../src/diff.ts";

test("diff reports adjacent token insertion and deletion", () => {
  const result = diffTexts("你好 world。", "你好 improved。 2026");
  assert.deepEqual(
    result.filter((unit) => unit.op !== "KEEP"),
    [
      { op: "DELETE", token: { value: "world", kind: "latin" } },
      { op: "INSERT", token: { value: "improved", kind: "latin" } },
      { op: "INSERT", token: { value: "2026", kind: "number" } }
    ]
  );
});

test("whitespace-only edits intentionally produce no diff", () => {
  assert.deepEqual(diffTexts("第一行\n第二行", "第一行 第二行"), [
    { op: "KEEP", token: { value: "第", kind: "han" } },
    { op: "KEEP", token: { value: "一", kind: "han" } },
    { op: "KEEP", token: { value: "行", kind: "han" } },
    { op: "KEEP", token: { value: "第", kind: "han" } },
    { op: "KEEP", token: { value: "二", kind: "han" } },
    { op: "KEEP", token: { value: "行", kind: "han" } }
  ]);
});

test("summary separates text and punctuation changes", () => {
  assert.deepEqual(summarizeDiff("初稿。", "终稿！2026"), {
    han: { insert: 1, delete: 1 },
    number: { insert: 1, delete: 0 },
    latin: { insert: 0, delete: 0 },
    punctuation: { insert: 1, delete: 1 }
  });
});
