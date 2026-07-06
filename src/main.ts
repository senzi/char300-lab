import "./styles.css";
import JSZip from "jszip";
import logoUrl from "./assets/logo.svg";
import { diffTexts, summarizeDiff } from "./diff";
import { getTokenStats, tokenize } from "./tokenizer";
import type { AppState, DailyEntry, DiffUnit, Version } from "./types";
import { createTodayPractice, deleteEntry, ensureTodayEntry, getActiveEntry, getFinalVersion, loadState, normalizeState, persistState, saveVersion, switchEntry, todayKey, updateDraft } from "./store";

const appName = "逐字";
const appSlogan = "让每一次修改都被看见";
const storageNoticeKey = "zhuzi-storage-notice-dismissed-v1";
const themePreferenceKey = "zhuzi-theme-preference-v1";
const writingYearGoalDays = 365;

type View = "write" | "feed" | "overview";
type DetailMode = "writing" | "version";
type ThemePreference = "auto" | "light" | "dark";
type OverviewDay = {
  key: string;
  state: "written" | "absent" | "future";
  articles: number;
  wordCount: number;
  versions: number;
  inserted: number;
  deleted: number;
  churn: number;
  compression: number | null;
};
type CardChip =
  | { kind: "diff"; label: string; inserted: number; deleted: number; width: number }
  | { kind: "plain"; label: string; value: string; width: number };
type PositionedCardChip = CardChip & { x: number; y: number };

let state: AppState = ensureTodayEntry(loadState());
let view: View = "write";
let detailMode: DetailMode = "writing";
let selectedVersionId: string | null = getActiveEntry(state).current_version_id;
let pendingImportFile: File | null = null;
let historyEditUnlockedEntryId: string | null = null;
let themeHintTimer: number | null = null;

persistState(state);

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root missing");
}

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <img class="app-mark" src="${logoUrl}" alt="" aria-hidden="true" />
        <div>
          <p class="brand-name">${appName}</p>
          <p class="brand-slogan">${appSlogan}</p>
        </div>
      </div>
      <h1 id="dateTitle" class="date-title"></h1>
      <div class="top-actions">
        <button class="button ghost" id="todayButton" type="button">回到今日</button>
        <div class="export-menu-wrap">
          <button class="button ghost" id="exportButton" type="button" aria-expanded="false">导出</button>
          <div class="export-menu hidden" id="exportMenu">
            <button id="exportImageButton" type="button">分享图片</button>
            <button id="exportOverviewImageButton" type="button">总览图片</button>
            <button id="exportDayMarkdownButton" type="button">当日 Markdown</button>
            <button id="exportAllMarkdownButton" type="button">全部 Markdown</button>
            <button id="exportZipButton" type="button">完整数据 ZIP</button>
            <button id="importZipButton" type="button">从 ZIP 导入</button>
          </div>
        </div>
        <button class="button primary" id="saveButton" type="button">保存版本</button>
      </div>
      <input class="hidden" id="importZipInput" type="file" accept=".zip,application/zip" />
    </header>

    <div class="modebar">
      <div class="segmented" role="tablist" aria-label="主视图">
        <button id="writeViewButton" type="button">写作</button>
        <button id="feedViewButton" type="button">阅读流</button>
        <button id="overviewViewButton" type="button">总览</button>
      </div>
      <div class="theme-inline">
        <span class="theme-hint hidden" id="themeHint" aria-live="polite"></span>
        <div class="theme-icon-group" role="radiogroup" aria-label="外观模式">
          <button class="theme-icon-button" type="button" role="radio" data-theme="auto" aria-label="跟随系统" title="跟随系统">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16h-11A2.5 2.5 0 0 1 4 13.5v-7Z" />
              <path d="M9 20h6" />
              <path d="M12 16v4" />
              <path d="M8 8.5h8" />
            </svg>
          </button>
          <button class="theme-icon-button" type="button" role="radio" data-theme="light" aria-label="日间" title="日间">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2.5v2" />
              <path d="M12 19.5v2" />
              <path d="m4.6 4.6 1.4 1.4" />
              <path d="m18 18 1.4 1.4" />
              <path d="M2.5 12h2" />
              <path d="M19.5 12h2" />
              <path d="m4.6 19.4 1.4-1.4" />
              <path d="m18 6 1.4-1.4" />
            </svg>
          </button>
          <button class="theme-icon-button" type="button" role="radio" data-theme="dark" aria-label="夜间" title="夜间">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 14.4A7.8 7.8 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <section class="writing-workspace" id="writingWorkspace">
      <section class="workspace">
        <aside class="overview-panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">Archive</p>
              <h2>每日记录</h2>
            </div>
            <span class="count-pill" id="entryCount">0</span>
          </div>
          <div class="habit-stats" id="habitStats"></div>
          <div class="calendar-list" id="calendarList"></div>
        </aside>

        <section class="main-panel">
          <section class="write-view" id="writeView">
            <div class="practice-bar">
              <div class="practice-tabs" id="practiceTabs"></div>
              <div class="practice-actions">
                <button class="button small" id="deletePracticeButton" type="button">删除空练习</button>
                <button class="button small" id="newPracticeButton" type="button">新练习</button>
              </div>
            </div>
            <div class="meter" id="meter"></div>
            <div class="history-edit-notice hidden" id="historyEditNotice">
              <div>
                <strong>历史日期已锁定</strong>
                <span>跨天文章默认只读。确认后可继续修改，并会把新版本标记为“跨天”。</span>
              </div>
              <button class="button small" id="unlockHistoryEditButton" type="button">解锁历史草稿</button>
            </div>
            <div class="stats-row" id="statsRow"></div>
            <textarea id="editor" spellcheck="false" placeholder="写下今天的 300 字。保存后，每一次修改都会成为不可覆盖的版本。"></textarea>
            <article class="reader hidden" id="reader"></article>
          </section>
        </section>

        <aside class="side-panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">Timeline</p>
              <h2>版本链</h2>
            </div>
            <span class="count-pill" id="versionCount">0</span>
          </div>
          <div class="timeline" id="timeline"></div>
          <div class="diff-summary" id="diffSummary"></div>
        </aside>
      </section>
    </section>

    <section class="feed-view hidden" id="feedView">
      <div class="feed-toolbar">
        <div>
          <p class="panel-kicker">Reading</p>
          <h2>总阅读</h2>
        </div>
        <span id="feedRange"></span>
      </div>
      <div class="feed-list" id="feedList"></div>
    </section>
    <section class="overview-view hidden" id="overviewView">
      <div class="overview-hero">
        <div>
          <p class="panel-kicker">Overview</p>
          <h2>总览</h2>
        </div>
        <span id="overviewRange"></span>
      </div>
      <div class="overview-summary" id="overviewSummary"></div>
      <section class="overview-board">
        <div class="overview-section-head">
          <h3>年度格</h3>
          <span id="overviewGridMeta"></span>
        </div>
        <div class="year-grid" id="overviewYearGrid" aria-label="365 天写作矩阵"></div>
      </section>
      <section class="overview-board">
        <div class="overview-section-head">
          <h3>每日数据</h3>
          <span>按已推进日期展示，不含正文</span>
        </div>
        <div class="overview-bars" id="overviewBars"></div>
      </section>
    </section>
    <footer class="app-footer">
      <a href="https://github.com/senzi/char300-lab" target="_blank" rel="noreferrer">Github</a>
      <span aria-hidden="true">|</span>
      <span>MIT</span>
      <span aria-hidden="true">|</span>
      <span>Vibecoding</span>
      <span aria-hidden="true">|</span>
      <a href="https://weibo.com/1401527553/R71bIwAVs" target="_blank" rel="noreferrer">灵感来源</a>
    </footer>
  </main>
  <div class="notice-backdrop hidden" id="storageNotice" role="dialog" aria-modal="true" aria-labelledby="storageNoticeTitle">
    <section class="notice-dialog">
      <p class="panel-kicker">Local Storage</p>
      <h2 id="storageNoticeTitle">写作内容只保存在当前浏览器</h2>
      <p>网页版不会把文章保存到项目目录或云端。数据保存在当前浏览器、当前访问地址的 localStorage 里；换浏览器、换端口、清理站点数据或使用无痕模式，都可能导致内容不可见或丢失。</p>
      <p>认真写作前，建议定期使用“导出 → 完整数据 ZIP”备份。</p>
      <label class="notice-check">
        <input id="storageNoticeDontShow" type="checkbox" />
        <span>不再提醒</span>
      </label>
      <div class="notice-actions">
        <button class="button primary" id="storageNoticeClose" type="button">我知道了</button>
      </div>
    </section>
  </div>
  <div class="notice-backdrop hidden" id="importConfirm" role="dialog" aria-modal="true" aria-labelledby="importConfirmTitle">
    <section class="notice-dialog">
      <p class="panel-kicker">Import</p>
      <h2 id="importConfirmTitle">导入 ZIP 会替换当前本地档案</h2>
      <p id="importConfirmText">导入会用备份内容覆盖当前环境中的每日记录。继续前，请确认当前内容已经导出备份。</p>
      <p class="inline-status hidden" id="importStatus"></p>
      <div class="notice-actions">
        <button class="button ghost" id="importCancelButton" type="button">取消</button>
        <button class="button primary" id="importConfirmButton" type="button">确认导入</button>
      </div>
    </section>
  </div>
`;

const dateTitle = getElement<HTMLElement>("dateTitle");
const todayButton = getElement<HTMLButtonElement>("todayButton");
const themeHint = getElement<HTMLElement>("themeHint");
const themeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".theme-icon-button[data-theme]"));
const saveButton = getElement<HTMLButtonElement>("saveButton");
const exportButton = getElement<HTMLButtonElement>("exportButton");
const exportMenu = getElement<HTMLElement>("exportMenu");
const exportImageButton = getElement<HTMLButtonElement>("exportImageButton");
const exportDayMarkdownButton = getElement<HTMLButtonElement>("exportDayMarkdownButton");
const exportAllMarkdownButton = getElement<HTMLButtonElement>("exportAllMarkdownButton");
const exportZipButton = getElement<HTMLButtonElement>("exportZipButton");
const importZipButton = getElement<HTMLButtonElement>("importZipButton");
const importZipInput = getElement<HTMLInputElement>("importZipInput");
const writeViewButton = getElement<HTMLButtonElement>("writeViewButton");
const feedViewButton = getElement<HTMLButtonElement>("feedViewButton");
const overviewViewButton = getElement<HTMLButtonElement>("overviewViewButton");
const editor = getElement<HTMLTextAreaElement>("editor");
const reader = getElement<HTMLElement>("reader");
const writingWorkspace = getElement<HTMLElement>("writingWorkspace");
const feedView = getElement<HTMLElement>("feedView");
const overviewView = getElement<HTMLElement>("overviewView");
const feedList = getElement<HTMLElement>("feedList");
const feedRange = getElement<HTMLElement>("feedRange");
const overviewRange = getElement<HTMLElement>("overviewRange");
const exportOverviewImageButton = getElement<HTMLButtonElement>("exportOverviewImageButton");
const overviewSummary = getElement<HTMLElement>("overviewSummary");
const overviewGridMeta = getElement<HTMLElement>("overviewGridMeta");
const overviewYearGrid = getElement<HTMLElement>("overviewYearGrid");
const overviewBars = getElement<HTMLElement>("overviewBars");
const historyEditNotice = getElement<HTMLElement>("historyEditNotice");
const unlockHistoryEditButton = getElement<HTMLButtonElement>("unlockHistoryEditButton");
const practiceTabs = getElement<HTMLElement>("practiceTabs");
const deletePracticeButton = getElement<HTMLButtonElement>("deletePracticeButton");
const newPracticeButton = getElement<HTMLButtonElement>("newPracticeButton");
const timeline = getElement<HTMLElement>("timeline");
const meter = getElement<HTMLElement>("meter");
const statsRow = getElement<HTMLElement>("statsRow");
const versionCount = getElement<HTMLElement>("versionCount");
const entryCount = getElement<HTMLElement>("entryCount");
const habitStats = getElement<HTMLElement>("habitStats");
const calendarList = getElement<HTMLElement>("calendarList");
const diffSummary = getElement<HTMLElement>("diffSummary");
const storageNotice = getElement<HTMLElement>("storageNotice");
const storageNoticeDontShow = getElement<HTMLInputElement>("storageNoticeDontShow");
const storageNoticeClose = getElement<HTMLButtonElement>("storageNoticeClose");
const importConfirm = getElement<HTMLElement>("importConfirm");
const importStatus = getElement<HTMLElement>("importStatus");
const importCancelButton = getElement<HTMLButtonElement>("importCancelButton");
const importConfirmButton = getElement<HTMLButtonElement>("importConfirmButton");
const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
let themePreference = loadThemePreference();

applyThemePreference();

editor.addEventListener("input", () => {
  if (!canEditActiveEntry()) {
    editor.value = getActiveEntry(state).draft;
    return;
  }

  state = updateDraft(state, editor.value);
  persistState(state);
  render();
});

saveButton.addEventListener("click", () => {
  if (!canEditActiveEntry()) {
    return;
  }

  state = saveVersion(state);
  selectedVersionId = getActiveEntry(state).current_version_id;
  detailMode = "writing";
  persistState(state);
  render();
});

todayButton.addEventListener("click", () => {
  state = ensureTodayEntry(state);
  selectedVersionId = getActiveEntry(state).current_version_id;
  detailMode = "writing";
  historyEditUnlockedEntryId = null;
  view = "write";
  persistState(state);
  render();
});

newPracticeButton.addEventListener("click", () => {
  state = createTodayPractice(state);
  selectedVersionId = getActiveEntry(state).current_version_id;
  detailMode = "writing";
  historyEditUnlockedEntryId = null;
  view = "write";
  persistState(state);
  render();
  editor.focus();
});

deletePracticeButton.addEventListener("click", () => {
  const activeEntry = getActiveEntry(state);
  if (!canDeleteActivePractice(activeEntry)) {
    return;
  }

  if (activeEntry.draft.trim() && !window.confirm("这篇练习还没有保存版本，删除后草稿也会消失。确定删除吗？")) {
    return;
  }

  state = deleteEntry(state, activeEntry.entry_id);
  selectedVersionId = getActiveEntry(state).current_version_id;
  detailMode = "writing";
  historyEditUnlockedEntryId = null;
  persistState(state);
  render();
});

exportButton.addEventListener("click", () => {
  const isOpen = !exportMenu.classList.contains("hidden");
  exportMenu.classList.toggle("hidden", isOpen);
  exportButton.setAttribute("aria-expanded", String(!isOpen));
});

themeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    themePreference = parseThemePreference(button.dataset.theme ?? null);
    localStorage.setItem(themePreferenceKey, themePreference);
    applyThemePreference();
    showThemeHint(formatThemePreference(themePreference));
  });
});

exportImageButton.addEventListener("click", () => {
  closeExportMenu();
  void exportDailyCard(getActiveEntry(state));
});

exportOverviewImageButton.addEventListener("click", () => {
  closeExportMenu();
  void exportOverviewCard();
});

exportDayMarkdownButton.addEventListener("click", () => {
  closeExportMenu();
  exportDayMarkdown(getActiveEntry(state));
});

exportAllMarkdownButton.addEventListener("click", () => {
  closeExportMenu();
  exportAllMarkdown();
});

exportZipButton.addEventListener("click", () => {
  closeExportMenu();
  void exportZipBackup();
});

importZipButton.addEventListener("click", () => {
  closeExportMenu();
  importZipInput.click();
});

importZipInput.addEventListener("change", () => {
  const file = importZipInput.files?.[0];
  importZipInput.value = "";
  if (file) {
    pendingImportFile = file;
    showImportConfirm();
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (target instanceof Node && !exportMenu.contains(target) && target !== exportButton) {
    closeExportMenu();
  }
});

storageNoticeClose.addEventListener("click", () => {
  if (storageNoticeDontShow.checked) {
    localStorage.setItem(storageNoticeKey, "true");
  }
  storageNotice.classList.add("hidden");
});

importCancelButton.addEventListener("click", () => {
  pendingImportFile = null;
  importConfirm.classList.add("hidden");
});

importConfirmButton.addEventListener("click", () => {
  if (pendingImportFile) {
    void importZipBackup(pendingImportFile);
  }
});

colorSchemeQuery.addEventListener("change", () => {
  if (themePreference === "auto") {
    applyThemePreference();
  }
});

writeViewButton.addEventListener("click", () => {
  view = "write";
  render();
});

feedViewButton.addEventListener("click", () => {
  view = "feed";
  render();
});

overviewViewButton.addEventListener("click", () => {
  view = "overview";
  render();
});

unlockHistoryEditButton.addEventListener("click", () => {
  const activeEntry = getActiveEntry(state);
  if (!isTodayEntry(activeEntry)) {
    historyEditUnlockedEntryId = activeEntry.entry_id;
    render();
    editor.focus();
  }
});

render();
showStorageNoticeIfNeeded();

function render(): void {
  const activeEntry = getActiveEntry(state);
  const selectedVersion = getSelectedVersion(activeEntry);
  const activeContent = detailMode === "version" ? selectedVersion?.content ?? activeEntry.draft : activeEntry.draft;
  const activeStats = getTokenStats(activeContent);
  const overLimit = activeStats.total_units > 300;
  const progress = Math.min(activeStats.total_units / 300, 1);
  const canEdit = canEditActiveEntry();
  const isHistoricalWriting = !isTodayEntry(activeEntry) && detailMode === "writing";

  dateTitle.textContent = formatDisplayDate(activeEntry.date_key);
  editor.value = activeEntry.draft;
  document.body.classList.toggle("over-limit", overLimit);
  writeViewButton.classList.toggle("active", view === "write");
  feedViewButton.classList.toggle("active", view === "feed");
  overviewViewButton.classList.toggle("active", view === "overview");
  writingWorkspace.classList.toggle("hidden", view !== "write");
  feedView.classList.toggle("hidden", view !== "feed");
  overviewView.classList.toggle("hidden", view !== "overview");
  editor.classList.toggle("hidden", detailMode === "version");
  reader.classList.toggle("hidden", detailMode === "writing");
  historyEditNotice.classList.toggle("hidden", !isHistoricalWriting || canEdit);
  newPracticeButton.disabled = !isTodayEntry(activeEntry);
  deletePracticeButton.disabled = !canDeleteActivePractice(activeEntry);
  editor.disabled = !canEdit;
  saveButton.disabled = !canEdit || activeEntry.draft === activeEntry.lastSavedContent;
  exportImageButton.disabled = activeEntry.versions.length === 0;
  exportDayMarkdownButton.disabled = activeEntry.versions.length === 0;
  exportAllMarkdownButton.disabled = !state.entries.some((entry) => entry.versions.length > 0);

  meter.innerHTML = `
    <div class="meter-label"><strong>${activeStats.total_units}</strong><span>/300</span></div>
    <div class="meter-track"><span style="width: ${progress * 100}%"></span></div>
  `;

  statsRow.innerHTML = `
    <div><strong>${activeStats.punctuation_units}</strong><span>标点</span></div>
    <div><strong>${activeStats.han_units}</strong><span>汉字</span></div>
    <div><strong>${activeStats.latin_units + activeStats.number_units}</strong><span>字母/数字</span></div>
  `;

  renderHabitStats();
  renderPracticeTabs(activeEntry);
  renderCalendarList();
  renderTimeline(activeEntry);
  renderReader(activeEntry);
  renderDailySummary(activeEntry);
  renderFeed();
  renderOverview();
}

function loadThemePreference(): ThemePreference {
  return parseThemePreference(localStorage.getItem(themePreferenceKey));
}

function parseThemePreference(value: string | null): ThemePreference {
  if (value === "light" || value === "dark") {
    return value;
  }

  return "auto";
}

function applyThemePreference(): void {
  const resolvedTheme = themePreference === "auto" ? (colorSchemeQuery.matches ? "dark" : "light") : themePreference;
  document.body.classList.toggle("theme-dark", resolvedTheme === "dark");
  document.documentElement.style.colorScheme = resolvedTheme;
  themeButtons.forEach((button) => {
    const isActive = button.dataset.theme === themePreference;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-checked", String(isActive));
  });
}

function closeExportMenu(): void {
  exportMenu.classList.add("hidden");
  exportButton.setAttribute("aria-expanded", "false");
}

function formatThemePreference(value: ThemePreference): string {
  if (value === "light") {
    return "日间";
  }

  if (value === "dark") {
    return "夜间";
  }

  return "自动";
}

function showThemeHint(label: string): void {
  themeHint.textContent = `已切换为${label}`;
  themeHint.classList.remove("hidden");

  if (themeHintTimer !== null) {
    window.clearTimeout(themeHintTimer);
  }

  themeHintTimer = window.setTimeout(() => {
    themeHint.classList.add("hidden");
    themeHintTimer = null;
  }, 1200);
}

function showStorageNoticeIfNeeded(): void {
  if (localStorage.getItem(storageNoticeKey) === "true") {
    return;
  }

  storageNotice.classList.remove("hidden");
}

function showImportConfirm(): void {
  importStatus.classList.add("hidden");
  importStatus.textContent = "";
  importConfirmButton.disabled = false;
  importConfirm.classList.remove("hidden");
}

function renderHabitStats(): void {
  const stats = getHabitStats();
  const articleCount = getWrittenEntries().length;
  entryCount.textContent = String(stats.writtenDays);
  habitStats.innerHTML = `
    <div><strong>${stats.writtenDays} / ${writingYearGoalDays}</strong><span>写作天数</span></div>
    <div><strong>${articleCount}</strong><span>文字篇数</span></div>
    <div><strong>${stats.absentDays}</strong><span>缺席天数</span></div>
    <div><strong>${stats.currentStreak}</strong><span>当前连击</span></div>
    <div><strong>${stats.maxStreak}</strong><span>最大连击</span></div>
  `;
}

function renderPracticeTabs(activeEntry: DailyEntry): void {
  const entries = getEntriesForDate(activeEntry.date_key);
  practiceTabs.innerHTML = entries
    .map((entry, index) => {
      const finalVersion = getFinalVersion(entry);
      const active = entry.entry_id === activeEntry.entry_id ? " active" : "";
      const savedMark = finalVersion ? `${getTokenStats(finalVersion.content).total_units}/300` : "草稿";
      return `
        <button class="practice-tab${active}" data-entry-id="${entry.entry_id}" type="button">
          <span>${getPracticeLabel(entry, entries, index)}</span>
          <strong>${savedMark}</strong>
        </button>
      `;
    })
    .join("");

  practiceTabs.querySelectorAll<HTMLButtonElement>(".practice-tab[data-entry-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state = switchEntry(state, button.dataset.entryId ?? state.active_entry_id);
      selectedVersionId = getActiveEntry(state).current_version_id;
      detailMode = "writing";
      historyEditUnlockedEntryId = null;
      persistState(state);
      render();
    });
  });
}

function renderCalendarList(): void {
  const rows = getCalendarRows();
  const active = getActiveEntry(state);

  calendarList.innerHTML = rows
    .map((row) => {
      const entries = getEntriesForDate(row.key);
      const latestEntry = entries[0];
      const writtenEntries = entries.filter((entry) => entry.versions.length > 0);
      const isActive = active.date_key === row.key;
      const versionTotal = entries.reduce((total, entry) => total + entry.versions.length, 0);
      const classes = ["calendar-day", row.written ? "written" : "missed", isActive ? "active" : ""].join(" ");
      const meta = row.written ? `${writtenEntries.length}篇 共${versionTotal}版` : "缺席";
      const disabled = latestEntry ? "" : "disabled";
      return `
        <button class="${classes}" data-entry-id="${latestEntry?.entry_id ?? ""}" type="button" ${disabled}>
          <span>${formatShortDate(row.key)}</span>
          <strong>${meta}</strong>
        </button>
      `;
    })
    .join("");

  calendarList.querySelectorAll<HTMLButtonElement>(".calendar-day[data-entry-id]").forEach((button) => {
    if (!button.dataset.entryId) {
      return;
    }
    button.addEventListener("click", () => {
      state = switchEntry(state, button.dataset.entryId ?? state.active_entry_id);
      selectedVersionId = getActiveEntry(state).current_version_id;
      detailMode = "writing";
      historyEditUnlockedEntryId = null;
      view = "write";
      persistState(state);
      render();
    });
  });
}

function renderTimeline(entry: DailyEntry): void {
  versionCount.textContent = String(entry.versions.length);
  if (entry.versions.length === 0) {
    timeline.innerHTML = `<p class="empty">保存今天的初稿后，版本时间线会出现在这里。</p>`;
    return;
  }

  timeline.innerHTML = [
    `<button class="version-item ${detailMode === "writing" ? "active" : ""}" data-mode="writing" type="button">
      <span class="version-index">Now</span>
      <span class="version-time">${formatShortDate(entry.date_key)}</span>
      <span class="version-stats">当前草稿</span>
    </button>`,
    ...entry.versions.map((version, index) => {
      const versionDiff = getVersionDiff(entry, index);
      const inserted = versionDiff.filter((unit) => unit.op === "INSERT").length;
      const deleted = versionDiff.filter((unit) => unit.op === "DELETE").length;
      const active = detailMode === "version" && version.version_id === selectedVersionId ? " active" : "";
      const stats = getTokenStats(version.content);
      const crossDayBadge = isCrossDayVersion(entry, version) ? `<span class="version-badge">跨天</span>` : "";
      return `
        <button class="version-item${active}" data-version-id="${version.version_id}" type="button">
          <span class="version-index">V${index + 1}</span>
          <span class="version-time">${formatDateTime(version.created_at)} ${crossDayBadge}</span>
          <span class="version-stats">${stats.total_units}/300 · ${renderInlineDelta(inserted, deleted)}</span>
        </button>
      `;
    })
  ].join("");

  timeline.querySelectorAll<HTMLButtonElement>(".version-item").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.mode === "writing") {
        detailMode = "writing";
      } else {
        selectedVersionId = button.dataset.versionId ?? selectedVersionId;
        detailMode = "version";
      }
      view = "write";
      render();
    });
  });
}

function renderReader(entry: DailyEntry): void {
  const selected = getSelectedVersion(entry);
  if (!selected) {
    reader.innerHTML = "";
    return;
  }

  const selectedIndex = entry.versions.findIndex((version) => version.version_id === selected.version_id);
  const visibleUnits = getVersionDiff(entry, selectedIndex).filter((unit) => unit.op !== "DELETE");
  reader.innerHTML = `
    <div class="reader-meta">
      <span>${selected.is_initial ? "初始版本" : "相邻版本 Diff"}</span>
      <span>${formatDateTime(selected.created_at)}</span>
    </div>
    <div class="reader-content">${renderDiffUnits(visibleUnits)}</div>
  `;
}

function renderDailySummary(entry: DailyEntry): void {
  const first = entry.versions[0];
  const last = entry.versions.at(-1);

  if (!first || !last) {
    diffSummary.innerHTML = `<p class="empty">保存一个版本后生成初版-终版差异。</p>`;
    return;
  }

  const summary = summarizeDiff(first.content, last.content);
  diffSummary.innerHTML = renderSummaryChips(summary, entry.versions.length);
}

function renderFeed(): void {
  const stats = getHabitStats();
  feedRange.textContent = stats.firstDay ? `${stats.firstDay} 至 ${todayKey()}` : "尚无记录";
  const writtenEntries = getWrittenEntries();

  if (writtenEntries.length === 0) {
    feedList.innerHTML = `<p class="empty">保存第一个每日版本后，这里会变成你的总阅读流。</p>`;
    return;
  }

  feedList.innerHTML = writtenEntries
    .map((entry) => {
      const last = getFinalVersion(entry);
      if (!last) {
        return "";
      }
      const sameDayEntries = getEntriesForDate(entry.date_key);
      const label = getPracticeLabel(entry, sameDayEntries);
      const crossDayBadge = isCrossDayVersion(entry, last) ? `<span class="feed-badge">跨天版本</span>` : "";
      return `
        <article class="feed-card">
          <header>
            <div class="feed-title-line">
              <button class="feed-date" data-entry-id="${entry.entry_id}" type="button">${formatDisplayDate(entry.date_key)} · ${label}</button>
              ${crossDayBadge}
            </div>
            <button class="button ghost small export-feed-card" data-entry-id="${entry.entry_id}" type="button">导出卡片</button>
          </header>
          <p>${escapeHtml(last.content) || "空白版本"}</p>
          <footer class="feed-diff">${renderEntrySummaryChips(entry)}</footer>
        </article>
      `;
    })
    .join("");

  feedList.querySelectorAll<HTMLButtonElement>(".feed-date").forEach((button) => {
    button.addEventListener("click", () => {
      state = switchEntry(state, button.dataset.entryId ?? state.active_entry_id);
      selectedVersionId = getActiveEntry(state).current_version_id;
      detailMode = "writing";
      historyEditUnlockedEntryId = null;
      view = "write";
      persistState(state);
      render();
    });
  });

  feedList.querySelectorAll<HTMLButtonElement>(".export-feed-card").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.entries.find((item) => item.entry_id === button.dataset.entryId);
      if (entry) {
        void exportDailyCard(entry);
      }
    });
  });
}

function renderOverview(): void {
  const days = getOverviewDays();
  const writtenDays = days.filter((day) => day.state === "written");
  const elapsedDays = days.filter((day) => day.state !== "future");
  const absentDays = days.filter((day) => day.state === "absent");
  const articleCount = getWrittenEntries().length;
  const versionTotal = writtenDays.reduce((total, day) => total + day.versions, 0);
  const wordTotal = writtenDays.reduce((total, day) => total + day.wordCount, 0);
  const insertedTotal = writtenDays.reduce((total, day) => total + day.inserted, 0);
  const deletedTotal = writtenDays.reduce((total, day) => total + day.deleted, 0);
  const averageDailyWords = writtenDays.length ? Math.round(wordTotal / writtenDays.length) : 0;
  const averageArticleWords = articleCount ? Math.round(wordTotal / articleCount) : 0;
  const averageVersions = writtenDays.length ? (versionTotal / writtenDays.length).toFixed(1) : "0.0";
  const bestChurnDay = [...writtenDays].sort((left, right) => right.churn - left.churn)[0];
  const intensityMax = Math.max(...days.map((day) => day.churn), 1);
  const wordMax = Math.max(...days.map((day) => day.wordCount), 300, 1);
  const versionMax = Math.max(...days.map((day) => day.versions), 1);

  overviewRange.textContent = `${days[0]?.key ?? todayKey()} 至 ${days.at(-1)?.key ?? todayKey()}`;
  overviewSummary.innerHTML = `
    <div><strong>${writtenDays.length}</strong><span>写作天数</span></div>
    <div><strong>${articleCount}</strong><span>文字篇数</span></div>
    <div><strong>${elapsedDays.length}</strong><span>已推进天数</span></div>
    <div><strong>${absentDays.length}</strong><span>缺席天数</span></div>
    <div><strong>${versionTotal}</strong><span>累计版本</span></div>
    <div><strong>${averageDailyWords}</strong><span>日均总字数</span></div>
    <div><strong>${averageArticleWords}</strong><span>篇均终稿字数</span></div>
    <div><strong>${averageVersions}</strong><span>日均版本</span></div>
  `;
  overviewGridMeta.textContent = `${writtenDays.length}/${writingYearGoalDays} 天 · 修改量 +${insertedTotal} -${deletedTotal}`;
  overviewYearGrid.innerHTML = days
    .map((day, index) => {
      const level = getOverviewLevel(day, intensityMax);
      const title = `${day.key} · ${formatOverviewDayTitle(day)}`;
      return `<span class="year-cell ${day.state} level-${level}" title="${title}" aria-label="${title}" data-index="${index}"></span>`;
    })
    .join("");

  overviewBars.innerHTML = [
    renderOverviewBarTrack("日总字数", elapsedDays, wordMax, (day) => day.wordCount, (day) => `${day.wordCount}字 · ${day.articles}篇`),
    renderOverviewBarTrack("日版本", elapsedDays, versionMax, (day) => day.versions, (day) => `${day.versions}版 · ${day.articles}篇`),
    renderOverviewBarTrack("日修改量", elapsedDays, intensityMax, (day) => day.churn, (day) => `+${day.inserted} -${day.deleted}`),
    `<div class="overview-callout">
      <strong>修改量最高</strong>
      <span>${bestChurnDay ? `${formatShortDate(bestChurnDay.key)} · +${bestChurnDay.inserted} -${bestChurnDay.deleted}` : "保存版本后，这里会出现当日修改量。"}</span>
    </div>`
  ].join("");
}

function renderOverviewBarTrack(
  label: string,
  days: OverviewDay[],
  maxValue: number,
  getValue: (day: OverviewDay) => number,
  getTitle: (day: OverviewDay) => string
): string {
  return `
    <div class="overview-track">
      <span>${label}</span>
      <div style="--day-count: ${Math.max(days.length, 1)}">
        ${days
          .map((day) => {
            const value = getValue(day);
            const height = day.state === "future" || value === 0 ? 2 : Math.max(4, Math.round((value / maxValue) * 28));
            const title = `${day.key} · ${getTitle(day)}`;
            return `<i class="${day.state}" style="height: ${height}px" title="${title}" aria-label="${title}"></i>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

async function exportOverviewCard(): Promise<void> {
  await document.fonts.ready;
  const days = getOverviewDays();
  const writtenDays = days.filter((day) => day.state === "written");
  const elapsedDays = days.filter((day) => day.state !== "future");
  const absentDays = days.filter((day) => day.state === "absent");
  const articleCount = getWrittenEntries().length;
  const versionTotal = writtenDays.reduce((total, day) => total + day.versions, 0);
  const wordTotal = writtenDays.reduce((total, day) => total + day.wordCount, 0);
  const insertedTotal = writtenDays.reduce((total, day) => total + day.inserted, 0);
  const deletedTotal = writtenDays.reduce((total, day) => total + day.deleted, 0);
  const averageDailyWords = writtenDays.length ? Math.round(wordTotal / writtenDays.length) : 0;
  const averageArticleWords = articleCount ? Math.round(wordTotal / articleCount) : 0;
  const averageVersions = writtenDays.length ? (versionTotal / writtenDays.length).toFixed(1) : "0.0";
  const bestChurnDay = [...writtenDays].sort((left, right) => right.churn - left.churn)[0];
  const intensityMax = Math.max(...days.map((day) => day.churn), 1);
  const wordMax = Math.max(...elapsedDays.map((day) => day.wordCount), 300, 1);
  const versionMax = Math.max(...elapsedDays.map((day) => day.versions), 1);
  const scale = 2;
  const width = 1280;
  const height = 1040;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.scale(scale, scale);
  ctx.fillStyle = "#f7f4ed";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1c1c1c";
  ctx.font = cardFont(38);
  ctx.fillText("逐字总览", 72, 88);
  ctx.fillStyle = "rgba(28,28,28,0.56)";
  ctx.font = cardFont(24);
  ctx.fillText(`${days[0]?.key ?? todayKey()} 至 ${days.at(-1)?.key ?? todayKey()}`, 72, 126);
  ctx.fillText(appSlogan, 72, 964);

  drawOverviewCardStats(ctx, [
    ["写作天数", String(writtenDays.length)],
    ["文字篇数", String(articleCount)],
    ["已推进天数", String(elapsedDays.length)],
    ["缺席天数", String(absentDays.length)],
    ["累计版本", String(versionTotal)],
    ["日均总字数", String(averageDailyWords)],
    ["篇均终稿字数", String(averageArticleWords)],
    ["日均版本", averageVersions]
  ]);

  ctx.fillStyle = "#1c1c1c";
  ctx.font = cardFont(26);
  ctx.fillText("年度格", 72, 384);
  ctx.fillStyle = "rgba(28,28,28,0.56)";
  ctx.font = cardFont(20);
  ctx.fillText(`${writtenDays.length}/${writingYearGoalDays} 天 · 修改量 +${insertedTotal} -${deletedTotal}`, 176, 384);
  drawOverviewCardGrid(ctx, days, intensityMax, 72, 410);

  ctx.fillStyle = "#1c1c1c";
  ctx.font = cardFont(26);
  ctx.fillText("每日数据", 72, 606);
  ctx.fillStyle = "rgba(28,28,28,0.56)";
  ctx.font = cardFont(20);
  ctx.fillText("按已推进日期展示，不含正文", 194, 606);
  drawOverviewCardTrack(ctx, "日总字数", elapsedDays, wordMax, (day) => day.wordCount, 72, 650);
  drawOverviewCardTrack(ctx, "日版本", elapsedDays, versionMax, (day) => day.versions, 72, 732);
  drawOverviewCardTrack(ctx, "日修改量", elapsedDays, intensityMax, (day) => day.churn, 72, 814);

  drawSoftPill(ctx, 72, 894, 520, 48);
  ctx.fillStyle = "#1c1c1c";
  ctx.font = cardFont(22);
  ctx.fillText("修改量最高", 96, 925);
  ctx.fillStyle = "rgba(28,28,28,0.62)";
  ctx.fillText(bestChurnDay ? `${formatShortDate(bestChurnDay.key)} · +${bestChurnDay.inserted} -${bestChurnDay.deleted}` : "保存版本后显示当日修改量", 228, 925);

  const link = document.createElement("a");
  link.download = `zhuzi-overview-${todayKey()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function exportDayMarkdown(entry: DailyEntry): void {
  const markdown = renderEntryMarkdown(entry);
  downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `逐字-${entry.date_key}-${slugifyPracticeLabel(entry)}.md`);
}

function exportAllMarkdown(): void {
  const writtenEntries = getWrittenEntries();
  const markdown = [`# 逐字`, "", appSlogan, "", `导出时间：${new Date().toISOString()}`, "", ...writtenEntries.map(renderEntryMarkdown)].join("\n");
  downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `逐字-全部-${todayKey()}.md`);
}

async function exportZipBackup(): Promise<void> {
  const zip = new JSZip();
  const writtenEntries = getWrittenEntries();
  const payload = {
    app: appName,
    schema_version: 2,
    exported_at: new Date().toISOString(),
    state,
    preferences: {
      theme: themePreference
    }
  };

  zip.file("zhuzi-data.json", JSON.stringify(payload, null, 2));
  zip.file("markdown/all.md", [`# 逐字`, "", appSlogan, "", `导出时间：${payload.exported_at}`, "", ...writtenEntries.map(renderEntryMarkdown)].join("\n"));

  for (const entry of writtenEntries) {
    zip.file(`markdown/days/${entry.date_key}-${slugifyPracticeLabel(entry)}.md`, renderEntryMarkdown(entry));
  }

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `逐字-备份-${todayKey()}.zip`);
}

async function importZipBackup(file: File): Promise<void> {
  importStatus.classList.add("hidden");
  importStatus.textContent = "";
  importConfirmButton.disabled = true;
  try {
    const zip = await JSZip.loadAsync(file);
    const dataFile = zip.file("zhuzi-data.json") ?? zip.file("char300-lab-data.json");
    if (!dataFile) {
      showImportStatus("没有找到逐字备份数据文件。", "error");
      importConfirmButton.disabled = false;
      return;
    }

    const raw = await dataFile.async("string");
    const parsed = JSON.parse(raw) as { preferences?: { theme?: string }; state?: AppState };
    if (!parsed.state || !Array.isArray(parsed.state.entries) || typeof parsed.state.active_entry_id !== "string") {
      showImportStatus("备份数据格式不正确。", "error");
      importConfirmButton.disabled = false;
      return;
    }

    state = ensureTodayEntry(normalizeState(parsed.state));
    persistState(state);
    if (parsed.preferences?.theme) {
      themePreference = parseThemePreference(parsed.preferences.theme);
      localStorage.setItem(themePreferenceKey, themePreference);
      applyThemePreference();
    }
    pendingImportFile = null;
    selectedVersionId = getActiveEntry(state).current_version_id;
    detailMode = "writing";
    historyEditUnlockedEntryId = null;
    view = "write";
    importConfirm.classList.add("hidden");
    importConfirmButton.disabled = false;
    render();
  } catch {
    showImportStatus("导入失败，请确认 ZIP 文件来自逐字。", "error");
    importConfirmButton.disabled = false;
  }
}

function showImportStatus(message: string, tone: "error" | "info"): void {
  importStatus.textContent = message;
  importStatus.className = `inline-status ${tone}`;
}

function renderEntryMarkdown(entry: DailyEntry): string {
  const first = entry.versions[0];
  const last = entry.versions.at(-1);
  if (!first || !last) {
    return "";
  }

  const summary = summarizeDiff(first.content, last.content);
  const sameDayEntries = getEntriesForDate(entry.date_key);
  const label = getPracticeLabel(entry, sameDayEntries);
  const lines = [
    `## ${entry.date_key} · ${label}`,
    "",
    `${getTokenStats(last.content).total_units}/300`,
    "",
    last.content || "空白版本",
    "",
    `文字 +${textInsertCount(summary)} -${textDeleteCount(summary)} · 标点 +${summary.punctuation.insert} -${summary.punctuation.delete} · 迭代 ${entry.versions.length}`,
    "",
    "### 版本",
    ""
  ];

  entry.versions.forEach((version, index) => {
    const crossDay = isCrossDayVersion(entry, version) ? " · 跨天版本" : "";
    lines.push(`- V${index + 1} · ${formatDateTime(version.created_at)} · ${getTokenStats(version.content).total_units}/300${crossDay}`);
  });

  lines.push("");
  return lines.join("\n");
}

function renderEntrySummaryChips(entry: DailyEntry): string {
  const first = entry.versions[0];
  const last = entry.versions.at(-1);
  if (!first || !last) {
    return "";
  }

  return renderSummaryChips(summarizeDiff(first.content, last.content), entry.versions.length);
}

function renderSummaryChips(summary: ReturnType<typeof summarizeDiff>, iterations: number): string {
  return `
    <span><b>文字</b> ${renderInlineDelta(textInsertCount(summary), textDeleteCount(summary))}</span>
    <span><b>标点</b> ${renderInlineDelta(summary.punctuation.insert, summary.punctuation.delete)}</span>
    <span><b>迭代</b> ${iterations}</span>
  `;
}

function textInsertCount(summary: ReturnType<typeof summarizeDiff>): number {
  return summary.han.insert + summary.latin.insert + summary.number.insert;
}

function textDeleteCount(summary: ReturnType<typeof summarizeDiff>): number {
  return summary.han.delete + summary.latin.delete + summary.number.delete;
}

function renderInlineDelta(inserted: number, deleted: number): string {
  return `<em class="delta-plus">+${inserted}</em> <em class="delta-minus">-${deleted}</em>`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

function getWrittenEntries(): DailyEntry[] {
  return state.entries.filter((entry) => entry.versions.length > 0);
}

function getEntriesForDate(key: string): DailyEntry[] {
  return state.entries
    .filter((entry) => entry.date_key === key)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function getPracticeLabel(entry: DailyEntry, entries = getEntriesForDate(entry.date_key), fallbackIndex?: number): string {
  const chronological = [...entries].sort((left, right) => left.created_at.localeCompare(right.created_at));
  const index = chronological.findIndex((item) => item.entry_id === entry.entry_id);
  if (index >= 0) {
    return `第${index + 1}篇`;
  }

  if (typeof fallbackIndex === "number") {
    return `第${fallbackIndex + 1}篇`;
  }

  return entry.optional_title && entry.optional_title !== entry.date_key ? entry.optional_title : "第1篇";
}

function slugifyPracticeLabel(entry: DailyEntry): string {
  const label = getPracticeLabel(entry);
  return label.replace(/[^\p{Letter}\p{Number}]+/gu, "-");
}

function getHabitStats(): {
  firstDay: string;
  writtenDays: number;
  absentDays: number;
  currentStreak: number;
  maxStreak: number;
} {
  const writtenKeys = new Set(state.entries.filter((entry) => entry.versions.length > 0).map((entry) => entry.date_key));
  const firstDay = [...writtenKeys].sort()[0] ?? "";
  if (!firstDay) {
    return { firstDay, writtenDays: 0, absentDays: 0, currentStreak: 0, maxStreak: 0 };
  }

  const keys = enumerateDays(firstDay, todayKey());
  let currentRun = 0;
  let maxStreak = 0;
  let trailingRun = 0;

  for (const key of keys) {
    if (writtenKeys.has(key)) {
      currentRun += 1;
      maxStreak = Math.max(maxStreak, currentRun);
    } else {
      currentRun = 0;
    }
  }

  for (const key of [...keys].reverse()) {
    if (!writtenKeys.has(key)) {
      break;
    }
    trailingRun += 1;
  }

  return {
    firstDay,
    writtenDays: writtenKeys.size,
    absentDays: keys.filter((key) => !writtenKeys.has(key)).length,
    currentStreak: trailingRun,
    maxStreak
  };
}

function getOverviewDays(): OverviewDay[] {
  const writtenKeys = new Set(state.entries.filter((entry) => entry.versions.length > 0).map((entry) => entry.date_key));
  const firstDay = [...writtenKeys].sort()[0] ?? state.entries.map((entry) => entry.date_key).sort()[0] ?? todayKey();
  const finalDay = toLocalDateKey(addDays(parseDateKey(firstDay), writingYearGoalDays - 1));
  const today = todayKey();

  return enumerateDays(firstDay, finalDay).map((key) => {
    if (!writtenKeys.has(key)) {
      return {
        key,
        state: key <= today ? "absent" : "future",
        articles: 0,
        wordCount: 0,
        versions: 0,
        inserted: 0,
        deleted: 0,
        churn: 0,
        compression: null
      };
    }

    return getOverviewDayMetrics(key);
  });
}

function getOverviewDayMetrics(key: string): OverviewDay {
  const entries = getEntriesForDate(key).filter((entry) => entry.versions.length > 0);
  let wordCount = 0;
  let versions = 0;
  let inserted = 0;
  let deleted = 0;
  let firstUnits = 0;
  let finalUnits = 0;

  for (const entry of entries) {
    const first = entry.versions[0];
    const last = entry.versions.at(-1);
    if (!first || !last) {
      continue;
    }

    const summary = summarizeDiff(first.content, last.content);
    const firstStats = getTokenStats(first.content);
    const finalStats = getTokenStats(last.content);
    wordCount += finalStats.total_units;
    versions += entry.versions.length;
    inserted += textInsertCount(summary) + summary.punctuation.insert;
    deleted += textDeleteCount(summary) + summary.punctuation.delete;
    firstUnits += firstStats.total_units;
    finalUnits += finalStats.total_units;
  }

  return {
    key,
    state: "written",
    articles: entries.length,
    wordCount,
    versions,
    inserted,
    deleted,
    churn: inserted + deleted,
    compression: firstUnits > 0 ? finalUnits / firstUnits : null
  };
}

function getOverviewLevel(day: OverviewDay, maxChurn: number): number {
  if (day.state !== "written") {
    return 0;
  }

  const expectedWords = Math.max(day.articles, 1) * 300;
  const score = Math.max(day.wordCount / expectedWords, day.churn / maxChurn, day.versions / Math.max(day.articles * 3, 1));
  return Math.min(4, Math.max(1, Math.ceil(score * 4)));
}

function formatOverviewDayTitle(day: OverviewDay): string {
  if (day.state === "future") {
    return "预期格";
  }

  if (day.state === "absent") {
    return "缺席";
  }

  const compression = day.compression === null ? "—" : `${Math.round(day.compression * 100)}%`;
  return `${day.articles}篇 · 共${day.wordCount}字 · ${day.versions}版 · +${day.inserted} -${day.deleted} · 压缩率 ${compression}`;
}

function getCalendarRows(): Array<{ key: string; written: boolean }> {
  const writtenKeys = new Set(state.entries.filter((entry) => entry.versions.length > 0).map((entry) => entry.date_key));
  const firstEntryDay = state.entries.map((entry) => entry.date_key).sort()[0] ?? todayKey();
  return enumerateDays(firstEntryDay, todayKey())
    .reverse()
    .map((key) => ({ key, written: writtenKeys.has(key) }));
}

function enumerateDays(startKey: string, endKey: string): string[] {
  const days: string[] = [];
  const cursor = parseDateKey(startKey);
  const end = parseDateKey(endKey);

  while (cursor.getTime() <= end.getTime()) {
    days.push(toLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderDiffUnits(units: DiffUnit[]): string {
  if (units.length === 0) {
    return `<span class="muted">空白版本</span>`;
  }

  return units
    .map((unit) => {
      const value = escapeHtml(unit.token.value);
      return unit.op === "INSERT" ? `<mark>${value}</mark>` : `<span>${value}</span>`;
    })
    .join("");
}

function getSelectedVersion(entry: DailyEntry): Version | null {
  return entry.versions.find((version) => version.version_id === selectedVersionId) ?? entry.versions.at(-1) ?? null;
}

function isTodayEntry(entry: DailyEntry): boolean {
  return entry.date_key === todayKey();
}

function canEditActiveEntry(): boolean {
  const activeEntry = getActiveEntry(state);
  return detailMode === "writing" && (isTodayEntry(activeEntry) || historyEditUnlockedEntryId === activeEntry.entry_id);
}

function canDeleteActivePractice(entry = getActiveEntry(state)): boolean {
  return entry.versions.length === 0 && getEntriesForDate(entry.date_key).length > 1;
}

function isCrossDayVersion(entry: DailyEntry, version: Version): boolean {
  return toLocalDateKey(new Date(version.created_at)) !== entry.date_key;
}

function getVersionDiff(entry: DailyEntry, versionIndex: number): DiffUnit[] {
  const version = entry.versions[versionIndex];
  if (!version) {
    return [];
  }

  const previous = entry.versions[versionIndex - 1];
  return diffTexts(previous?.content ?? "", version.content);
}

async function exportDailyCard(entry: DailyEntry): Promise<void> {
  const first = entry.versions[0];
  const last = entry.versions.at(-1);
  if (!first || !last) {
    return;
  }

  await document.fonts.ready;
  const summary = summarizeDiff(first.content, last.content);
  const canvas = document.createElement("canvas");
  const scale = 2;
  const cardWidth = 1040;
  const cardX = 64;
  const cardY = 56;
  const cardInnerX = 112;
  const cardW = cardWidth - cardX * 2;
  const contentStartY = 230;
  const lineHeight = 48;
  const lastStats = getTokenStats(last.content);
  const meterText = `${lastStats.total_units} / 300`;
  const achievementText = renderShareAchievementText();
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  if (!measureCtx) {
    return;
  }

  measureCtx.font = cardFont(30);
  const visibleLines = wrapTextPreservingBreaks(measureCtx, last.content || "空白版本", cardW - 96);
  const contentEndY = contentStartY + Math.max(visibleLines.length - 1, 0) * lineHeight;
  const chipY = contentEndY + 58;
  const chipLayout = layoutCardChips(
    [
      createDiffCardChip(measureCtx, "文字", textInsertCount(summary), textDeleteCount(summary)),
      createDiffCardChip(measureCtx, "标点", summary.punctuation.insert, summary.punctuation.delete),
      createPlainCardChip(measureCtx, "迭代", String(entry.versions.length))
    ],
    cardInnerX,
    chipY,
    cardW - 96
  );
  const signatureY = chipY + chipLayout.height + 50;
  const cardH = Math.max(620, signatureY + 98 - cardY);
  const cardHeight = cardY + cardH + 56;
  canvas.width = cardWidth * scale;
  canvas.height = cardHeight * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cardWidth, cardHeight);
  ctx.save();
  ctx.shadowColor = "rgba(28,28,28,0.12)";
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 18;
  roundRect(ctx, cardX, cardY, cardW, cardH, 30);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(28,28,28,0.08)";
  ctx.lineWidth = 2;
  roundRect(ctx, cardX, cardY, cardW, cardH, 30);
  ctx.stroke();

  ctx.fillStyle = "#1c1c1c";
  ctx.font = cardFont(34);
  ctx.fillText(`${formatDisplayDate(entry.date_key)} · ${getPracticeLabel(entry, getEntriesForDate(entry.date_key))}`, cardInnerX, 134);
  ctx.font = cardFont(28);
  const meterPaddingX = 24;
  const meterWidth = Math.ceil(ctx.measureText(meterText).width + meterPaddingX * 2);
  const meterX = cardX + cardW - 48 - meterWidth;
  drawSoftPill(ctx, meterX, 100, meterWidth, 44);
  ctx.fillStyle = "rgba(28,28,28,0.72)";
  ctx.fillText(meterText, meterX + meterPaddingX, 130);

  ctx.fillStyle = "#1c1c1c";
  ctx.font = cardFont(30);
  visibleLines.forEach((line, index) => {
    ctx.fillText(line, cardInnerX, contentStartY + index * lineHeight);
  });

  chipLayout.chips.forEach((chip) => drawCardChip(ctx, chip));

  ctx.fillStyle = "#1c1c1c";
  ctx.font = cardFont(26);
  ctx.fillText(achievementText, cardInnerX, signatureY);
  ctx.fillStyle = "rgba(28,28,28,0.52)";
  ctx.font = cardFont(24);
  ctx.fillText(`${appName}，${appSlogan}`, cardInnerX, signatureY + 38);

  const link = document.createElement("a");
  link.download = `char300-daily-card-${entry.date_key}-${slugifyPracticeLabel(entry)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function cardFont(size: number): string {
  return `${size}px "LXGW WenKai", ui-sans-serif, system-ui`;
}

function renderShareAchievementText(): string {
  const stats = getHabitStats();
  const articleCount = getWrittenEntries().length;
  const versionTotal = state.entries.reduce((total, entry) => total + entry.versions.length, 0);
  return `累计${stats.writtenDays}天写作，${articleCount}篇文字，${versionTotal}个版本`;
}

function drawSoftPill(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  roundRect(ctx, x, y, width, height, 18);
  ctx.fillStyle = "rgba(28,28,28,0.035)";
  ctx.fill();
  ctx.strokeStyle = "#eceae4";
  ctx.stroke();
}

function createDiffCardChip(ctx: CanvasRenderingContext2D, label: string, inserted: number, deleted: number): CardChip {
  ctx.font = cardFont(24);
  const labelWidth = ctx.measureText(label).width;
  ctx.font = cardFont(28);
  const insertedWidth = ctx.measureText(`+${inserted}`).width;
  const deletedWidth = ctx.measureText(`-${deleted}`).width;
  const width = Math.ceil(40 + labelWidth + 18 + insertedWidth + 16 + deletedWidth + 20);
  return { kind: "diff", label, inserted, deleted, width: Math.max(202, width) };
}

function createPlainCardChip(ctx: CanvasRenderingContext2D, label: string, value: string): CardChip {
  ctx.font = cardFont(24);
  const labelWidth = ctx.measureText(label).width;
  ctx.font = cardFont(28);
  const valueWidth = ctx.measureText(value).width;
  const width = Math.ceil(40 + labelWidth + 18 + valueWidth + 20);
  return { kind: "plain", label, value, width: Math.max(138, width) };
}

function layoutCardChips(
  chips: CardChip[],
  startX: number,
  startY: number,
  maxWidth: number
): { chips: PositionedCardChip[]; height: number } {
  const gapX = 24;
  const gapY = 18;
  const chipHeight = 54;
  const positioned: PositionedCardChip[] = [];
  let x = startX;
  let y = startY;

  for (const chip of chips) {
    const width = Math.min(chip.width, maxWidth);
    if (x > startX && x + width > startX + maxWidth) {
      x = startX;
      y += chipHeight + gapY;
    }

    positioned.push({ ...chip, width, x, y });
    x += width + gapX;
  }

  return {
    chips: positioned,
    height: positioned.length === 0 ? 0 : positioned.at(-1)!.y - startY + chipHeight
  };
}

function drawCardChip(ctx: CanvasRenderingContext2D, chip: PositionedCardChip): void {
  drawSoftPill(ctx, chip.x, chip.y, chip.width, 54);
  ctx.font = cardFont(24);
  ctx.fillStyle = "#5f5f5d";
  ctx.fillText(chip.label, chip.x + 20, chip.y + 35);
  const valueX = chip.x + 20 + ctx.measureText(chip.label).width + 18;
  ctx.font = cardFont(28);
  if (chip.kind === "plain") {
    ctx.fillStyle = "#1c1c1c";
    ctx.fillText(chip.value, valueX, chip.y + 36);
    return;
  }

  const insertedText = `+${chip.inserted}`;
  ctx.fillStyle = "#287a46";
  ctx.fillText(insertedText, valueX, chip.y + 36);
  ctx.fillStyle = "#9b3428";
  ctx.fillText(`-${chip.deleted}`, valueX + ctx.measureText(insertedText).width + 16, chip.y + 36);
}

function drawOverviewCardStats(ctx: CanvasRenderingContext2D, stats: Array<[string, string]>): void {
  const startX = 72;
  const startY = 164;
  const gap = 16;
  const itemW = 260;
  const itemH = 84;

  stats.forEach(([label, value], index) => {
    const x = startX + (index % 4) * (itemW + gap);
    const y = startY + Math.floor(index / 4) * (itemH + gap);
    drawSoftPill(ctx, x, y, itemW, itemH);
    ctx.fillStyle = "#1c1c1c";
    ctx.font = cardFont(28);
    ctx.fillText(value, x + 18, y + 36);
    ctx.fillStyle = "rgba(28,28,28,0.56)";
    ctx.font = cardFont(19);
    ctx.fillText(label, x + 18, y + 64);
  });
}

function drawOverviewCardGrid(ctx: CanvasRenderingContext2D, days: OverviewDay[], maxChurn: number, x: number, y: number): void {
  const cell = 12;
  const gap = 4;
  days.forEach((day, index) => {
    const column = Math.floor(index / 7);
    const row = index % 7;
    ctx.fillStyle = overviewCellColor(day, getOverviewLevel(day, maxChurn));
    roundRect(ctx, x + column * (cell + gap), y + row * (cell + gap), cell, cell, 3);
    ctx.fill();
  });
}

function drawOverviewCardTrack(
  ctx: CanvasRenderingContext2D,
  label: string,
  days: OverviewDay[],
  maxValue: number,
  getValue: (day: OverviewDay) => number,
  x: number,
  y: number
): void {
  const labelW = 118;
  const trackW = 1040;
  const barGap = 2;
  const count = Math.max(days.length, 1);
  const barW = Math.max(5, Math.min(14, (trackW - (count - 1) * barGap) / count));
  ctx.fillStyle = "rgba(28,28,28,0.56)";
  ctx.font = cardFont(20);
  ctx.fillText(label, x, y + 38);
  ctx.strokeStyle = "rgba(28,28,28,0.12)";
  ctx.beginPath();
  ctx.moveTo(x + labelW, y + 48);
  ctx.lineTo(x + labelW + trackW, y + 48);
  ctx.stroke();

  days.forEach((day, index) => {
    const value = getValue(day);
    const barH = day.state === "future" || value === 0 ? 3 : Math.max(6, Math.round((value / maxValue) * 42));
    ctx.fillStyle = day.state === "written" ? "rgba(28,28,28,0.72)" : "rgba(28,28,28,0.18)";
    roundRect(ctx, x + labelW + index * (barW + barGap), y + 48 - barH, barW, barH, 2);
    ctx.fill();
  });
}

function overviewCellColor(day: OverviewDay, level: number): string {
  if (day.state === "future") {
    return "rgba(28,28,28,0.035)";
  }

  if (day.state === "absent") {
    return "rgba(28,28,28,0.08)";
  }

  return ["rgba(40,122,70,0.22)", "rgba(40,122,70,0.38)", "rgba(40,122,70,0.58)", "#287a46"][level - 1] ?? "#287a46";
}

function wrapTextPreservingBreaks(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }

    let current = "";
    for (const token of tokenize(paragraph)) {
      const next = current + token.value;
      if (ctx.measureText(next).width > width && current) {
        lines.push(current);
        current = token.value;
      } else {
        current = next;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function formatDisplayDate(key: string): string {
  const date = parseDateKey(key);
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日  ${weekday}`;
}

function formatShortDate(key: string): string {
  const [, month, day] = key.split("-");
  return `${month}/${day}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}
