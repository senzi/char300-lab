import { performance } from "node:perf_hooks";
import { diffTexts } from "../src/diff.ts";
import { getTokenStats } from "../src/tokenizer.ts";
import { makeSyntheticArchive } from "../tests/fixtures.ts";

const encoder = new TextEncoder();

function time(operation) {
  const started = performance.now();
  const result = operation();
  return { result, milliseconds: performance.now() - started };
}

function benchmarkArchive(days) {
  const state = makeSyntheticArchive({ days });
  const serialized = time(() => JSON.stringify(state));
  const bytes = encoder.encode(serialized.result).length;
  const parsed = time(() => JSON.parse(serialized.result));
  return {
    days,
    entries: state.entries.length,
    versions: state.entries.reduce((total, entry) => total + entry.versions.length, 0),
    compactBytes: bytes,
    compactMiB: Number((bytes / 1024 / 1024).toFixed(2)),
    stringifyMs: Number(serialized.milliseconds.toFixed(2)),
    parseMs: Number(parsed.milliseconds.toFixed(2))
  };
}

const sample = "逐字写作，English 2026。".repeat(40);
const stats = time(() => {
  for (let index = 0; index < 1000; index += 1) {
    getTokenStats(sample);
  }
});
const diff = time(() => diffTexts("初稿。".repeat(80), "终稿！".repeat(80)));
const profiles = [8, 30, 365].map(benchmarkArchive);

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      assumptions: {
        entriesPerDay: 1.625,
        versionsPerEntry: 5,
        unitsPerVersion: 320,
        note: "Synthetic diff arrays are shared in memory but serialize in full, matching current JSON growth."
      },
      profiles,
      tokenStats1000RunsMs: Number(stats.milliseconds.toFixed(2)),
      diff240UnitsMs: Number(diff.milliseconds.toFixed(2))
    },
    null,
    2
  )
);
