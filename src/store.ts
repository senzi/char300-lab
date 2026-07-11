import type { AppState, DailyEntry, Version } from "./types";
import { diffTexts } from "./diff.ts";
import { getTokenStats } from "./tokenizer.ts";

const storageKey = "char300-lab-state-v2";
const legacyStorageKey = "char300-lab-state-v1";
const opfsUpgradeKey = "char300-lab-opfs-upgrade-v1";
const opfsUpgradeDismissedKey = "char300-lab-opfs-upgrade-dismissed-v1";
const opfsDirectoryName = "char300";
const opfsCheckpointName = "checkpoint.json";
const opfsMetaName = "meta.json";

type LegacySingleEntryState = {
  entry?: Partial<DailyEntry>;
  versions?: Version[];
  draft?: string;
  lastSavedContent?: string;
};

type OpfsUpgradeState = "upgraded" | "failed";

export type StorageStatusKind = "opfs-saved" | "opfs-saving" | "local-fallback" | "save-error";

export type StorageStatus = {
  kind: StorageStatusKind;
  lastSavedAt: string | null;
};

let hadLegacyArticleDataAtStartup = false;
let opfsWriteEnabled = false;
let opfsStorageHealthy = false;
let storageStatus: StorageStatus = { kind: "local-fallback", lastSavedAt: null };
const storageStatusListeners = new Set<() => void>();

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

export function createPracticeEntry(
  key = todayKey(),
  index = 1,
  createdAt = new Date().toISOString()
): DailyEntry {
  return {
    ...createEntry(key, createdAt),
    optional_title: `第${index}篇`
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
  hadLegacyArticleDataAtStartup = false;
  const raw = localStorage.getItem(storageKey);
  if (raw) {
    try {
      const normalized = normalizeState(JSON.parse(raw) as AppState);
      configureStorageForLoadedState(normalized);
      persistState(normalized);
      return normalized;
    } catch {
      return createEmptyState();
    }
  }

  const legacyRaw = localStorage.getItem(legacyStorageKey);
  if (!legacyRaw) {
    opfsWriteEnabled = isOpfsSupported();
    opfsStorageHealthy = opfsWriteEnabled;
    if (opfsWriteEnabled) {
      localStorage.setItem(opfsUpgradeKey, "upgraded" satisfies OpfsUpgradeState);
    }
    return createEmptyState();
  }

  try {
    const migrated = normalizeLegacySingleEntryState(JSON.parse(legacyRaw) as LegacySingleEntryState);
    configureStorageForLoadedState(migrated);
    persistState(migrated);
    return migrated;
  } catch {
    return createEmptyState();
  }
}

export function hasMeaningfulArticleData(state: AppState): boolean {
  return state.entries.some(
    (entry) => entry.versions.length > 0 || entry.draft.length > 0 || entry.lastSavedContent.length > 0
  );
}

export function persistState(state: AppState): void {
  let localStorageSaved = false;
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    localStorageSaved = true;
  } catch {
    localStorageSaved = false;
  }

  if (opfsWriteEnabled) {
    setStorageStatus({ kind: "opfs-saving", lastSavedAt: storageStatus.lastSavedAt });
    void writeOpfsState(state)
      .then(() => {
        opfsStorageHealthy = true;
        setStorageStatus({ kind: "opfs-saved", lastSavedAt: new Date().toISOString() });
      })
      .catch(() => {
        opfsStorageHealthy = false;
        setStorageStatus({
          kind: localStorageSaved ? "local-fallback" : "save-error",
          lastSavedAt: localStorageSaved ? new Date().toISOString() : storageStatus.lastSavedAt
        });
      });
    return;
  }

  setStorageStatus({
    kind: localStorageSaved ? "local-fallback" : "save-error",
    lastSavedAt: localStorageSaved ? new Date().toISOString() : storageStatus.lastSavedAt
  });
}

export function getStorageStatus(): StorageStatus {
  return { ...storageStatus };
}

export function subscribeStorageStatus(listener: () => void): () => void {
  storageStatusListeners.add(listener);
  listener();
  return () => storageStatusListeners.delete(listener);
}

export function ensureTodayEntry(state: AppState): AppState {
  const key = todayKey();
  const existing = sortEntries(state.entries.filter((entry) => entry.date_key === key))[0];
  if (existing) {
    return { ...state, active_entry_id: existing.entry_id };
  }

  const entry = createPracticeEntry(key, 1);
  return {
    entries: sortEntries([...state.entries, entry]),
    active_entry_id: entry.entry_id
  };
}

export function pruneHistoricalEmptyEntries(state: AppState): AppState {
  const key = todayKey();
  const entries = state.entries.filter((entry) => entry.date_key === key || !isEmptyPracticeEntry(entry));
  if (entries.length === state.entries.length) {
    return state;
  }

  const nextEntries = entries.length ? sortEntries(entries) : [createPracticeEntry(key, 1)];
  const active = nextEntries.find((entry) => entry.entry_id === state.active_entry_id) ?? nextEntries[0];
  return {
    entries: nextEntries,
    active_entry_id: active.entry_id
  };
}

export function createTodayPractice(state: AppState): AppState {
  const key = todayKey();
  const entry = createPracticeEntry(key, state.entries.filter((item) => item.date_key === key).length + 1);
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

export function deleteEntry(state: AppState, entryId: string): AppState {
  const target = state.entries.find((entry) => entry.entry_id === entryId);
  if (!target || state.entries.length <= 1) {
    return state;
  }

  const entries = sortEntries(state.entries.filter((entry) => entry.entry_id !== entryId));
  const fallback = entries.find((entry) => entry.date_key === target.date_key) ?? entries[0];
  return {
    entries,
    active_entry_id: state.active_entry_id === entryId ? fallback.entry_id : state.active_entry_id
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

export function shouldShowOpfsUpgradePrompt(): boolean {
  return isOpfsSupported() && hadLegacyArticleDataAtStartup && localStorage.getItem(opfsUpgradeKey) !== "upgraded" && localStorage.getItem(opfsUpgradeDismissedKey) !== "true";
}

export function canOfferOpfsUpgrade(): boolean {
  return isOpfsSupported() && hadLegacyArticleDataAtStartup && localStorage.getItem(opfsUpgradeKey) !== "upgraded";
}

export function isOpfsStorageActive(): boolean {
  return opfsWriteEnabled && opfsStorageHealthy;
}

export function dismissOpfsUpgradePrompt(): void {
  localStorage.setItem(opfsUpgradeDismissedKey, "true");
}

export async function hydrateOpfsStorage(currentState: AppState): Promise<AppState | null> {
  if (!isOpfsSupported() || localStorage.getItem(opfsUpgradeKey) !== "upgraded") {
    return null;
  }

  try {
    const stored = await readOpfsState();
    opfsWriteEnabled = true;
    opfsStorageHealthy = true;
    if (!stored) {
      await writeOpfsState(currentState);
      setStorageStatus({ kind: "opfs-saved", lastSavedAt: new Date().toISOString() });
      return null;
    }

    localStorage.setItem(storageKey, JSON.stringify(stored));
    setStorageStatus({ kind: "opfs-saved", lastSavedAt: new Date().toISOString() });
    return stored;
  } catch {
    opfsWriteEnabled = false;
    opfsStorageHealthy = false;
    setStorageStatus({
      kind: localStorage.getItem(storageKey) ? "local-fallback" : "save-error",
      lastSavedAt: storageStatus.lastSavedAt
    });
    return null;
  }
}

export async function upgradeToOpfsStorage(state: AppState): Promise<void> {
  const normalized = normalizeState(state);
  await writeOpfsState(normalized);
  const stored = await readOpfsState();
  if (!stored || !statesAreEquivalent(normalized, stored)) {
    localStorage.setItem(opfsUpgradeKey, "failed" satisfies OpfsUpgradeState);
    throw new Error("OPFS verification failed");
  }

  opfsWriteEnabled = true;
  opfsStorageHealthy = true;
  localStorage.setItem(opfsUpgradeKey, "upgraded" satisfies OpfsUpgradeState);
  localStorage.removeItem(opfsUpgradeDismissedKey);
  persistState(normalized);
}

export function parseImportedState(payload: unknown): AppState | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const maybeWrapped = payload as { state?: unknown };
  const candidate = maybeWrapped.state ?? payload;
  if (isAppStateLike(candidate)) {
    return normalizeState(candidate as AppState);
  }

  const maybeLegacy = candidate as LegacySingleEntryState;
  if (maybeLegacy.entry || maybeLegacy.versions || typeof maybeLegacy.draft === "string" || typeof maybeLegacy.lastSavedContent === "string") {
    return normalizeLegacySingleEntryState(maybeLegacy);
  }

  return null;
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
      optional_title: entry.optional_title,
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

function isEmptyPracticeEntry(entry: DailyEntry): boolean {
  return entry.versions.length === 0 && entry.draft.trim() === "";
}

export function normalizeState(state: AppState): AppState {
  const fallback = createEmptyState();
  const entries = sortEntries((state.entries?.length ? state.entries : fallback.entries).map(normalizeEntry));
  const active = entries.find((entry) => entry.entry_id === state.active_entry_id) ?? entries[0];
  return {
    entries,
    active_entry_id: active.entry_id
  };
}

function normalizeLegacySingleEntryState(legacy: LegacySingleEntryState): AppState {
  const createdAt = legacy.entry?.created_at ?? new Date().toISOString();
  const key = dateKey(new Date(createdAt));
  const entry: DailyEntry = {
    ...createEntry(key, createdAt),
    ...legacy.entry,
    date_key: key,
    optional_title: legacy.entry?.optional_title ?? key,
    versions: legacy.versions ?? legacy.entry?.versions ?? [],
    draft: legacy.draft ?? legacy.lastSavedContent ?? "",
    lastSavedContent: legacy.lastSavedContent ?? legacy.draft ?? ""
  };
  return normalizeState({ entries: [entry], active_entry_id: entry.entry_id });
}

function isAppStateLike(value: unknown): value is AppState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeState = value as Partial<AppState>;
  return Array.isArray(maybeState.entries) && typeof maybeState.active_entry_id === "string";
}

function isOpfsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
}

function configureStorageForLoadedState(state: AppState): void {
  const alreadyUpgraded = localStorage.getItem(opfsUpgradeKey) === "upgraded";
  const shouldMigrateLegacyData = !alreadyUpgraded && hasMeaningfulArticleData(state);
  const canStartFreshOnOpfs = !alreadyUpgraded && !shouldMigrateLegacyData && isOpfsSupported();

  hadLegacyArticleDataAtStartup = shouldMigrateLegacyData;
  opfsWriteEnabled = canStartFreshOnOpfs;
  opfsStorageHealthy = canStartFreshOnOpfs;

  if (canStartFreshOnOpfs) {
    localStorage.setItem(opfsUpgradeKey, "upgraded" satisfies OpfsUpgradeState);
  }
}

async function getOpfsDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(opfsDirectoryName, { create: true });
}

async function writeOpfsState(state: AppState): Promise<void> {
  const dir = await getOpfsDirectory();
  await writeTextFile(dir, opfsCheckpointName, JSON.stringify(normalizeState(state)));
  await writeTextFile(
    dir,
    opfsMetaName,
    JSON.stringify({
      schema_version: 2,
      upgraded_at: new Date().toISOString(),
      storage: "opfs-checkpoint"
    })
  );
}

async function readOpfsState(): Promise<AppState | null> {
  try {
    const dir = await getOpfsDirectory();
    const fileHandle = await dir.getFileHandle(opfsCheckpointName);
    const file = await fileHandle.getFile();
    return normalizeState(JSON.parse(await file.text()) as AppState);
  } catch {
    return null;
  }
}

async function writeTextFile(dir: FileSystemDirectoryHandle, name: string, content: string): Promise<void> {
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function statesAreEquivalent(left: AppState, right: AppState): boolean {
  return JSON.stringify(normalizeState(left)) === JSON.stringify(normalizeState(right));
}

function setStorageStatus(nextStatus: StorageStatus): void {
  if (storageStatus.kind === nextStatus.kind && storageStatus.lastSavedAt === nextStatus.lastSavedAt) {
    return;
  }

  storageStatus = nextStatus;
  storageStatusListeners.forEach((listener) => listener());
}

function normalizeEntry(entry: DailyEntry): DailyEntry {
  const createdAt = entry.created_at ?? new Date().toISOString();
  const key = entry.date_key ?? dateKey(new Date(createdAt));
  const base = {
    ...createEntry(key, createdAt),
    ...entry,
    date_key: key,
    optional_title: key,
    draft: entry.draft ?? entry.lastSavedContent ?? "",
    lastSavedContent: entry.lastSavedContent ?? entry.draft ?? ""
  };
  const versions = (entry.versions ?? []).map((version, index, versionsList) => ({
    ...version,
    token_stats: getTokenStats(version.content),
    diff_from_previous: diffTexts(versionsList[index - 1]?.content ?? "", version.content)
  }));

  return {
    ...base,
    versions
  };
}

function sortEntries(entries: DailyEntry[]): DailyEntry[] {
  return [...entries].sort((left, right) => {
    const dateSort = right.date_key.localeCompare(left.date_key);
    if (dateSort !== 0) {
      return dateSort;
    }

    return right.created_at.localeCompare(left.created_at);
  });
}
