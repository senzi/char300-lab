import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { getStorageStatus, hasMeaningfulArticleData, loadState, normalizeState, parseImportedState, persistState, shouldShowOpfsUpgradePrompt } from "../src/store.ts";
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
