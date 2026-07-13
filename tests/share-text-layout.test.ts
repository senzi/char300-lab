import assert from "node:assert/strict";
import test from "node:test";
import { getTrackedTextWidth, layoutShareText } from "../src/share-text-layout.ts";

const measureMonospace = (text: string): number => Array.from(text).length * 10;

test("share text keeps a closing punctuation mark on the previous line with slight tightening", () => {
  const lines = layoutShareText("这是上一行的文字。下一句", 80, measureMonospace, 1.5);
  assert.equal(lines[0]?.text, "这是上一行的文字。");
  assert.ok((lines[0]?.tracking ?? 0) < 0);
  assert.ok(getTrackedTextWidth(lines[0]!.text, lines[0]!.tracking, measureMonospace) <= 80);
  assert.equal(lines[1]?.text, "下一句");
});

test("share text moves a character with punctuation when tightening would be excessive", () => {
  const lines = layoutShareText("短句。继续", 20, measureMonospace, 1.5);
  assert.deepEqual(lines.slice(0, 2), [
    { text: "短", tracking: 0 },
    { text: "句。", tracking: 0 }
  ]);
});

test("share text does not leave an opening punctuation mark at line end", () => {
  const lines = layoutShareText("前文（后续", 30, measureMonospace);
  assert.equal(lines[0]?.text, "前文");
  assert.equal(lines[1]?.text, "（后续");
});

test("share text preserves explicit blank lines", () => {
  const lines = layoutShareText("第一段\n\n第二段", 100, measureMonospace);
  assert.deepEqual(lines, [
    { text: "第一段", tracking: 0 },
    { text: "", tracking: 0 },
    { text: "第二段", tracking: 0 }
  ]);
});
