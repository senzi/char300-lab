import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { generateCompressedZip, isZipBackupFile, readBackupPayload } from "../src/backup.ts";
import { makeState } from "./fixtures.ts";

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
