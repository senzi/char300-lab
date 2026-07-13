import assert from "node:assert/strict";
import test from "node:test";
import { getOverviewExportBarLayout, getOverviewMonthMarkers, getRevisionTotals, overviewExportTrackWidth } from "../src/overview-layout.ts";

test("365 overview export bars stay inside the fixed canvas track", () => {
  const count = 365;
  const { barGap, barWidth, startOffset } = getOverviewExportBarLayout(count);
  const occupiedWidth = startOffset + count * barWidth + (count - 1) * barGap;

  assert.ok(barWidth >= 1);
  assert.ok(occupiedWidth <= overviewExportTrackWidth + Number.EPSILON);
});

test("short overview ranges keep readable capped bars", () => {
  const { barGap, barWidth, startOffset } = getOverviewExportBarLayout(8);
  assert.equal(barWidth, 14);
  assert.equal(startOffset, 0);
  assert.ok(barGap > barWidth);
});

test("a single overview bar is centered in the export track", () => {
  const { barWidth, startOffset } = getOverviewExportBarLayout(1);
  assert.equal(startOffset + barWidth / 2, overviewExportTrackWidth / 2);
});

test("overview month markers map month changes to rolling week columns", () => {
  const keys = ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"];
  assert.deepEqual(getOverviewMonthMarkers(keys), [
    { column: 0, label: "7月" },
    { column: 1, label: "8月" }
  ]);
});

test("overview revision totals exclude initial writing and sum later saved changes", () => {
  const token = { value: "字", kind: "han" as const };
  const totals = getRevisionTotals([
    { diff_from_previous: [{ op: "INSERT" as const, token }] },
    { diff_from_previous: [{ op: "KEEP" as const, token }, { op: "INSERT" as const, token }] },
    { diff_from_previous: [{ op: "DELETE" as const, token }] }
  ]);
  assert.deepEqual(totals, { inserted: 1, deleted: 1 });
});
