import assert from "node:assert/strict";
import test from "node:test";
import { dailyShareLineHeight, getDailyShareLayout } from "../src/share-card-layout.ts";

test("daily share layout keeps sections ordered for a short article", () => {
  const layout = getDailyShareLayout(1);
  assert.equal(layout.width, 1040);
  assert.ok(layout.contentY > layout.titleY);
  assert.ok(layout.diffStripY > layout.contentY + layout.contentHeight);
  assert.ok(layout.footerDividerY > layout.diffStripY + layout.diffStripHeight);
  assert.ok(layout.logoX + layout.logoSize <= layout.innerRight);
  assert.ok(layout.cardY + layout.cardHeight < layout.height);
});

test("daily share layout grows predictably without changing card width", () => {
  const shortLayout = getDailyShareLayout(3);
  const longLayout = getDailyShareLayout(13);
  assert.equal(longLayout.width, shortLayout.width);
  assert.equal(longLayout.contentHeight - shortLayout.contentHeight, 10 * dailyShareLineHeight);
  assert.equal(longLayout.height - shortLayout.height, 10 * dailyShareLineHeight);
});
