import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { getStorageStatus, hasMeaningfulArticleData, loadState, normalizeState, parseImportedState, persistDraftState, persistState, pruneHistoricalEmptyEntries, shouldShowOpfsUpgradePrompt, updateDraft } from "../src/store.ts";
import { makeEntry, makeLegacyState, makeState, makeVersion } from "./fixtures.ts";

class MemoryStorage implements Storage {
  #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, String(value));
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage()
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: {} }
  });
});

function enableOpfsSupport(): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      storage: {
        getDirectory: async () => {
          throw new Error("Synthetic OPFS handle is not used by prompt tests");
        }
      }
    }
  });
}

test("normalize preserves all stored article and version identity fields", () => {
  const version = makeVersion("entry-stable", 1, "不可改写的正文。", "2026-07-04T12:00:00.000Z");
  const state = makeState([
    makeEntry({
      entry_id: "entry-stable",
      date_key: "2026-07-04",
      created_at: "2026-07-04T10:00:00.000Z",
      updated_at: "2026-07-04T12:00:00.000Z",
      versions: [version],
      current_version_id: version.version_id
    })
  ]);

  const normalized = normalizeState(state);
  assert.equal(normalized.entries[0].entry_id, "entry-stable");
  assert.equal(normalized.entries[0].created_at, "2026-07-04T10:00:00.000Z");
  assert.equal(normalized.entries[0].versions[0].version_id, version.version_id);
  assert.equal(normalized.entries[0].versions[0].entry_id, version.entry_id);
  assert.equal(normalized.entries[0].versions[0].content, version.content);
  assert.equal(normalized.entries[0].versions[0].created_at, version.created_at);
  assert.equal(normalized.entries[0].versions[0].is_initial, true);
});

test("normalize reuses persisted token statistics and diff caches when present", () => {
  const version = makeVersion("entry-derived", 1, "正文已经变化");
  version.token_stats = {
    text_units: 123,
    punctuation_units: 4,
    total_units: 127,
    han_units: 120,
    latin_units: 2,
    number_units: 1
  };
  version.diff_from_previous = [{ op: "INSERT", token: { value: "cache", kind: "latin" } }];

  const normalized = normalizeState(makeState([makeEntry({ entry_id: "entry-derived", versions: [version] })]));

  assert.deepEqual(normalized.entries[0].versions[0].token_stats, version.token_stats);
  assert.deepEqual(normalized.entries[0].versions[0].diff_from_previous, version.diff_from_previous);
});

test("wrapped v2 JSON remains importable without changing content", () => {
  const original = makeState();
  const imported = parseImportedState({ app: "逐字", schema_version: 2, state: original });
  assert.ok(imported);
  assert.equal(imported.entries[0].versions[0].content, original.entries[0].versions[0].content);
  assert.equal(imported.entries[0].versions[0].version_id, original.entries[0].versions[0].version_id);
});

test("bare AppState remains importable", () => {
  const original = makeState();
  const imported = parseImportedState(original);
  assert.ok(imported);
  assert.equal(imported.active_entry_id, original.active_entry_id);
});

test("v1 localStorage migrates without losing the legacy version", () => {
  localStorage.setItem("char300-lab-state-v1", JSON.stringify(makeLegacyState()));
  const migrated = loadState();
  assert.equal(migrated.entries.length, 1);
  assert.equal(migrated.entries[0].entry_id, "legacy-entry");
  assert.equal(migrated.entries[0].versions[0].version_id, "legacy-version-1");
  assert.equal(migrated.entries[0].versions[0].content, "旧版正文。");
  assert.ok(localStorage.getItem("char300-lab-state-v2"));
});

test("existing v2 localStorage remains readable", () => {
  const original = makeState();
  localStorage.setItem("char300-lab-state-v2", JSON.stringify(original));
  const loaded = loadState();
  assert.equal(loaded.entries[0].versions[0].content, original.entries[0].versions[0].content);
  assert.equal(loaded.entries[0].versions[0].version_id, original.entries[0].versions[0].version_id);
});

test("an automatically created empty entry is not meaningful user data", () => {
  const empty = makeEntry({ versions: [], current_version_id: null, draft: "", lastSavedContent: "" });
  assert.equal(hasMeaningfulArticleData(makeState([empty])), false);
});

test("draft text, saved content, and even an empty saved version count as user data", () => {
  assert.equal(hasMeaningfulArticleData(makeState([makeEntry({ versions: [], draft: "草稿", lastSavedContent: "" })])), true);
  assert.equal(hasMeaningfulArticleData(makeState([makeEntry({ versions: [], draft: "", lastSavedContent: "已保存" })])), true);
  assert.equal(hasMeaningfulArticleData(makeState([makeEntry({ versions: [makeVersion("entry-1", 1, "")] })])), true);
});

test("empty v2 data starts on OPFS without showing the legacy upgrade prompt", () => {
  enableOpfsSupport();
  const empty = makeState([makeEntry({ versions: [], current_version_id: null, draft: "", lastSavedContent: "" })]);
  localStorage.setItem("char300-lab-state-v2", JSON.stringify(empty));

  loadState();

  assert.equal(localStorage.getItem("char300-lab-opfs-upgrade-v1"), "upgraded");
  assert.equal(shouldShowOpfsUpgradePrompt(), false);
});

test("meaningful v2 data still receives the one-time OPFS migration prompt", () => {
  enableOpfsSupport();
  localStorage.setItem("char300-lab-state-v2", JSON.stringify(makeState()));

  loadState();

  assert.equal(localStorage.getItem("char300-lab-opfs-upgrade-v1"), null);
  assert.equal(shouldShowOpfsUpgradePrompt(), true);
});

test("empty legacy v1 data starts on OPFS without showing a migration prompt", () => {
  enableOpfsSupport();
  localStorage.setItem(
    "char300-lab-state-v1",
    JSON.stringify({ entry: { entry_id: "legacy-empty", created_at: "2026-07-01T00:00:00.000Z" }, versions: [], draft: "", lastSavedContent: "" })
  );

  loadState();

  assert.equal(localStorage.getItem("char300-lab-opfs-upgrade-v1"), "upgraded");
  assert.equal(shouldShowOpfsUpgradePrompt(), false);
});

test("OPFS-unsupported browsers keep empty state in localStorage without showing an unusable upgrade prompt", () => {
  const empty = makeState([makeEntry({ versions: [], current_version_id: null, draft: "", lastSavedContent: "" })]);
  localStorage.setItem("char300-lab-state-v2", JSON.stringify(empty));

  loadState();

  assert.equal(localStorage.getItem("char300-lab-opfs-upgrade-v1"), null);
  assert.equal(shouldShowOpfsUpgradePrompt(), false);
});

test("OPFS draft input writes a small journal instead of rewriting the full localStorage snapshot", () => {
  enableOpfsSupport();
  const state = loadState();
  const drafted = updateDraft(state, "尚未保存的草稿");

  persistDraftState(drafted);

  assert.equal(localStorage.getItem("char300-lab-state-v2"), null);
  const journal = JSON.parse(localStorage.getItem("char300-lab-draft-journal-v1") ?? "null") as { entries?: Record<string, { draft?: string }> } | null;
  assert.equal(journal?.entries?.[drafted.active_entry_id]?.draft, "尚未保存的草稿");
});

test("OPFS draft journal preserves unsaved drafts from multiple entries", () => {
  enableOpfsSupport();
  const first = makeEntry({ entry_id: "draft-a", updated_at: "2026-07-11T01:00:00.000Z", draft: "A 草稿" });
  const second = makeEntry({ entry_id: "draft-b", updated_at: "2026-07-11T02:00:00.000Z", draft: "B 草稿" });
  loadState();

  persistDraftState({ entries: [first, second], active_entry_id: first.entry_id });
  persistDraftState({ entries: [first, second], active_entry_id: second.entry_id });

  const journal = JSON.parse(localStorage.getItem("char300-lab-draft-journal-v1") ?? "null") as DraftJournalFixture;
  assert.equal(journal.entries[first.entry_id].draft, "A 草稿");
  assert.equal(journal.entries[second.entry_id].draft, "B 草稿");
});

test("a newer draft journal is recovered over an older compatibility snapshot", () => {
  const original = makeState();
  original.entries[0].updated_at = "2026-07-11T01:00:00.000Z";
  original.entries[0].draft = "旧草稿";
  localStorage.setItem("char300-lab-state-v2", JSON.stringify(original));
  localStorage.setItem("char300-lab-opfs-upgrade-v1", "upgraded");
  localStorage.setItem(
    "char300-lab-draft-journal-v1",
    JSON.stringify({ entry_id: original.entries[0].entry_id, draft: "恢复的新草稿", updated_at: "2026-07-11T02:00:00.000Z" })
  );

  const recovered = loadState();

  assert.equal(recovered.entries[0].draft, "恢复的新草稿");
  assert.equal(recovered.entries[0].updated_at, "2026-07-11T02:00:00.000Z");
});

test("the multi-entry draft journal recovers every newer unsaved draft", () => {
  const first = makeEntry({ entry_id: "recover-a", updated_at: "2026-07-11T01:00:00.000Z", draft: "旧 A" });
  const second = makeEntry({ entry_id: "recover-b", updated_at: "2026-07-11T01:00:00.000Z", draft: "旧 B" });
  localStorage.setItem("char300-lab-state-v2", JSON.stringify({ entries: [first, second], active_entry_id: first.entry_id }));
  localStorage.setItem("char300-lab-opfs-upgrade-v1", "upgraded");
  localStorage.setItem(
    "char300-lab-draft-journal-v1",
    JSON.stringify({
      entries: {
        [first.entry_id]: { draft: "新 A", updated_at: "2026-07-11T02:00:00.000Z" },
        [second.entry_id]: { draft: "新 B", updated_at: "2026-07-11T03:00:00.000Z" }
      }
    })
  );

  const recovered = loadState();
  assert.equal(recovered.entries.find((entry) => entry.entry_id === first.entry_id)?.draft, "新 A");
  assert.equal(recovered.entries.find((entry) => entry.entry_id === second.entry_id)?.draft, "新 B");
});

test("historical cleanup never removes an entry containing user data", () => {
  const dated = "2026-01-01";
  const draft = makeEntry({ entry_id: "historical-draft", date_key: dated, versions: [], current_version_id: null, draft: "未保存正文", lastSavedContent: "" });
  const saved = makeEntry({ entry_id: "historical-saved", date_key: dated, draft: "", lastSavedContent: "已保存正文" });
  const versioned = makeEntry({ entry_id: "historical-version", date_key: dated, draft: "", lastSavedContent: "" });

  const cleaned = pruneHistoricalEmptyEntries(makeState([draft, saved, versioned]));
  assert.deepEqual(new Set(cleaned.entries.map((entry) => entry.entry_id)), new Set([draft.entry_id, saved.entry_id, versioned.entry_id]));
});

test("normalize preserves a user-defined entry title", () => {
  const state = makeState([makeEntry({ optional_title: "我的标题" })]);
  assert.equal(normalizeState(state).entries[0].optional_title, "我的标题");
});

type DraftJournalFixture = {
  entries: Record<string, { draft: string; updated_at: string }>;
};

test("storage status reports localStorage fallback when the compatibility snapshot succeeds", () => {
  persistState(makeState());
  assert.equal(getStorageStatus().kind, "local-fallback");
  assert.ok(getStorageStatus().lastSavedAt);
});

test("storage status reports failure without deleting the in-memory state when localStorage throws", () => {
  const failingStorage = new MemoryStorage();
  failingStorage.setItem = () => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: failingStorage
  });

  const state = makeState();
  assert.doesNotThrow(() => persistState(state));
  assert.equal(getStorageStatus().kind, "save-error");
  assert.equal(state.entries[0].versions[0].content, "第一版。");
});
