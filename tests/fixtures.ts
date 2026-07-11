import type { AppState, DailyEntry, DiffUnit, Version } from "../src/types.ts";
import { diffTexts } from "../src/diff.ts";
import { getTokenStats } from "../src/tokenizer.ts";

export const fixedNow = "2026-07-11T00:00:00.000Z";

export function makeVersion(
  entryId: string,
  index: number,
  content: string,
  createdAt = `2026-07-11T00:${String(index).padStart(2, "0")}:00.000Z`
): Version {
  return {
    version_id: `${entryId}-version-${index}`,
    entry_id: entryId,
    content,
    created_at: createdAt,
    token_stats: {
      text_units: 0,
      punctuation_units: 0,
      total_units: 0,
      han_units: 0,
      latin_units: 0,
      number_units: 0
    },
    diff_from_previous: [],
    is_initial: index === 1
  };
}

export function makeEntry(overrides: Partial<DailyEntry> = {}): DailyEntry {
  const entryId = overrides.entry_id ?? "entry-1";
  const versions = overrides.versions ?? [makeVersion(entryId, 1, "第一版。")];
  return {
    entry_id: entryId,
    date_key: "2026-07-11",
    created_at: fixedNow,
    updated_at: fixedNow,
    current_version_id: versions.at(-1)?.version_id ?? null,
    optional_title: "第1篇",
    versions,
    draft: versions.at(-1)?.content ?? "",
    lastSavedContent: versions.at(-1)?.content ?? "",
    ...overrides
  };
}

export function makeState(entries = [makeEntry()]): AppState {
  return {
    entries,
    active_entry_id: entries[0]?.entry_id ?? ""
  };
}

export function makeLegacyState(): Record<string, unknown> {
  const entryId = "legacy-entry";
  return {
    entry: {
      entry_id: entryId,
      created_at: "2026-07-04T10:00:00.000Z",
      updated_at: "2026-07-04T10:05:00.000Z",
      current_version_id: "legacy-version-1",
      optional_title: "旧练习"
    },
    versions: [
      {
        ...makeVersion(entryId, 1, "旧版正文。", "2026-07-04T10:05:00.000Z"),
        version_id: "legacy-version-1"
      }
    ],
    draft: "旧版正文。",
    lastSavedContent: "旧版正文。"
  };
}

export function makeSharedDiff(units: number): DiffUnit[] {
  return Array.from({ length: units }, () => ({
    op: "KEEP" as const,
    token: { value: "字", kind: "han" as const }
  }));
}

export function makeSyntheticArchive(options: {
  days: number;
  entriesPerDay?: number;
  versionsPerEntry?: number;
  unitsPerVersion?: number;
  endDate?: string;
}): AppState {
  const entriesPerDay = options.entriesPerDay ?? 1.625;
  const versionsPerEntry = options.versionsPerEntry ?? 5.15;
  const unitsPerVersion = options.unitsPerVersion ?? 320;
  const sharedDiff = makeSharedDiff(unitsPerVersion);
  const content = "字".repeat(unitsPerVersion);
  const entries: DailyEntry[] = [];
  let entrySequence = 0;
  const endDate = new Date(`${options.endDate ?? "2026-12-31"}T00:00:00.000Z`);
  const firstDate = new Date(endDate);
  firstDate.setUTCDate(firstDate.getUTCDate() - options.days + 1);

  for (let day = 0; day < options.days; day += 1) {
    const dailyEntries = Math.max(1, Math.round((day + 1) * entriesPerDay) - Math.round(day * entriesPerDay));
    const date = new Date(firstDate);
    date.setUTCDate(firstDate.getUTCDate() + day);
    const dateKey = date.toISOString().slice(0, 10);

    for (let article = 0; article < dailyEntries; article += 1) {
      entrySequence += 1;
      const entryId = `synthetic-entry-${entrySequence}`;
      const versionCount = Math.max(1, Math.round(versionsPerEntry));
      const versions = Array.from({ length: versionCount }, (_, index): Version => ({
        ...makeVersion(entryId, index + 1, content, `${dateKey}T${String(index).padStart(2, "0")}:00:00.000Z`),
        token_stats: {
          text_units: unitsPerVersion,
          punctuation_units: 0,
          total_units: unitsPerVersion,
          han_units: unitsPerVersion,
          latin_units: 0,
          number_units: 0
        },
        diff_from_previous: sharedDiff
      }));
      entries.push(
        makeEntry({
          entry_id: entryId,
          date_key: dateKey,
          created_at: `${dateKey}T00:00:00.000Z`,
          updated_at: `${dateKey}T04:00:00.000Z`,
          optional_title: `第${article + 1}篇`,
          versions,
          current_version_id: versions.at(-1)?.version_id ?? null,
          draft: content,
          lastSavedContent: content
        })
      );
    }
  }

  return makeState(entries);
}

const syntheticHan = Array.from("逐字写作练习记录表达修改思考观察生活时间语言内容结构节奏清晰准确简洁具体今天继续完成文章版本草稿阅读整理发现问题变化保留选择段落句子观点细节过程结果方法目标习惯积累回顾前进");
const syntheticPunctuation = Array.from("，。；：？！");

export function makeEditedSyntheticArchive(options: {
  days: number;
  entriesPerDay?: number;
  versionsPerEntry?: number;
  unitsPerVersion?: number;
  endDate?: string;
  seed?: number;
}): AppState {
  const entriesPerDay = options.entriesPerDay ?? 1.625;
  const versionsPerEntry = Math.max(2, Math.round(options.versionsPerEntry ?? 5.15));
  const unitsPerVersion = options.unitsPerVersion ?? 320;
  const endDate = new Date(`${options.endDate ?? "2026-12-31"}T00:00:00.000Z`);
  const firstDate = new Date(endDate);
  firstDate.setUTCDate(firstDate.getUTCDate() - options.days + 1);
  const random = mulberry32(options.seed ?? 20260711);
  const entries: DailyEntry[] = [];
  let entrySequence = 0;

  for (let day = 0; day < options.days; day += 1) {
    const dailyEntries = Math.max(1, Math.round((day + 1) * entriesPerDay) - Math.round(day * entriesPerDay));
    const date = new Date(firstDate);
    date.setUTCDate(firstDate.getUTCDate() + day);
    const dateKey = date.toISOString().slice(0, 10);

    for (let article = 0; article < dailyEntries; article += 1) {
      entrySequence += 1;
      const entryId = `synthetic-edited-entry-${entrySequence}`;
      const versions: Version[] = [];
      let content = createSyntheticDraft(unitsPerVersion, random, entrySequence);

      for (let index = 0; index < versionsPerEntry; index += 1) {
        if (index > 0) {
          content = editSyntheticDraft(content, random);
        }
        const previousContent = versions.at(-1)?.content ?? "";
        versions.push({
          version_id: `${entryId}-version-${index + 1}`,
          entry_id: entryId,
          content,
          created_at: `${dateKey}T${String(8 + index).padStart(2, "0")}:${String((entrySequence * 7 + index * 11) % 60).padStart(2, "0")}:00.000Z`,
          token_stats: getTokenStats(content),
          diff_from_previous: diffTexts(previousContent, content),
          is_initial: index === 0
        });
      }

      entries.push(
        makeEntry({
          entry_id: entryId,
          date_key: dateKey,
          created_at: `${dateKey}T08:00:00.000Z`,
          updated_at: versions.at(-1)?.created_at ?? `${dateKey}T08:00:00.000Z`,
          optional_title: `第${article + 1}篇`,
          versions,
          current_version_id: versions.at(-1)?.version_id ?? null,
          draft: versions.at(-1)?.content ?? "",
          lastSavedContent: versions.at(-1)?.content ?? ""
        })
      );
    }
  }

  return makeState(entries);
}

function createSyntheticDraft(targetUnits: number, random: () => number, salt: number): string {
  const chars: string[] = [];
  for (let index = 0; index < targetUnits; index += 1) {
    if (index > 0 && index % (18 + (salt % 7)) === 0) {
      chars.push(syntheticPunctuation[Math.floor(random() * syntheticPunctuation.length)]);
    }
    chars.push(syntheticHan[Math.floor(random() * syntheticHan.length)]);
  }
  chars.push("。");
  return chars.join("");
}

function editSyntheticDraft(input: string, random: () => number): string {
  const chars = Array.from(input);
  const operations = 7 + Math.floor(random() * 7);

  for (let operation = 0; operation < operations; operation += 1) {
    const kind = Math.floor(random() * 4);
    const index = Math.floor(random() * Math.max(chars.length, 1));
    if (kind === 0) {
      chars.splice(index, 0, syntheticHan[Math.floor(random() * syntheticHan.length)]);
    } else if (kind === 1 && chars.length > 260) {
      chars.splice(index, 1);
    } else if (kind === 2) {
      chars[index] = syntheticHan[Math.floor(random() * syntheticHan.length)];
    } else {
      chars.splice(index, 0, syntheticPunctuation[Math.floor(random() * syntheticPunctuation.length)]);
    }
  }

  return chars.join("");
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}
