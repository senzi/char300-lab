import assert from "node:assert/strict";
import test from "node:test";
import { getTokenStats } from "../src/tokenizer.ts";
import { makeEditedSyntheticArchive } from "./fixtures.ts";

test("edited synthetic archives contain deterministic non-zero changes after V1", () => {
  const options = { days: 3, entriesPerDay: 1.5, versionsPerEntry: 5, unitsPerVersion: 300, endDate: "2026-07-11", seed: 42 };
  const left = makeEditedSyntheticArchive(options);
  const right = makeEditedSyntheticArchive(options);
  assert.deepEqual(left, right);

  for (const entry of left.entries) {
    assert.equal(entry.versions.length, 5);
    assert.ok(entry.versions[0].diff_from_previous.some((unit) => unit.op === "INSERT"));
    for (const version of entry.versions.slice(1)) {
      assert.ok(version.diff_from_previous.some((unit) => unit.op !== "KEEP"));
      assert.deepEqual(version.token_stats, getTokenStats(version.content));
    }
  }
});
