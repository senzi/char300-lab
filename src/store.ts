import type { AppState, DailyEntry, Version } from "./types";
import { diffTexts } from "./diff";
import { getTokenStats } from "./tokenizer";

const storageKey = "char300-lab-state-v2";
const legacyStorageKey = "char300-lab-state-v1";

export function todayKey(): string {
  return dateKey(new Date());
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createEntry(key = todayKey(), createdAt = new Date().toISOString()): DailyEntry {
  return {
    entry_id: crypto.randomUUID(),
    date_key: key,
    created_at: createdAt,
    updated_at: createdAt,
    current_version_id: null,
    optional_title: key,
    versions: [],
    draft: "",
    lastSavedContent: ""
  };
}

export function createEmptyState(): AppState {
  const entry = createEntry();
  return {
    entries: [entry],
    active_entry_id: entry.entry_id
  };
}

export function loadState(): AppState {
  const raw = localStorage.getItem(storageKey);
  if (raw) {
    try {
      return normalizeState(JSON.parse(raw) as AppState);
    } catch {
      return createEmptyState();
    }
  }

  const legacyRaw = localStorage.getItem(legacyStorageKey);
  if (!legacyRaw) {
    return createEmptyState();
  }

  try {
    const legacy = JSON.parse(legacyRaw) as {
      entry?: Partial<DailyEntry>;
      versions?: Version[];
      draft?: string;
      lastSavedContent?: string;
    };
    const createdAt = legacy.entry?.created_at ?? new Date().toISOString();
    const key = dateKey(new Date(createdAt));
    const entry: DailyEntry = {
      ...createEntry(key, createdAt),
      ...legacy.entry,
      date_key: key,
      optional_title: key,
      versions: legacy.versions ?? [],
      draft: legacy.draft ?? legacy.lastSavedContent ?? "",
      lastSavedContent: legacy.lastSavedContent ?? legacy.draft ?? ""
    };
    const migrated = normalizeState({ entries: [entry], active_entry_id: entry.entry_id });
    persistState(migrated);
    return migrated;
  } catch {
    return createEmptyState();
  }
}

export function persistState(state: AppState): void {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

export function ensureTodayEntry(state: AppState): AppState {
  const key = todayKey();
  const existing = state.entries.find((entry) => entry.date_key === key);
  if (existing) {
    return { ...state, active_entry_id: existing.entry_id };
  }

  const entry = createEntry(key);
  return {
    entries: sortEntries([...state.entries, entry]),
    active_entry_id: entry.entry_id
  };
}

export function switchEntry(state: AppState, entryId: string): AppState {
  if (!state.entries.some((entry) => entry.entry_id === entryId)) {
    return state;
  }

  return {
    ...state,
    active_entry_id: entryId
  };
}

export function updateDraft(state: AppState, content: string): AppState {
  return updateActiveEntry(state, (entry) => ({ ...entry, draft: content, updated_at: new Date().toISOString() }));
}

export function resetState(): AppState {
  const state = createEmptyState();
  persistState(state);
  return state;
}

export function saveVersion(state: AppState): AppState {
  return updateActiveEntry(state, (entry) => {
    const content = entry.draft;
    const previous = entry.versions.at(-1);
    const now = new Date().toISOString();
    const version: Version = {
      version_id: crypto.randomUUID(),
      entry_id: entry.entry_id,
      content,
      created_at: now,
      token_stats: getTokenStats(content),
      diff_from_previous: previous ? diffTexts(previous.content, content) : diffTexts("", content),
      is_initial: entry.versions.length === 0
    };

    return {
      ...entry,
      updated_at: now,
      current_version_id: version.version_id,
      optional_title: entry.date_key,
      versions: [...entry.versions, version],
      lastSavedContent: content
    };
  });
}

export function getActiveEntry(state: AppState): DailyEntry {
  return state.entries.find((entry) => entry.entry_id === state.active_entry_id) ?? state.entries[0] ?? createEntry();
}

export function getFinalVersion(entry: DailyEntry): Version | null {
  return entry.versions.at(-1) ?? null;
}

function updateActiveEntry(state: AppState, updater: (entry: DailyEntry) => DailyEntry): AppState {
  const active = getActiveEntry(state);
  const updated = updater(active);
  return {
    ...state,
    active_entry_id: updated.entry_id,
    entries: sortEntries(state.entries.map((entry) => (entry.entry_id === updated.entry_id ? updated : entry)))
  };
}

function normalizeState(state: AppState): AppState {
  const fallback = createEmptyState();
  const entries = sortEntries((state.entries?.length ? state.entries : fallback.entries).map(normalizeEntry));
  const active = entries.find((entry) => entry.entry_id === state.active_entry_id) ?? entries[0];
  return {
    entries,
    active_entry_id: active.entry_id
  };
}

function normalizeEntry(entry: DailyEntry): DailyEntry {
  const createdAt = entry.created_at ?? new Date().toISOString();
  const key = entry.date_key ?? dateKey(new Date(createdAt));
  return {
    ...createEntry(key, createdAt),
    ...entry,
    date_key: key,
    optional_title: key,
    versions: entry.versions ?? [],
    draft: entry.draft ?? entry.lastSavedContent ?? "",
    lastSavedContent: entry.lastSavedContent ?? entry.draft ?? ""
  };
}

function sortEntries(entries: DailyEntry[]): DailyEntry[] {
  return [...entries].sort((left, right) => right.date_key.localeCompare(left.date_key));
}
