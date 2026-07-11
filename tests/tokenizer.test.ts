import assert from "node:assert/strict";
import test from "node:test";
import { getTokenStats, tokenize } from "../src/tokenizer.ts";

test("tokenizer preserves the established Chinese, Latin, number, and punctuation rules", () => {
  assert.deepEqual(tokenize("你好，world test 2026。"), [
    { value: "你", kind: "han" },
    { value: "好", kind: "han" },
    { value: "，", kind: "punctuation" },
    { value: "world", kind: "latin" },
    { value: "test", kind: "latin" },
    { value: "2026", kind: "number" },
    { value: "。", kind: "punctuation" }
  ]);
});

test("whitespace and non-target scripts do not participate in token diff", () => {
  assert.deepEqual(tokenize("空 格\nالعربية"), [
    { value: "空", kind: "han" },
    { value: "格", kind: "han" }
  ]);
});

test("emoji remains classified as punctuation/symbol and accented Latin stays grouped", () => {
  assert.deepEqual(tokenize("🙂 café"), [
    { value: "🙂", kind: "punctuation" },
    { value: "café", kind: "latin" }
  ]);
});

test("statistics keep continuous numbers and Latin sequences as single units", () => {
  assert.deepEqual(getTokenStats("2026年写100字，English。"), {
    text_units: 6,
    punctuation_units: 2,
    total_units: 8,
    han_units: 3,
    latin_units: 1,
    number_units: 2
  });
});
