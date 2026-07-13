import assert from "node:assert/strict";
import test from "node:test";
import { getWritingYearRange, getWritingYears } from "../src/writing-years.ts";

test("a writing year lasts a fixed 365 calendar days after its first saved date", () => {
  assert.deepEqual(getWritingYearRange("2026-07-13", 0), {
    index: 0,
    startKey: "2026-07-13",
    endKey: "2027-07-12"
  });
});

test("day 366 does not create a second writing year without a saved version", () => {
  const years = getWritingYears(["2026-07-13", "2027-07-12"], "2027-07-13");
  assert.equal(years.length, 1);
  assert.equal(years[0]?.current, false);
});

test("the first saved version after a completed year activates the next writing year", () => {
  const years = getWritingYears(["2026-07-13", "2027-07-12", "2027-10-21"], "2027-10-21");
  assert.deepEqual(years, [
    { index: 0, startKey: "2026-07-13", endKey: "2027-07-12", current: false },
    { index: 1, startKey: "2027-10-21", endKey: "2028-10-19", current: true }
  ]);
});

test("saved dates inside an existing writing year never activate another year", () => {
  const years = getWritingYears(["2026-01-01", "2027-01-01", "2027-12-31"], "2027-12-31");
  assert.equal(years.length, 2);
  assert.deepEqual(years[1], { index: 1, startKey: "2027-01-01", endKey: "2027-12-31", current: true });
});

test("a third writing year also waits for its first saved version", () => {
  const beforeActivation = getWritingYears(["2026-01-01", "2027-01-01"], "2028-01-01");
  assert.equal(beforeActivation.length, 2);
  const activated = getWritingYears(["2026-01-01", "2027-01-01", "2028-02-15"], "2028-02-15");
  assert.equal(activated.length, 3);
  assert.equal(activated[2]?.startKey, "2028-02-15");
});

test("leap days do not change the fixed 365-day duration", () => {
  assert.deepEqual(getWritingYearRange("2027-03-01", 0), {
    index: 0,
    startKey: "2027-03-01",
    endKey: "2028-02-28"
  });
});
