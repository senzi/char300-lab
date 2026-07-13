import assert from "node:assert/strict";
import test from "node:test";
import { alignDiffToContent, diffTexts, summarizeDiff } from "../src/diff.ts";

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

test("diff display alignment preserves newlines, spaces, and ignored scripts", () => {
  const previous = "第一行\n第二行";
  const current = "第一行\n修改后的第二行 العربية";
  const segments = alignDiffToContent(current, diffTexts(previous, current));

  assert.ok(segments);
  assert.equal(segments.map((segment) => segment.value).join(""), current);
  assert.ok(segments.some((segment) => segment.op === null && segment.value.includes("\n")));
  assert.ok(segments.some((segment) => segment.op === null && segment.value.includes(" العربية")));
  assert.ok(segments.some((segment) => segment.op === "INSERT"));
});

test("diff display alignment safely rejects a stale cache", () => {
  assert.equal(
    alignDiffToContent("真实正文", [{ op: "INSERT", token: { value: "不存在", kind: "han" } }]),
    null
  );
});

test("diff display alignment merges consecutive inserted tokens for continuous highlighting", () => {
  const content = "连续新增文字";
  const segments = alignDiffToContent(content, diffTexts("", content));

  assert.deepEqual(segments, [{ value: content, op: "INSERT" }]);
});

test("diff display alignment renders content plainly when highlighting is omitted", () => {
  const content = "初始版本\n保持原样";
  assert.deepEqual(alignDiffToContent(content, []), [{ value: content, op: null }]);
});
