import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { generateCompressedZip } from "../src/backup.ts";
import { makeEditedSyntheticArchive } from "../tests/fixtures.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "test", "generated");
const endDate = "2026-07-11";
const profiles = [
  { name: "8天-轻量", days: 8 },
  { name: "30天-中量", days: 30 },
  { name: "365天-长期", days: 365 }
];

await fs.mkdir(outputDirectory, { recursive: true });

for (const profile of profiles) {
  const state = makeEditedSyntheticArchive({
    days: profile.days,
    entriesPerDay: 1.625,
    versionsPerEntry: 5.15,
    unitsPerVersion: 320,
    endDate,
    seed: 20260711 + profile.days
  });
  const payload = {
    app: "逐字",
    schema_version: 2,
    exported_at: "2026-07-11T12:00:00.000Z",
    state,
    preferences: { theme: "auto" }
  };
  const json = JSON.stringify(payload, null, 2);
  const zip = new JSZip();
  zip.file("zhuzi-data.json", json);
  zip.file(
    "README.txt",
    [
      "逐字合成性能体验档案",
      `档位：${profile.name}`,
      `日期：${state.entries.map((entry) => entry.date_key).sort()[0]} 至 ${endDate}`,
      `练习：${state.entries.length} 篇`,
      `版本：${state.entries.reduce((total, entry) => total + entry.versions.length, 0)} 个`,
      "正文和每版编辑均由固定随机种子生成，不包含任何真实用户内容。",
      "导入会替换当前浏览器档案，请先导出自己的完整备份。"
    ].join("\n")
  );
  const blob = await generateCompressedZip(zip);
  const filename = `逐字-合成档案-${profile.name}-${endDate}.zip`;
  await fs.writeFile(path.join(outputDirectory, filename), new Uint8Array(await blob.arrayBuffer()));
  console.log(
    JSON.stringify({
      filename,
      days: profile.days,
      entries: state.entries.length,
      versions: state.entries.reduce((total, entry) => total + entry.versions.length, 0),
      jsonBytes: new TextEncoder().encode(json).length,
      zipBytes: blob.size
    })
  );
}
