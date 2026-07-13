import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  addBackupJsonFiles,
  analysisBackupJsonPath,
  createAnalysisBackupPayload,
  fullBackupJsonPath,
  generateCompressedZip,
  isZipBackupFile,
  readBackupPayload
} from "../src/backup.ts";
import { makeState, makeSyntheticArchive } from "./fixtures.ts";

function namedBlob(parts: BlobPart[], name: string, type: string): Blob & { name: string; type: string } {
  const blob = new Blob(parts, { type }) as Blob & { name: string; type: string };
  Object.defineProperty(blob, "name", { configurable: true, value: name });
  return blob;
}

test("JSON backup payload remains readable", async () => {
  const payload = { app: "逐字", schema_version: 2, state: makeState() };
  const file = namedBlob([JSON.stringify(payload)], "backup.json", "application/json");
  assert.deepEqual(await readBackupPayload(file), payload);
});

test("current zhuzi-data ZIP remains readable", async () => {
  const payload = { app: "逐字", schema_version: 2, state: makeState() };
  const zip = new JSZip();
  zip.file("zhuzi-data.json", JSON.stringify(payload));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const file = namedBlob([bytes], "backup.zip", "application/zip");
  assert.deepEqual(await readBackupPayload(file), payload);
});

test("ZIP export writes unchanged full data plus a restorable analysis JSON", async () => {
  const payload = { app: "逐字", schema_version: 2 as const, state: makeState() };
  const zip = new JSZip();
  addBackupJsonFiles(zip, payload);

  const complete = JSON.parse(await zip.file(fullBackupJsonPath)!.async("string"));
  const analysis = JSON.parse(await zip.file(analysisBackupJsonPath)!.async("string"));
  assert.deepEqual(complete, payload);
  assert.equal(Array.isArray(complete.state.entries[0].versions[0].diff_from_previous), true);
  assert.equal("diff_from_previous" in analysis.state.entries[0].versions[0], false);
  assert.equal("diff_summary" in analysis.state.entries[0].versions[0], true);

  const bytes = await zip.generateAsync({ type: "uint8array" });
  const file = namedBlob([bytes], "dual-format.zip", "application/zip");
  assert.deepEqual(await readBackupPayload(file), payload);
});

test("ZIP import prefers the complete payload over the analysis payload", async () => {
  const completePayload = { app: "逐字", schema_version: 2, marker: "complete", state: makeState() };
  const analysisPayload = { app: "逐字", schema_version: 2, marker: "analysis", state: makeState() };
  const zip = new JSZip();
  zip.file(analysisBackupJsonPath, JSON.stringify(analysisPayload));
  zip.file(fullBackupJsonPath, JSON.stringify(completePayload));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const file = namedBlob([bytes], "backup.zip", "application/zip");
  assert.deepEqual(await readBackupPayload(file), completePayload);
});

test("ZIP import falls back to the analysis payload when complete data is absent", async () => {
  const analysisPayload = { app: "逐字", schema_version: 2, state: makeState() };
  const zip = new JSZip();
  zip.file(analysisBackupJsonPath, JSON.stringify(analysisPayload));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const file = namedBlob([bytes], "analysis-only.zip", "application/zip");
  assert.deepEqual(await readBackupPayload(file), analysisPayload);
});

test("ZIP import falls back to analysis when the complete JSON is damaged", async () => {
  const analysisPayload = { app: "逐字", schema_version: 2, state: makeState() };
  const zip = new JSZip();
  zip.file(fullBackupJsonPath, "{damaged");
  zip.file(analysisBackupJsonPath, JSON.stringify(analysisPayload));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const file = namedBlob([bytes], "recoverable.zip", "application/zip");
  assert.deepEqual(await readBackupPayload(file), analysisPayload);
});

test("analysis payload removes full diffs without mutating restorable version data", () => {
  const state = makeState();
  state.entries[0].versions[0].content = "第一行\n第二行";
  const completePayload = { app: "逐字", schema_version: 2 as const, state, preferences: { theme: "auto" } };
  const before = structuredClone(completePayload);

  const analysisPayload = createAnalysisBackupPayload(completePayload);
  const version = analysisPayload.state.entries[0].versions[0];

  assert.equal("diff_from_previous" in version, false);
  assert.equal(version.content, "第一行\n第二行");
  assert.equal(version.version_id, state.entries[0].versions[0].version_id);
  assert.equal(version.created_at, state.entries[0].versions[0].created_at);
  assert.equal(analysisPayload.export_profile, "analysis");
  assert.deepEqual(analysisPayload.derived_fields_included, { diff_summary: true, full_diff: false });
  assert.ok(version.diff_summary.han.insert > 0);
  assert.deepEqual(completePayload, before);
  assert.equal("diff_from_previous" in completePayload.state.entries[0].versions[0], true);
});

test("analysis JSON remains substantially smaller than verbose full diff data", () => {
  const state = makeSyntheticArchive({ days: 8 });
  const completePayload = { app: "逐字", schema_version: 2 as const, state };
  const analysisPayload = createAnalysisBackupPayload(completePayload);
  const fullBytes = new TextEncoder().encode(JSON.stringify(completePayload)).length;
  const analysisBytes = new TextEncoder().encode(JSON.stringify(analysisPayload)).length;

  assert.ok(analysisBytes < fullBytes * 0.2, `expected analysis JSON under 20% of full JSON, got ${analysisBytes}/${fullBytes}`);
});

test("legacy char300-lab-data ZIP remains readable", async () => {
  const payload = { state: makeState() };
  const zip = new JSZip();
  zip.file("char300-lab-data.json", JSON.stringify(payload));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const file = namedBlob([bytes], "legacy.zip", "application/x-zip-compressed");
  assert.deepEqual(await readBackupPayload(file), payload);
});

test("ZIP detection supports extension and known MIME types", () => {
  assert.equal(isZipBackupFile({ name: "backup.ZIP", type: "" }), true);
  assert.equal(isZipBackupFile({ name: "backup.bin", type: "application/zip" }), true);
  assert.equal(isZipBackupFile({ name: "backup.json", type: "application/json" }), false);
});

test("ZIP export uses compatible DEFLATE compression", async () => {
  const repetitivePayload = JSON.stringify({ state: makeState(), padding: "逐字".repeat(20_000) });
  const zip = new JSZip();
  zip.file("zhuzi-data.json", repetitivePayload);

  const compressed = await generateCompressedZip(zip);
  assert.ok(compressed.size < new TextEncoder().encode(repetitivePayload).length / 5);

  const file = namedBlob([compressed], "compressed.zip", "application/zip");
  const restored = (await readBackupPayload(file)) as { padding: string };
  assert.equal(restored.padding, "逐字".repeat(20_000));
});
