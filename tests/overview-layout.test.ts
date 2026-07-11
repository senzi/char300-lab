import assert from "node:assert/strict";
import test from "node:test";
import { getOverviewExportBarLayout, overviewExportTrackWidth } from "../src/overview-layout.ts";

test("365 overview export bars stay inside the fixed canvas track", () => {
  const count = 365;
  const { barGap, barWidth } = getOverviewExportBarLayout(count);
  const occupiedWidth = count * barWidth + (count - 1) * barGap;

  assert.ok(barWidth >= 1);
  assert.ok(occupiedWidth <= overviewExportTrackWidth + Number.EPSILON);
});

test("short overview ranges keep readable capped bars", () => {
  const { barGap, barWidth } = getOverviewExportBarLayout(8);
  assert.equal(barGap, 2);
  assert.equal(barWidth, 14);
});
