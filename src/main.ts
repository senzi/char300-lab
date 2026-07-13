import "./styles.css";
import JSZip from "jszip";
import logoDarkUrl from "./assets/logo-dark.svg";
import logoUrl from "./assets/logo.svg";
import shareLogoDarkUrl from "./assets/share-logo-dark.svg";
import shareLogoUrl from "./assets/share-logo.svg";
import { addBackupJsonFiles, createAnalysisBackupPayload, generateCompressedZip, readBackupPayload } from "./backup";
import { alignDiffToContent, summarizeDiff } from "./diff";
import { getTokenStats } from "./tokenizer";
import type { AppState, DailyEntry, DiffUnit, Version } from "./types";
import { getOverviewExportBarLayout, getOverviewMonthMarkers, getRevisionTotals, overviewExportTrackWidth } from "./overview-layout";
import { dailyShareLineHeight, getDailyShareLayout } from "./share-card-layout";
import { layoutShareText, type ShareTextLine } from "./share-text-layout";
import { dateKeyInRange, getWritingYearRange, getWritingYears, writingYearDays, type WritingYear } from "./writing-years";
import { canOfferOpfsUpgrade, createTodayPractice, dismissOpfsUpgradePrompt, ensureTodayEntry, getActiveEntry, getFinalVersion, getStorageStatus, hydrateOpfsStorage, isOpfsStorageActive, loadState, parseImportedState, persistDraftState, persistState, pruneHistoricalEmptyEntries, saveVersion, shouldShowOpfsUpgradePrompt, subscribeStorageStatus, switchEntry, todayKey, updateDraft, upgradeToOpfsStorage } from "./store";

const appName = "逐字";
const appSlogan = "让每一次修改都被看见";
const appUrl = "rewrite.closeai.moe";
const storageNoticeKey = "zhuzi-storage-notice-dismissed-v1";
const changelogSeenVersionKey = "zhuzi-changelog-seen-version";
const themePreferenceKey = "zhuzi-theme-preference-v1";
const writingYearGoalDays = writingYearDays;
const writingMilestones = [3, 7, 10, 14, 21, 30, 45, 60, 75, 90, 100, 120, 150, 180, 210, 240, 270, 300, 330, 365];
const changelog: ChangelogEntry[] = [
  {
    version: "0.3.1",
    date: "2026-07-13",
    title: "分享图与写作总览",
    items: [
      "重构文章分享图与总览图，统一明暗主题、品牌信息和中文文件名。",
      "优化写作总览的统计口径、时间坐标和最近30天数据展示。",
      "改进中文分享图换行，避免标点符号单独成行。"
    ]
  },
  {
    version: "0.3.0",
    date: "2026-07-13",
    title: "分析导出与版本阅读",
    items: [
      "新增轻量分析 JSON 和可复制的 LLM 分析提示词，完整 ZIP 同时保留完整数据与分析文件。",
      "优化导出菜单与版本阅读，保留段落换行并改进新增内容高亮。",
      "继续兼容旧版 ZIP/JSON，轻量分析 JSON 也可导入恢复。"
    ]
  },
  {
    version: "0.2.6",
    date: "2026-07-11",
    title: "体验与稳定性优化",
    items: ["优化长期写作档案的稳定性与使用体验。"]
  },
  {
    version: "0.2.5",
    date: "2026-07-09",
    title: "体验细节优化",
    items: [
      "微调写作、阅读流和总览里的若干交互与排版细节。",
      "优化多篇练习、版本信息和移动端展示的使用体验。"
    ]
  },
  {
    version: "0.2.4",
    date: "2026-07-07",
    title: "JSON 备份",
    items: [
      "新增 JSON 导出，并提供说明与复制功能。",
      "支持 ZIP/JSON 导入，旧备份继续兼容。"
    ]
  },
  {
    version: "0.2.3",
    date: "2026-07-06",
    title: "体验细节优化",
    items: [
      "优化夜间模式下的标识与分享图片表现。",
      "调整总览分享图版式与留白。"
    ]
  },
  {
    version: "0.2.2",
    date: "2026-07-06",
    title: "离线可用",
    items: [
      "新增 PWA 离线支持，首次在线打开后可在断网时继续写作。",
      "缓存应用资源、字体样式和已加载字体分片，后续版本上线后会自动接管并刷新。"
    ]
  },
  {
    version: "0.2.1",
    date: "2026-07-06",
    title: "文案与分享卡片优化",
    items: [
      "年度目标改为“先坚持一年”，并按已写天数提示下一站。",
      "文章分享卡片底部新增“逐字”文案和访问地址。"
    ]
  },
  {
    version: "0.2.0",
    date: "2026-07-06",
    title: "本地存储升级",
    items: [
      "新增 OPFS 本地存储，支持更大的写作档案。",
      "升级前会自动下载完整数据 ZIP 备份。",
      "旧版 ZIP 导入会继续兼容。"
    ]
  },
  {
    version: "0.1.1",
    date: "2026-07-06",
    title: "夜间模式与总览视图",
    items: [
      "新增夜间模式切换，支持跟随系统、日间、夜间。",
      "新增总览视图，展示年度格、写作天数、缺席天数和每日数据。"
    ]
  }
];

const analysisPrompt = `你是一名写作行为分析助手。你将收到“逐字”应用导出的轻量分析 JSON，其中包含多篇练习及其历次版本文本。

分析数据时请遵守以下规则：

* 每个 state.entries 项代表一篇练习；忽略没有保存版本的空练习。
* 在同一篇练习内，按 versions[].created_at 的时间顺序比较相邻版本。
* 以 versions[].content 的完整文本为依据；diff_summary 只用于辅助核对增删趋势，不能代替实际文本比较。
* 只把跨多篇练习反复出现的现象概括为稳定习惯。证据不足时请明确说明，不要用单篇或单次修改推断长期倾向。

请分析用户稳定的修改习惯与写作风格，重点关注：

* 更倾向于删减、扩写、替换措辞，还是重组句段。
* 经常删除哪些内容，例如重复解释、背景信息、限定语、情绪表达或冗余结论。
* 经常新增哪些内容，以及新增内容通常用于补充逻辑、明确指代、增加限定、加强论证还是完善收尾。
* 修改主要发生在词语、句子还是段落层面，属于局部润色还是结构调整。
* 是否存在先扩写后压缩、反复调整开头或结尾、持续收紧措辞等稳定模式。

再结合各篇练习的最终版本，总结用户今后写作和修改时可长期关注的方向。不要修改、点评或重新输出某篇既有文章，而应提炼跨多篇文本反复出现的共性问题。

输出：

## 修改习惯与风格

概括用户主要的增、删、替换和结构调整模式。结论应以整体趋势为主，必要时可简要提及版本差异作为依据，但不要展开逐篇案例。

## 流畅度建议

用一至两段说明用户今后写作和修改时应重点关注什么，例如语序、句间衔接、指代、节奏、段落过渡或特定句式的使用。建议应面向未来，具体说明“可以多关注什么”和“应减少什么表达方式”。

## 精炼度建议

用一至两段说明用户今后如何减少重复、无效限定、意义重叠和不必要的解释。建议应面向未来，指出值得保留的表达习惯，以及需要进一步压缩的叙述方式。

所有结论必须依据实际版本变化和终版文本。不要推测用户心理，不要评价观点对错，不要只做字数统计。`;

type View = "write" | "feed" | "overview";
type OverviewScope = number | "all";
type DetailMode = "writing" | "version";
type ThemePreference = "auto" | "light" | "dark";
type ResolvedTheme = "light" | "dark";
type SharePalette = {
  bg: string;
  dailyBg: string;
  cardBg: string;
  contentBg: string;
  text: string;
  textSoft: string;
  muted: string;
  border: string;
  divider: string;
  shadow: string;
  pillBg: string;
  success: string;
  danger: string;
  gridAbsent: string;
  gridFuture: string;
  gridLevels: [string, string, string, string];
  track: string;
  trackMuted: string;
};
type StorageDialogMode = "notice" | "upgrade";
type BackupPayload = {
  app: string;
  schema_version: 2;
  exported_at: string;
  state: AppState;
  preferences: {
    theme: ThemePreference;
  };
};
type ZhuziAutomationApi = {
  version: string;
  getBackupPayload: () => BackupPayload;
  exportJson: () => string;
  getAnalysisPrompt: () => string;
  getSchemaDescription: () => string;
};
type ChangelogEntry = {
  version: string;
  date: string;
  title: string;
  items: string[];
};
type OverviewDay = {
  key: string;
  state: "written" | "absent" | "future";
  articles: number;
  wordCount: number;
  versions: number;
  inserted: number;
  deleted: number;
  churn: number;
  finalToInitialRatio: number | null;
};

declare global {
  interface Window {
    zhuzi?: ZhuziAutomationApi;
  }
}

let state: AppState = ensureTodayEntry(pruneHistoricalEmptyEntries(loadState()));
let view: View = "write";
let detailMode: DetailMode = "writing";
let selectedVersionId: string | null = getActiveEntry(state).current_version_id;
let pendingImportFile: File | null = null;
let historyEditUnlockedEntryId: string | null = null;
let themeHintTimer: number | null = null;
const entrySummaryCache = new Map<string, { signature: string; summary: ReturnType<typeof summarizeDiff> }>();
const crossDayCache = new Map<string, { signature: string; hasCrossDayVersion: boolean }>();
let indexedEntriesReference: DailyEntry[] | null = null;
let entriesByDate = new Map<string, DailyEntry[]>();
const feedPageSize = 40;
let feedVisibleCount = feedPageSize;
let overviewScope: OverviewScope | null = null;
let summaryWarmupGeneration = 0;

function resetDerivedCaches(): void {
  entrySummaryCache.clear();
  crossDayCache.clear();
  indexedEntriesReference = null;
  entriesByDate = new Map();
  summaryWarmupGeneration += 1;
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root missing");
}

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <img class="app-mark" id="appMark" src="${logoUrl}" alt="" aria-hidden="true" />
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
            <div class="export-menu-section">
              <span class="export-menu-label">图片</span>
              <button id="exportImageButton" type="button">分享图片</button>
              <button id="exportOverviewImageButton" type="button">总览图片</button>
            </div>
            <div class="export-menu-section">
              <span class="export-menu-label">Markdown</span>
              <button id="exportDayMarkdownButton" type="button">当日 Markdown</button>
              <button id="exportAllMarkdownButton" type="button">全部 Markdown</button>
            </div>
            <div class="export-menu-section">
              <span class="export-menu-label">数据与恢复</span>
              <button id="exportZipButton" type="button">完整数据 ZIP</button>
              <div class="export-menu-row">
                <button id="exportJsonButton" type="button">轻量分析 JSON</button>
                <button class="icon-help-button" id="jsonSchemaButton" type="button" aria-label="查看分析提示词" title="查看分析提示词">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9.5 9a2.7 2.7 0 0 1 5.1 1.2c0 1.8-2.6 2.1-2.6 4" />
                    <path d="M12 17.5h.01" />
                  </svg>
                </button>
              </div>
              <button class="export-menu-import" id="importZipButton" type="button">从 ZIP/JSON 导入</button>
              <button class="export-menu-upgrade hidden" id="storageUpgradeMenuButton" type="button">升级本地存储</button>
            </div>
          </div>
        </div>
      </div>
      <input class="hidden" id="importZipInput" type="file" accept=".zip,.json,application/zip,application/json" />
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
        <div class="overview-hero-meta">
          <span id="overviewRange"></span>
          <div class="overview-year-switch hidden" id="overviewYearSwitch" role="group" aria-label="写作年范围"></div>
        </div>
      </div>
      <div class="overview-summary" id="overviewSummary"></div>
      <section class="overview-board">
        <div class="overview-section-head">
          <h3 id="overviewGridTitle">年度格</h3>
          <span id="overviewGridMeta"></span>
        </div>
        <div class="overview-year-summary hidden" id="overviewYearSummary"></div>
        <div class="year-grid" id="overviewYearGrid" aria-label="365 天写作矩阵"></div>
        <p class="overview-revision-note" id="overviewRevisionNote"></p>
      </section>
      <section class="overview-board">
        <div class="overview-section-head">
          <h3>每日数据</h3>
          <span id="overviewBarsMeta"></span>
        </div>
        <div class="overview-bars" id="overviewBars"></div>
      </section>
    </section>
    <footer class="app-footer">
      <a href="https://github.com/senzi/char300-lab" target="_blank" rel="noreferrer">Github</a>
      <span aria-hidden="true">|</span>
      <button id="changelogButton" type="button">更新日志</button>
      <span aria-hidden="true">|</span>
      <span>MIT</span>
      <span aria-hidden="true">|</span>
      <span>Vibecoding</span>
      <span aria-hidden="true">|</span>
      <a href="https://weibo.com/1401527553/R71bIwAVs" target="_blank" rel="noreferrer">灵感来源</a>
      <span aria-hidden="true">|</span>
      <span class="storage-health-light storage-health-light-red" id="storageHealthLight" aria-label="localStorage 保底" title="localStorage 保底">
        <span aria-hidden="true"></span>
        <strong id="storageHealthText">localStorage 保底</strong>
      </span>
    </footer>
  </main>
  <div class="notice-backdrop hidden" id="importConfirm" role="dialog" aria-modal="true" aria-labelledby="importConfirmTitle">
    <section class="notice-dialog">
      <p class="panel-kicker">Import</p>
      <h2 id="importConfirmTitle">导入备份会替换当前本地档案</h2>
      <p id="importConfirmText">导入会用 ZIP 或 JSON 备份内容覆盖当前环境中的每日记录。继续前，请确认当前内容已经导出备份。</p>
      <p class="inline-status hidden" id="importStatus"></p>
      <div class="notice-actions">
        <button class="button ghost" id="importCancelButton" type="button">取消</button>
        <button class="button primary" id="importConfirmButton" type="button">确认导入</button>
      </div>
    </section>
  </div>
  <div class="notice-backdrop hidden" id="storageDialog" role="dialog" aria-modal="true" aria-labelledby="storageDialogTitle">
    <section class="notice-dialog">
      <p class="panel-kicker" id="storageDialogKicker">Storage</p>
      <h2 id="storageDialogTitle">本地存储</h2>
      <p id="storageDialogBodyPrimary"></p>
      <p id="storageDialogBodySecondary"></p>
      <p class="inline-status hidden" id="storageDialogStatus"></p>
      <label class="notice-check">
        <input id="storageDialogDontShow" type="checkbox" />
        <span>不再提醒</span>
      </label>
      <div class="notice-actions">
        <button class="button ghost" id="storageDialogSecondaryButton" type="button">先不升级</button>
        <button class="button primary" id="storageDialogPrimaryButton" type="button">我知道了</button>
      </div>
    </section>
  </div>
  <div class="notice-backdrop hidden" id="changelogDialog" role="dialog" aria-modal="true" aria-labelledby="changelogTitle">
    <section class="notice-dialog changelog-dialog">
      <p class="panel-kicker">Changelog</p>
      <h2 id="changelogTitle">“逐字”更新日志</h2>
      <div class="changelog-list" id="changelogList"></div>
      <div class="notice-actions">
        <button class="button primary" id="changelogCloseButton" type="button">知道了</button>
      </div>
    </section>
  </div>
  <div class="notice-backdrop hidden" id="jsonSchemaDialog" role="dialog" aria-modal="true" aria-labelledby="jsonSchemaTitle">
    <section class="notice-dialog json-schema-dialog">
      <p class="panel-kicker">JSON</p>
      <h2 id="jsonSchemaTitle">LLM 分析提示词</h2>
      <pre class="json-schema-content" id="jsonSchemaContent"></pre>
      <p class="inline-status hidden" id="jsonSchemaStatus"></p>
      <div class="notice-actions">
        <button class="button ghost" id="jsonSchemaCopyButton" type="button">复制提示词</button>
        <button class="button primary" id="jsonSchemaCloseButton" type="button">关闭</button>
      </div>
    </section>
  </div>
`;

const dateTitle = getElement<HTMLElement>("dateTitle");
const appMark = getElement<HTMLImageElement>("appMark");
const todayButton = getElement<HTMLButtonElement>("todayButton");
const themeHint = getElement<HTMLElement>("themeHint");
const themeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".theme-icon-button[data-theme]"));
const exportButton = getElement<HTMLButtonElement>("exportButton");
const exportMenu = getElement<HTMLElement>("exportMenu");
const exportImageButton = getElement<HTMLButtonElement>("exportImageButton");
const exportDayMarkdownButton = getElement<HTMLButtonElement>("exportDayMarkdownButton");
const exportAllMarkdownButton = getElement<HTMLButtonElement>("exportAllMarkdownButton");
const exportZipButton = getElement<HTMLButtonElement>("exportZipButton");
const exportJsonButton = getElement<HTMLButtonElement>("exportJsonButton");
const jsonSchemaButton = getElement<HTMLButtonElement>("jsonSchemaButton");
const importZipButton = getElement<HTMLButtonElement>("importZipButton");
const importZipInput = getElement<HTMLInputElement>("importZipInput");
const storageUpgradeMenuButton = getElement<HTMLButtonElement>("storageUpgradeMenuButton");
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
const overviewYearSwitch = getElement<HTMLElement>("overviewYearSwitch");
const exportOverviewImageButton = getElement<HTMLButtonElement>("exportOverviewImageButton");
const overviewSummary = getElement<HTMLElement>("overviewSummary");
const overviewGridMeta = getElement<HTMLElement>("overviewGridMeta");
const overviewGridTitle = getElement<HTMLElement>("overviewGridTitle");
const overviewYearSummary = getElement<HTMLElement>("overviewYearSummary");
const overviewYearGrid = getElement<HTMLElement>("overviewYearGrid");
const overviewRevisionNote = getElement<HTMLElement>("overviewRevisionNote");
const overviewBars = getElement<HTMLElement>("overviewBars");
const overviewBarsMeta = getElement<HTMLElement>("overviewBarsMeta");
const historyEditNotice = getElement<HTMLElement>("historyEditNotice");
const unlockHistoryEditButton = getElement<HTMLButtonElement>("unlockHistoryEditButton");
const practiceTabs = getElement<HTMLElement>("practiceTabs");
const newPracticeButton = getElement<HTMLButtonElement>("newPracticeButton");
const timeline = getElement<HTMLElement>("timeline");
const meter = getElement<HTMLElement>("meter");
const statsRow = getElement<HTMLElement>("statsRow");
const versionCount = getElement<HTMLElement>("versionCount");
const entryCount = getElement<HTMLElement>("entryCount");
const habitStats = getElement<HTMLElement>("habitStats");
const calendarList = getElement<HTMLElement>("calendarList");
const diffSummary = getElement<HTMLElement>("diffSummary");
const changelogButton = getElement<HTMLButtonElement>("changelogButton");
const changelogDialog = getElement<HTMLElement>("changelogDialog");
const changelogList = getElement<HTMLElement>("changelogList");
const changelogCloseButton = getElement<HTMLButtonElement>("changelogCloseButton");
const jsonSchemaDialog = getElement<HTMLElement>("jsonSchemaDialog");
const jsonSchemaContent = getElement<HTMLElement>("jsonSchemaContent");
const jsonSchemaStatus = getElement<HTMLElement>("jsonSchemaStatus");
const jsonSchemaCopyButton = getElement<HTMLButtonElement>("jsonSchemaCopyButton");
const jsonSchemaCloseButton = getElement<HTMLButtonElement>("jsonSchemaCloseButton");
const importConfirm = getElement<HTMLElement>("importConfirm");
const importStatus = getElement<HTMLElement>("importStatus");
const importCancelButton = getElement<HTMLButtonElement>("importCancelButton");
const importConfirmButton = getElement<HTMLButtonElement>("importConfirmButton");
const storageDialog = getElement<HTMLElement>("storageDialog");
const storageDialogKicker = getElement<HTMLElement>("storageDialogKicker");
const storageDialogTitle = getElement<HTMLElement>("storageDialogTitle");
const storageDialogBodyPrimary = getElement<HTMLElement>("storageDialogBodyPrimary");
const storageDialogBodySecondary = getElement<HTMLElement>("storageDialogBodySecondary");
const storageDialogStatus = getElement<HTMLElement>("storageDialogStatus");
const storageDialogDontShow = getElement<HTMLInputElement>("storageDialogDontShow");
const storageDialogSecondaryButton = getElement<HTMLButtonElement>("storageDialogSecondaryButton");
const storageDialogPrimaryButton = getElement<HTMLButtonElement>("storageDialogPrimaryButton");
const storageHealthLight = getElement<HTMLElement>("storageHealthLight");
const storageHealthText = getElement<HTMLElement>("storageHealthText");
const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
let themePreference = loadThemePreference();
let storageDialogMode: StorageDialogMode = "notice";

jsonSchemaContent.textContent = getAnalysisPrompt();
installAutomationApi();
applyThemePreference();
subscribeStorageStatus(refreshStorageHealthLight);

editor.addEventListener("input", () => {
  if (!canEditActiveEntry()) {
    editor.value = getActiveEntry(state).draft;
    return;
  }

  state = updateDraft(state, editor.value);
  persistDraftState(state);
  renderInputState();
});

todayButton.addEventListener("click", () => {
  state = ensureTodayEntry(pruneHistoricalEmptyEntries(state));
  selectedVersionId = getActiveEntry(state).current_version_id;
  detailMode = "writing";
  historyEditUnlockedEntryId = null;
  view = "write";
  persistState(state);
  render();
});

newPracticeButton.addEventListener("click", () => {
  if (hasEmptyTodayPractice()) {
    return;
  }

  state = createTodayPractice(state);
  selectedVersionId = getActiveEntry(state).current_version_id;
  detailMode = "writing";
  historyEditUnlockedEntryId = null;
  view = "write";
  persistState(state);
  render();
  editor.focus();
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

exportJsonButton.addEventListener("click", () => {
  closeExportMenu();
  exportJsonBackup();
});

jsonSchemaButton.addEventListener("click", () => {
  closeExportMenu();
  showJsonSchemaDialog();
});

storageUpgradeMenuButton.addEventListener("click", () => {
  closeExportMenu();
  showStorageUpgradePrompt();
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

importCancelButton.addEventListener("click", () => {
  pendingImportFile = null;
  importConfirm.classList.add("hidden");
});

importConfirmButton.addEventListener("click", () => {
  if (pendingImportFile) {
    void importBackup(pendingImportFile);
  }
});

changelogButton.addEventListener("click", () => {
  showChangelogDialog();
});

changelogCloseButton.addEventListener("click", () => {
  markChangelogSeen();
  changelogDialog.classList.add("hidden");
});

jsonSchemaCloseButton.addEventListener("click", () => {
  jsonSchemaDialog.classList.add("hidden");
});

jsonSchemaCopyButton.addEventListener("click", () => {
  void copyJsonSchemaDescription();
});

storageDialogSecondaryButton.addEventListener("click", () => {
  if (storageDialogMode === "upgrade" && storageDialogDontShow.checked) {
    dismissOpfsUpgradePrompt();
    refreshStorageUpgradeEntry();
  }
  storageDialog.classList.add("hidden");
});

storageDialogPrimaryButton.addEventListener("click", () => {
  if (storageDialogMode === "upgrade") {
    void runStorageUpgrade();
    return;
  }

  if (storageDialogDontShow.checked) {
    localStorage.setItem(storageNoticeKey, "true");
  }
  storageDialog.classList.add("hidden");
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

overviewView.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-overview-scope]");
  if (!button) {
    return;
  }
  overviewScope = button.dataset.overviewScope === "all" ? "all" : Number(button.dataset.overviewScope);
  renderOverview();
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
scheduleEntrySummaryWarmup();
installPracticeTabDragScroll();
refreshStorageUpgradeEntry();
refreshStorageHealthLight();
registerServiceWorker();
void initializeStorageAndPrompts();

function saveActiveVersion(): void {
  if (!canEditActiveEntry()) {
    return;
  }

  const previousWritingYearCount = getWritingYears(getWrittenDateKeys(), todayKey()).length;
  state = saveVersion(state);
  const nextWritingYearCount = getWritingYears(getWrittenDateKeys(), todayKey()).length;
  if (nextWritingYearCount > previousWritingYearCount) {
    overviewScope = null;
  }
  selectedVersionId = getActiveEntry(state).current_version_id;
  detailMode = "writing";
  persistState(state);
  render();
}

function render(): void {
  const activeEntry = getActiveEntry(state);

  dateTitle.textContent = formatDisplayDate(activeEntry.date_key);
  writeViewButton.classList.toggle("active", view === "write");
  feedViewButton.classList.toggle("active", view === "feed");
  overviewViewButton.classList.toggle("active", view === "overview");
  writingWorkspace.classList.toggle("hidden", view !== "write");
  feedView.classList.toggle("hidden", view !== "feed");
  overviewView.classList.toggle("hidden", view !== "overview");
  exportImageButton.disabled = activeEntry.versions.length === 0;
  exportDayMarkdownButton.disabled = activeEntry.versions.length === 0;
  exportAllMarkdownButton.disabled = !state.entries.some((entry) => entry.versions.length > 0);

  if (view === "feed") {
    renderFeed();
    return;
  }

  if (view === "overview") {
    renderOverview();
    return;
  }

  const selectedVersion = getSelectedVersion(activeEntry);
  const activeContent = detailMode === "version" ? selectedVersion?.content ?? activeEntry.draft : activeEntry.draft;
  const canEdit = canEditActiveEntry();
  const isHistoricalWriting = !isTodayEntry(activeEntry) && detailMode === "writing";
  editor.value = activeEntry.draft;
  editor.classList.toggle("hidden", detailMode === "version");
  reader.classList.toggle("hidden", detailMode === "writing");
  historyEditNotice.classList.toggle("hidden", !isHistoricalWriting || canEdit);
  newPracticeButton.disabled = !isTodayEntry(activeEntry) || hasEmptyTodayPractice();
  editor.disabled = !canEdit;
  renderEditorMetrics(activeEntry, activeContent, canEdit);
  renderHabitStats();
  renderPracticeTabs(activeEntry);
  renderCalendarList();
  renderTimeline(activeEntry);
  renderReader(activeEntry);
  renderDailySummary(activeEntry);
}

function renderInputState(): void {
  const activeEntry = getActiveEntry(state);
  const canEdit = canEditActiveEntry();
  newPracticeButton.disabled = !isTodayEntry(activeEntry) || hasEmptyTodayPractice();
  renderEditorMetrics(activeEntry, activeEntry.draft, canEdit);
}

function renderEditorMetrics(activeEntry: DailyEntry, activeContent: string, canEdit: boolean): void {
  const activeStats = getTokenStats(activeContent);
  const overLimit = activeStats.total_units > 300;
  const progress = Math.min(activeStats.total_units / 300, 1);
  document.body.classList.toggle("over-limit", overLimit);
  meter.innerHTML = `
    <div class="meter-label"><strong>${activeStats.total_units}</strong><span>/300</span></div>
    <div class="meter-track"><span style="width: ${progress * 100}%"></span></div>
  `;

  statsRow.innerHTML = `
    <div><strong>${activeStats.punctuation_units}</strong><span>标点</span></div>
    <div><strong>${activeStats.han_units}</strong><span>汉字</span></div>
    <div><strong>${activeStats.latin_units + activeStats.number_units}</strong><span>字母/数字</span></div>
    <button class="button primary save-inline" type="button" ${!canEdit || activeEntry.draft === activeEntry.lastSavedContent ? "disabled" : ""}>保存版本</button>
  `;
  statsRow.querySelector<HTMLButtonElement>(".save-inline")?.addEventListener("click", saveActiveVersion);
}

function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || refreshing) {
        return;
      }

      refreshing = true;
      window.location.reload();
    });

    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) {
          return;
        }

        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && hadController) {
            registration.waiting?.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    });
  });
}

async function hydrateActiveStorage(): Promise<void> {
  const opfsState = await hydrateOpfsStorage(state);
  if (!opfsState) {
    return;
  }

  state = ensureTodayEntry(pruneHistoricalEmptyEntries(opfsState));
  resetDerivedCaches();
  selectedVersionId = getActiveEntry(state).current_version_id;
  detailMode = "writing";
  historyEditUnlockedEntryId = null;
  refreshStorageHealthLight();
  render();
  scheduleEntrySummaryWarmup();
}

async function initializeStorageAndPrompts(): Promise<void> {
  if (shouldShowOpfsUpgradePrompt()) {
    showStorageUpgradePrompt();
    return;
  }

  await hydrateActiveStorage();
  if (shouldShowChangelogOnLaunch()) {
    showChangelogDialog();
  } else {
    showStorageNoticeIfNeeded();
  }
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
  const resolvedTheme = getResolvedTheme();
  document.body.classList.toggle("theme-dark", resolvedTheme === "dark");
  document.documentElement.style.colorScheme = resolvedTheme;
  appMark.src = resolvedTheme === "dark" ? logoDarkUrl : logoUrl;
  themeButtons.forEach((button) => {
    const isActive = button.dataset.theme === themePreference;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-checked", String(isActive));
  });
}

function getResolvedTheme(): ResolvedTheme {
  return themePreference === "auto" ? (colorSchemeQuery.matches ? "dark" : "light") : themePreference;
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
  if (isOpfsStorageActive() || localStorage.getItem(storageNoticeKey) === "true") {
    return;
  }

  showStorageDialog("notice");
}

function shouldShowChangelogOnLaunch(): boolean {
  return localStorage.getItem(changelogSeenVersionKey) !== getLatestChangelogVersion();
}

function showChangelogDialog(): void {
  renderChangelog();
  changelogDialog.classList.remove("hidden");
}

function markChangelogSeen(): void {
  localStorage.setItem(changelogSeenVersionKey, getLatestChangelogVersion());
}

function getLatestChangelogVersion(): string {
  return changelog[0]?.version ?? "";
}

function renderChangelog(): void {
  changelogList.innerHTML = changelog
    .map(
      (entry) => `
        <article class="changelog-entry">
          <div class="changelog-entry-head">
            <strong>${escapeHtml(entry.version)}</strong>
            <span>${escapeHtml(entry.date)}</span>
          </div>
          <h3>${escapeHtml(entry.title)}</h3>
          <ul>
            ${entry.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </article>
      `
    )
    .join("");
}

function showStorageUpgradePrompt(): void {
  showStorageDialog("upgrade");
}

function showStorageDialog(mode: StorageDialogMode): void {
  storageDialogMode = mode;
  storageDialogDontShow.checked = false;
  storageDialogStatus.classList.add("hidden");
  storageDialogStatus.textContent = "";
  storageDialogPrimaryButton.disabled = false;
  storageDialogSecondaryButton.disabled = false;
  storageDialogSecondaryButton.classList.toggle("hidden", mode === "notice");

  if (mode === "upgrade") {
    storageDialogKicker.textContent = "Storage Upgrade";
    storageDialogTitle.textContent = "升级本地存储，支持更大的写作档案";
    storageDialogBodyPrimary.textContent = "当前文章保存在浏览器 localStorage。升级后会迁移到浏览器私有本地文件存储，仍然只保存在当前浏览器，不会上传。";
    storageDialogBodySecondary.textContent = "升级前会自动下载完整数据 ZIP。升级失败会继续使用原来的本地数据。";
    storageDialogSecondaryButton.textContent = "先不升级";
    storageDialogPrimaryButton.textContent = "马上升级";
  } else {
    storageDialogKicker.textContent = "Local Storage";
    storageDialogTitle.textContent = "写作内容只保存在当前浏览器";
    storageDialogBodyPrimary.textContent = "“逐字”不会把文章上传到云端，也不会保存到项目目录。你的内容保存在当前浏览器、当前访问地址对应的本地存储中。换浏览器、换地址、清理站点数据或使用无痕模式，都可能导致内容不可见。";
    storageDialogBodySecondary.textContent = "认真写作前，建议定期使用“导出 → 完整数据 ZIP”备份。";
    storageDialogPrimaryButton.textContent = "我知道了";
  }

  storageDialog.classList.remove("hidden");
}

function refreshStorageUpgradeEntry(): void {
  storageUpgradeMenuButton.classList.toggle("hidden", !canOfferOpfsUpgrade());
}

function refreshStorageHealthLight(): void {
  const status = getStorageStatus();
  const label =
    status.kind === "opfs-saved"
      ? "OPFS 已保存"
      : status.kind === "opfs-saving"
        ? "OPFS 正在保存"
        : status.kind === "save-error"
          ? "保存失败"
          : "localStorage 保底";
  const healthy = status.kind === "opfs-saved";
  storageHealthLight.classList.toggle("storage-health-light-green", healthy);
  storageHealthLight.classList.toggle("storage-health-light-red", status.kind === "local-fallback" || status.kind === "save-error");
  storageHealthLight.classList.toggle("storage-health-light-saving", status.kind === "opfs-saving");
  storageHealthLight.setAttribute("aria-label", label);
  storageHealthLight.title = canOfferOpfsUpgrade() && status.kind === "local-fallback" ? `${label}，点击升级` : label;
  storageHealthText.textContent = label;
}

function showImportConfirm(): void {
  importStatus.classList.add("hidden");
  importStatus.textContent = "";
  importConfirmButton.disabled = false;
  importConfirm.classList.remove("hidden");
}

function showJsonSchemaDialog(): void {
  jsonSchemaStatus.classList.add("hidden");
  jsonSchemaStatus.textContent = "";
  jsonSchemaContent.textContent = getAnalysisPrompt();
  jsonSchemaDialog.classList.remove("hidden");
}

async function copyJsonSchemaDescription(): Promise<void> {
  try {
    await copyText(getAnalysisPrompt());
    showJsonSchemaStatus("已复制分析提示词，请同时上传轻量分析 JSON。", "info");
  } catch {
    showJsonSchemaStatus("复制失败，可以手动选中说明文本复制。", "error");
  }
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("Clipboard unavailable");
    }
  }
}

function getAnalysisPrompt(): string {
  return analysisPrompt;
}

function showJsonSchemaStatus(message: string, tone: "error" | "info"): void {
  jsonSchemaStatus.textContent = message;
  jsonSchemaStatus.className = `inline-status ${tone}`;
}

function renderHabitStats(): void {
  const stats = getHabitStats();
  const articleCount = getWrittenEntries().length;
  const years = getWritingYears(getWrittenDateKeys(), todayKey());
  const activeYear = years.find((year) => year.current);
  const latestYear = activeYear ?? years.at(-1) ?? { ...getWritingYearRange(todayKey(), 0), current: true };
  const currentYearStats = getHabitStatsForRange(latestYear.startKey, minDateKey(latestYear.endKey, todayKey()));
  const nextMilestone = getNextWritingMilestone(currentYearStats.writtenDays);
  const waitingForNextYear = years.length > 0 && !activeYear;
  const writingGoalLabel = waitingForNextYear
    ? "保存新版本后开始新的365天"
    : nextMilestone
      ? `已写 ${currentYearStats.writtenDays} 天，下一站 ${nextMilestone} 天`
      : `已写 ${currentYearStats.writtenDays} 天，本写作年目标完成`;
  entryCount.textContent = `${stats.writtenDays} 天`;
  habitStats.innerHTML = `
    <div class="habit-goal"><strong>${waitingForNextYear ? `等待第${years.length + 1}写作年` : latestYear.index === 0 ? "先坚持一年" : `第${latestYear.index + 1}写作年`}</strong><span>${writingGoalLabel}</span></div>
    <div><strong>${articleCount}</strong><span>累计篇数</span></div>
    <div><strong>${stats.absentDays}</strong><span>累计缺席</span></div>
    <div><strong>${stats.currentStreak}</strong><span>当前连击</span></div>
    <div><strong>${stats.maxStreak}</strong><span>最大连击</span></div>
  `;
}

function getNextWritingMilestone(writtenDays: number): number | null {
  return writingMilestones.find((milestone) => milestone > writtenDays) ?? null;
}

function renderPracticeTabs(activeEntry: DailyEntry): void {
  const entries = getEntriesForDate(activeEntry.date_key);
  practiceTabs.innerHTML = entries
    .map((entry, index) => {
      const finalVersion = getFinalVersion(entry);
      const active = entry.entry_id === activeEntry.entry_id ? " active" : "";
      const savedMark = finalVersion ? `${finalVersion.token_stats.total_units}/300` : "草稿";
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
      persistDraftState(state);
      render();
    });
  });
}

function installPracticeTabDragScroll(): void {
  let pointerId: number | null = null;
  let startX = 0;
  let startScrollLeft = 0;
  let dragged = false;
  let suppressNextClick = false;

  practiceTabs.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    pointerId = event.pointerId;
    startX = event.clientX;
    startScrollLeft = practiceTabs.scrollLeft;
    dragged = false;
  });

  practiceTabs.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    if (Math.abs(deltaX) > 6) {
      if (!dragged) {
        dragged = true;
        practiceTabs.setPointerCapture(event.pointerId);
      }
      practiceTabs.classList.add("dragging");
    }
    practiceTabs.scrollLeft = startScrollLeft - deltaX;
  });

  practiceTabs.addEventListener("pointerup", (event) => {
    if (pointerId !== event.pointerId) {
      return;
    }

    pointerId = null;
    if (dragged) {
      suppressNextClick = true;
      window.setTimeout(() => {
        suppressNextClick = false;
      }, 0);
    }
    dragged = false;
    practiceTabs.classList.remove("dragging");
  });

  practiceTabs.addEventListener("pointercancel", () => {
    pointerId = null;
    dragged = false;
    suppressNextClick = false;
    practiceTabs.classList.remove("dragging");
  });

  practiceTabs.addEventListener(
    "click",
    (event) => {
      if (!suppressNextClick) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      suppressNextClick = false;
    },
    true
  );
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
      persistDraftState(state);
      render();
    });
  });
}

function renderTimeline(entry: DailyEntry): void {
  versionCount.textContent = `${entry.versions.length} 版`;
  if (entry.versions.length === 0) {
    timeline.innerHTML = `<p class="empty">保存今天的初稿后，版本时间线会出现在这里。</p>`;
    return;
  }

  const checkCrossDayVersions = hasCrossDayVersions(entry);
  timeline.innerHTML = [
    `<button class="version-item ${detailMode === "writing" ? "active" : ""}" data-mode="writing" type="button">
      <span class="version-index">Now</span>
      <span class="version-time">${formatShortDate(entry.date_key)}</span>
      <span class="version-stats">当前草稿</span>
    </button>`,
    ...entry.versions.map((version, index) => {
      const versionDiff = version.diff_from_previous;
      const inserted = versionDiff.filter((unit) => unit.op === "INSERT").length;
      const deleted = versionDiff.filter((unit) => unit.op === "DELETE").length;
      const active = detailMode === "version" && version.version_id === selectedVersionId ? " active" : "";
      const stats = version.token_stats;
      const crossDayBadge = checkCrossDayVersions && isCrossDayVersion(entry, version) ? `<span class="version-badge">跨天</span>` : "";
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
  const displayDiff = selected.is_initial ? [] : selected.diff_from_previous;

  reader.innerHTML = `
    <div class="reader-meta">
      <span>${selected.is_initial ? "初始版本" : "相邻版本 Diff"}</span>
      <span>${formatDateTime(selected.created_at)}</span>
    </div>
    <div class="reader-content">${renderVersionContent(selected.content, displayDiff)}</div>
  `;
}

function renderDailySummary(entry: DailyEntry): void {
  const first = entry.versions[0];
  const last = entry.versions.at(-1);

  if (!first || !last) {
    diffSummary.innerHTML = `<p class="empty">保存一个版本后生成初版-终版差异。</p>`;
    return;
  }

  const summary = getEntrySummary(entry);
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

  const visibleEntries = writtenEntries.slice(0, feedVisibleCount);
  feedList.innerHTML = visibleEntries
    .map((entry) => {
      const last = getFinalVersion(entry);
      if (!last) {
        return "";
      }
      const sameDayEntries = getEntriesForDate(entry.date_key);
      const label = getPracticeLabel(entry, sameDayEntries);
      const crossDayBadge = hasCrossDayVersions(entry) && isCrossDayVersion(entry, last) ? `<span class="feed-badge">跨天版本</span>` : "";
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
  if (visibleEntries.length < writtenEntries.length) {
    feedList.insertAdjacentHTML(
      "beforeend",
      `<button class="button ghost feed-load-more" type="button">继续加载（${visibleEntries.length}/${writtenEntries.length}）</button>`
    );
  }

  feedList.querySelectorAll<HTMLButtonElement>(".feed-date").forEach((button) => {
    button.addEventListener("click", () => {
      state = switchEntry(state, button.dataset.entryId ?? state.active_entry_id);
      selectedVersionId = getActiveEntry(state).current_version_id;
      detailMode = "writing";
      historyEditUnlockedEntryId = null;
      view = "write";
      persistDraftState(state);
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
  feedList.querySelector<HTMLButtonElement>(".feed-load-more")?.addEventListener("click", () => {
    feedVisibleCount += feedPageSize;
    renderFeed();
  });
}

function renderOverview(): void {
  const context = getOverviewContext();
  const days = getOverviewDays(context.scopeStartKey, context.scopeEndKey);
  const writtenDays = days.filter((day) => day.state === "written");
  const chartDays = getRecentOverviewDays(context.firstDay);
  const scopedEntries = getWrittenEntries().filter((entry) => dateKeyInRange(entry.date_key, context.scopeStartKey, context.scopeEndKey));
  const articleCount = scopedEntries.length;
  const versionTotal = writtenDays.reduce((total, day) => total + day.versions, 0);
  const wordTotal = writtenDays.reduce((total, day) => total + day.wordCount, 0);
  const insertedTotal = writtenDays.reduce((total, day) => total + day.inserted, 0);
  const deletedTotal = writtenDays.reduce((total, day) => total + day.deleted, 0);
  const averageVersions = writtenDays.length ? (versionTotal / writtenDays.length).toFixed(1) : "0.0";
  const recentBestChurnDay = [...chartDays].sort((left, right) => right.churn - left.churn)[0];
  const overallBestChurnDay = [...writtenDays].sort((left, right) => right.churn - left.churn)[0];
  const intensityMax = Math.max(...days.map((day) => day.churn), 1);
  const wordMax = Math.max(...chartDays.map((day) => day.wordCount), 300, 1);
  const versionMax = Math.max(...chartDays.map((day) => day.versions), 1);
  const chartIntensityMax = Math.max(...chartDays.map((day) => day.churn), 1);
  const habitStats = context.scope === "all"
    ? getHabitStats()
    : getHabitStatsForRange(context.scopeStartKey, minDateKey(context.scopeEndKey, todayKey()));
  const monthMarkers = getOverviewMonthMarkers(days.map((day) => day.key));

  renderOverviewScopeSwitch(context);
  overviewRange.textContent = context.scope === "all"
    ? `全部累计 · ${context.firstDay}—${todayKey()}`
    : `${context.years.length > 1 ? `第${context.scope + 1}写作年` : "写作年"} · ${context.scopeStartKey}—${context.scopeEndKey}`;
  const cumulativePrefix = context.scope === "all" ? "累计" : "";
  const streakLabel = context.scope !== "all" && context.scope !== context.currentYear.index ? "期末连续" : "当前连续";
  overviewSummary.innerHTML = `
    <div><strong>${writtenDays.length}</strong><span>${cumulativePrefix}写作天数</span></div>
    <div><strong>${articleCount}</strong><span>${cumulativePrefix}文字篇数</span></div>
    <div><strong>${wordTotal}</strong><span>${cumulativePrefix}终稿字数</span></div>
    <div><strong>${versionTotal}</strong><span>${cumulativePrefix}版本</span></div>
    <div><strong>${habitStats.currentStreak}</strong><span>${streakLabel}</span></div>
    <div><strong>${habitStats.maxStreak}</strong><span>最长连续</span></div>
    <div><strong>${habitStats.absentDays}</strong><span>缺席天数</span></div>
    <div><strong>${averageVersions}</strong><span>日均版本</span></div>
  `;

  overviewYearGrid.parentElement?.querySelector(".year-months")?.remove();
  if (context.scope === "all") {
    overviewGridTitle.textContent = "写作年汇总";
    overviewGridMeta.textContent = `${context.years.length} 个写作年`;
    overviewYearSummary.classList.remove("hidden");
    overviewYearSummary.innerHTML = context.years.map((year) => renderWritingYearSummary(year)).join("");
    overviewYearGrid.classList.add("hidden");
    overviewYearGrid.innerHTML = "";
  } else {
    overviewGridTitle.textContent = "年度格";
    overviewGridMeta.textContent = `${writtenDays.length}/${writingYearGoalDays} 天`;
    overviewYearSummary.classList.add("hidden");
    overviewYearSummary.innerHTML = "";
    overviewYearGrid.classList.remove("hidden");
    overviewYearGrid.insertAdjacentHTML(
      "beforebegin",
      `<div class="year-months" aria-hidden="true">${monthMarkers
        .map((marker) => `<span style="grid-column: ${marker.column + 1}">${marker.label}</span>`)
        .join("")}</div>`
    );
    overviewYearGrid.innerHTML = days
      .map((day, index) => {
        const level = getOverviewLevel(day, intensityMax);
        const title = `${day.key} · ${formatOverviewDayTitle(day)}`;
        return `<span class="year-cell ${day.state} level-${level}" title="${title}" aria-label="${title}" data-index="${index}"></span>`;
      })
      .join("");
  }
  overviewRevisionNote.innerHTML = renderOverviewRevisionNote(insertedTotal, deletedTotal);

  overviewBarsMeta.textContent = formatOverviewChartRange(chartDays);
  overviewBars.innerHTML = [
    renderOverviewBarTrack("日终稿字数", chartDays, wordMax, (day) => day.wordCount, (day) => `${day.wordCount}字 · ${day.articles}篇`),
    renderOverviewBarTrack("日版本", chartDays, versionMax, (day) => day.versions, (day) => `${day.versions}版 · ${day.articles}篇`),
    renderOverviewBarTrack("版本修改", chartDays, chartIntensityMax, (day) => day.churn, (day) => `+${day.inserted} -${day.deleted}`),
    `<div class="overview-callout">
      ${renderOverviewPeakNote(recentBestChurnDay, overallBestChurnDay, getOverviewScopePeakLabel(context))}
    </div>`
  ].join("");
}

type OverviewContext = {
  firstDay: string;
  years: WritingYear[];
  currentYear: WritingYear;
  waitingForNextYear: boolean;
  scope: OverviewScope;
  scopeStartKey: string;
  scopeEndKey: string;
};

function getOverviewContext(): OverviewContext {
  const writtenDateKeys = getWrittenDateKeys();
  const firstDay = writtenDateKeys[0] ?? todayKey();
  const activatedYears = getWritingYears(writtenDateKeys, todayKey());
  const years = activatedYears.length > 0 ? activatedYears : [{ ...getWritingYearRange(firstDay, 0), current: true }];
  const activeYear = years.find((year) => year.current);
  const currentYear = activeYear ?? years.at(-1)!;
  const waitingForNextYear = activatedYears.length > 0 && !activeYear;
  if (years.length === 1) {
    overviewScope = currentYear.index;
  } else if (overviewScope === null || (overviewScope !== "all" && !years.some((year) => year.index === overviewScope))) {
    overviewScope = currentYear.index;
  }
  const scope = overviewScope ?? currentYear.index;
  if (scope === "all") {
    return { firstDay, years, currentYear, waitingForNextYear, scope, scopeStartKey: firstDay, scopeEndKey: todayKey() };
  }
  const selectedYear = years[scope] ?? currentYear;
  return { firstDay, years, currentYear, waitingForNextYear, scope: selectedYear.index, scopeStartKey: selectedYear.startKey, scopeEndKey: selectedYear.endKey };
}

function renderOverviewScopeSwitch(context: OverviewContext): void {
  const visible = context.years.length > 1;
  overviewYearSwitch.classList.toggle("hidden", !visible);
  if (!visible) {
    overviewYearSwitch.innerHTML = "";
    return;
  }
  overviewYearSwitch.innerHTML = [
    ...context.years.map((year) => `<button class="${context.scope === year.index ? "active" : ""}" data-overview-scope="${year.index}" type="button">第${year.index + 1}写作年</button>`),
    `<button class="${context.scope === "all" ? "active" : ""}" data-overview-scope="all" type="button">全部</button>`
  ].join("");
}

function renderWritingYearSummary(year: WritingYear): string {
  const days = getOverviewDays(year.startKey, year.endKey);
  const writtenDays = days.filter((day) => day.state === "written").length;
  return `<button data-overview-scope="${year.index}" type="button">
    <span>第${year.index + 1}写作年${year.current ? " · 当前" : ""}</span>
    <strong>${writtenDays} 天</strong>
    <small>${year.startKey}—${year.endKey}</small>
  </button>`;
}

function getOverviewScopePeakLabel(context: OverviewContext): string {
  return context.scope === "all" ? "全部记录中" : `第${context.scope + 1}写作年内`;
}

function renderOverviewRevisionNote(inserted: number, deleted: number): string {
  if (inserted === 0 && deleted === 0) {
    return "保存第二个版本后，这里会累计相邻版本之间的新增与删除，不包含初稿写入。";
  }
  return `在相邻的已保存版本之间，累计新增 <em class="delta-plus">+${inserted}</em>，累计删除 <em class="delta-minus">-${deleted}</em>；不包含初稿写入。`;
}

function renderOverviewPeakNote(recentDay: OverviewDay | undefined, scopeDay: OverviewDay | undefined, scopeLabel: string): string {
  if (!scopeDay || scopeDay.churn === 0) {
    return "最近30天内保存第二个版本后，这里会显示版本修改最多的一天。";
  }

  const scopeText = `${scopeLabel}，版本修改最多的是 ${formatChineseShortDate(scopeDay.key)}：新增 <em class="delta-plus">+${scopeDay.inserted}</em>，删除 <em class="delta-minus">-${scopeDay.deleted}</em>。`;
  if (!recentDay || recentDay.churn === 0) {
    return `最近30天内没有发生版本修改。<br>${scopeText}`;
  }

  const recentText = `最近30天内，版本修改最多的是 ${formatChineseShortDate(recentDay.key)}：新增 <em class="delta-plus">+${recentDay.inserted}</em>，删除 <em class="delta-minus">-${recentDay.deleted}</em>`;
  if (recentDay.key === scopeDay.key) {
    return `${recentText}；这也是${scopeLabel}修改最多的一天。`;
  }
  return `${recentText}。<br>${scopeText}`;
}

function formatOverviewChartRange(days: OverviewDay[]): string {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) {
    return "最近 30 天";
  }
  const range = first.key === last.key ? formatChineseShortDate(first.key) : `${formatChineseShortDate(first.key)}—${formatChineseShortDate(last.key)}`;
  return `${range} · 最近 ${days.length} 天`;
}

function renderOverviewBarTrack(
  label: string,
  days: OverviewDay[],
  maxValue: number,
  getValue: (day: OverviewDay) => number,
  getTitle: (day: OverviewDay) => string
): string {
  const peakValue = Math.max(...days.map(getValue), 0);
  return `
    <div class="overview-track">
      <span>${label}</span>
      <div style="--day-count: ${Math.max(days.length, 1)}">
        ${days
          .map((day) => {
            const value = getValue(day);
            const height = day.state === "future" || value === 0 ? 2 : Math.max(4, Math.round((value / maxValue) * 28));
            const title = `${day.key} · ${getTitle(day)}`;
            const peak = value > 0 && value === peakValue ? " peak" : "";
            return `<i class="${day.state}${peak}" style="height: ${height}px" title="${title}" aria-label="${title}" tabindex="0"></i>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

async function exportOverviewCard(): Promise<void> {
  await document.fonts.ready;
  const palette = getSharePalette();
  const shareLogo = await loadCanvasImage(getResolvedTheme() === "dark" ? shareLogoDarkUrl : shareLogoUrl);
  const context = getOverviewContext();
  const days = getOverviewDays(context.scopeStartKey, context.scopeEndKey);
  const gridYear = context.scope === "all" ? context.currentYear : context.years[context.scope] ?? context.currentYear;
  const gridDays = getOverviewDays(gridYear.startKey, gridYear.endKey);
  const writtenDays = days.filter((day) => day.state === "written");
  const gridWrittenDays = gridDays.filter((day) => day.state === "written");
  const chartDays = getRecentOverviewDays(context.firstDay);
  const articleCount = getWrittenEntries().filter((entry) => dateKeyInRange(entry.date_key, context.scopeStartKey, context.scopeEndKey)).length;
  const versionTotal = writtenDays.reduce((total, day) => total + day.versions, 0);
  const wordTotal = writtenDays.reduce((total, day) => total + day.wordCount, 0);
  const insertedTotal = writtenDays.reduce((total, day) => total + day.inserted, 0);
  const deletedTotal = writtenDays.reduce((total, day) => total + day.deleted, 0);
  const averageVersions = writtenDays.length ? (versionTotal / writtenDays.length).toFixed(1) : "0.0";
  const recentBestChurnDay = [...chartDays].sort((left, right) => right.churn - left.churn)[0];
  const overallBestChurnDay = [...writtenDays].sort((left, right) => right.churn - left.churn)[0];
  const intensityMax = Math.max(...gridDays.map((day) => day.churn), 1);
  const wordMax = Math.max(...chartDays.map((day) => day.wordCount), 300, 1);
  const versionMax = Math.max(...chartDays.map((day) => day.versions), 1);
  const chartIntensityMax = Math.max(...chartDays.map((day) => day.churn), 1);
  const habitStats = context.scope === "all"
    ? getHabitStats()
    : getHabitStatsForRange(context.scopeStartKey, minDateKey(context.scopeEndKey, todayKey()));
  const monthMarkers = getOverviewMonthMarkers(gridDays.map((day) => day.key));
  const scale = 2;
  const width = 1280;
  const height = 1226;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const contentX = 96;
  const cardX = 48;
  const cardY = 48;
  const cardW = width - cardX * 2;
  const cardRadius = 30;
  const innerRight = width - contentX;

  canvas.width = width * scale;
  canvas.height = height * scale;

  ctx.scale(scale, scale);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.shadowColor = palette.shadow;
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 18;
  roundRect(ctx, cardX, cardY, cardW, height - cardY * 2, cardRadius);
  ctx.fillStyle = palette.cardBg;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 2;
  roundRect(ctx, cardX, cardY, cardW, height - cardY * 2, cardRadius);
  ctx.stroke();
  ctx.fillStyle = palette.text;
  ctx.font = cardFont(38);
  ctx.fillText("逐字 · 写作总览", contentX, 110);
  ctx.fillStyle = palette.muted;
  ctx.font = cardFont(22);
  const rangeText = context.scope === "all"
    ? `全部累计 · ${context.firstDay}—${todayKey()}`
    : `${context.years.length > 1 ? `第${context.scope + 1}写作年` : "写作年"} · ${context.scopeStartKey}—${context.scopeEndKey}`;
  ctx.fillText(rangeText, contentX, 148);

  const cumulativePrefix = context.scope === "all" ? "累计" : "";
  const streakLabel = context.scope !== "all" && context.scope !== context.currentYear.index ? "期末连续" : "当前连续";
  drawOverviewCardStats(ctx, [
    [`${cumulativePrefix}写作天数`, String(writtenDays.length)],
    [`${cumulativePrefix}文字篇数`, String(articleCount)],
    [`${cumulativePrefix}终稿字数`, String(wordTotal)],
    [`${cumulativePrefix}版本`, String(versionTotal)],
    [streakLabel, String(habitStats.currentStreak)],
    ["最长连续", String(habitStats.maxStreak)],
    ["缺席天数", String(habitStats.absentDays)],
    ["日均版本", averageVersions]
  ], palette);

  ctx.fillStyle = palette.text;
  ctx.font = cardFont(26);
  const gridTitle = context.scope === "all" ? (context.waitingForNextYear ? "最近写作年年度格" : "当前写作年年度格") : "年度格";
  ctx.fillText(gridTitle, contentX, 416);
  ctx.font = cardFont(20);
  const gridMeta = `${gridWrittenDays.length}/${writingYearGoalDays} 天`;
  ctx.fillStyle = palette.muted;
  ctx.fillText(gridMeta, innerRight - ctx.measureText(gridMeta).width, 416);
  ctx.fillStyle = palette.muted;
  ctx.font = cardFont(13);
  monthMarkers.forEach((marker) => {
    ctx.fillText(marker.label, contentX + marker.column * 20, 454);
  });
  drawOverviewCardGrid(ctx, gridDays, intensityMax, contentX, 470, palette);

  ctx.font = cardFont(18);
  let revisionNoteX = contentX;
  const revisionPrefix = "在相邻的已保存版本之间，累计新增 ";
  const revisionMiddle = "，累计删除 ";
  const revisionSuffix = "；不包含初稿写入。";
  ctx.fillStyle = palette.muted;
  ctx.fillText(revisionPrefix, revisionNoteX, 632);
  revisionNoteX += ctx.measureText(revisionPrefix).width;
  ctx.fillStyle = palette.success;
  ctx.fillText(`+${insertedTotal}`, revisionNoteX, 632);
  revisionNoteX += ctx.measureText(`+${insertedTotal}`).width;
  ctx.fillStyle = palette.muted;
  ctx.fillText(revisionMiddle, revisionNoteX, 632);
  revisionNoteX += ctx.measureText(revisionMiddle).width;
  ctx.fillStyle = palette.danger;
  ctx.fillText(`-${deletedTotal}`, revisionNoteX, 632);
  revisionNoteX += ctx.measureText(`-${deletedTotal}`).width;
  ctx.fillStyle = palette.muted;
  ctx.fillText(revisionSuffix, revisionNoteX, 632);

  ctx.fillStyle = palette.text;
  ctx.font = cardFont(26);
  ctx.fillText("每日数据", contentX, 686);
  const chartRange = formatOverviewChartRange(chartDays);
  ctx.fillStyle = palette.muted;
  ctx.font = cardFont(18);
  ctx.fillText(chartRange, innerRight - ctx.measureText(chartRange).width, 686);
  drawOverviewCardTrack(ctx, "日终稿字数", chartDays, wordMax, (day) => day.wordCount, contentX, 726, palette);
  drawOverviewCardTrack(ctx, "日版本", chartDays, versionMax, (day) => day.versions, contentX, 808, palette);
  drawOverviewCardTrack(ctx, "版本修改", chartDays, chartIntensityMax, (day) => day.churn, contentX, 890, palette);

  drawOverviewPeakNotes(ctx, recentBestChurnDay, overallBestChurnDay, getOverviewScopePeakLabel(context), contentX, 972, palette);

  const footerDividerY = 1048;
  ctx.strokeStyle = palette.divider;
  ctx.beginPath();
  ctx.moveTo(contentX, footerDividerY);
  ctx.lineTo(innerRight, footerDividerY);
  ctx.stroke();
  ctx.fillStyle = palette.muted;
  ctx.font = cardFont(21);
  ctx.fillText(`${appName}，${appSlogan}`, contentX, 1100);
  ctx.font = cardFont(19);
  ctx.fillText(appUrl, contentX, 1136);
  if (shareLogo) {
    ctx.drawImage(shareLogo, innerRight - 72, 1076, 72, 72);
  }

  const link = document.createElement("a");
  link.download = `逐字-总览图-${todayKey()}.png`;
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

function createBackupPayload(): BackupPayload {
  return {
    app: appName,
    schema_version: 2,
    exported_at: new Date().toISOString(),
    state,
    preferences: {
      theme: themePreference
    }
  };
}

function createBackupPayloadSnapshot(): BackupPayload {
  return JSON.parse(JSON.stringify(createBackupPayload())) as BackupPayload;
}

function installAutomationApi(): void {
  Object.defineProperty(window, "zhuzi", {
    configurable: true,
    value: Object.freeze({
      version: "2",
      getBackupPayload: createBackupPayloadSnapshot,
      exportJson: () => JSON.stringify(createAnalysisBackupPayload(createBackupPayload()), null, 2),
      getAnalysisPrompt,
      getSchemaDescription: getAnalysisPrompt
    } satisfies ZhuziAutomationApi)
  });
}

function exportJsonBackup(): void {
  const payload = createAnalysisBackupPayload(createBackupPayload());
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `逐字-analysis-${todayKey()}.json`);
}

async function exportZipBackup(): Promise<void> {
  const zip = new JSZip();
  const writtenEntries = getWrittenEntries();
  const payload = createBackupPayload();

  addBackupJsonFiles(zip, payload);
  zip.file("markdown/all.md", [`# 逐字`, "", appSlogan, "", `导出时间：${payload.exported_at}`, "", ...writtenEntries.map(renderEntryMarkdown)].join("\n"));

  for (const entry of writtenEntries) {
    zip.file(`markdown/days/${entry.date_key}-${slugifyPracticeLabel(entry)}.md`, renderEntryMarkdown(entry));
  }

  const blob = await generateCompressedZip(zip);
  downloadBlob(blob, `逐字-备份-${todayKey()}.zip`);
}

async function runStorageUpgrade(): Promise<void> {
  storageDialogPrimaryButton.disabled = true;
  storageDialogSecondaryButton.disabled = true;
  showStorageUpgradeStatus("正在下载备份并升级本地存储...", "info");

  try {
    await exportZipBackup();
    await upgradeToOpfsStorage(state);
    showStorageUpgradeStatus("升级完成。后续会优先使用新的本地存储，并继续保留兼容备份。", "info");
    refreshStorageUpgradeEntry();
    refreshStorageHealthLight();
    window.setTimeout(() => {
      storageDialog.classList.add("hidden");
    }, 1200);
  } catch {
    storageDialogPrimaryButton.disabled = false;
    storageDialogSecondaryButton.disabled = false;
    showStorageUpgradeStatus("升级失败，已继续保留原来的本地数据。可以先导出 ZIP 后稍后再试。", "error");
  }
}

async function importBackup(file: File): Promise<void> {
  importStatus.classList.add("hidden");
  importStatus.textContent = "";
  importConfirmButton.disabled = true;
  try {
    const parsed = await readBackupPayload(file);
    const importedState = parseImportedState(parsed);
    const parsedPreferences = parsed as { preferences?: { theme?: string } };
    if (!importedState) {
      showImportStatus("备份数据格式不正确。", "error");
      importConfirmButton.disabled = false;
      return;
    }

    state = ensureTodayEntry(importedState);
    resetDerivedCaches();
    persistState(state);
    if (parsedPreferences.preferences?.theme) {
      themePreference = parseThemePreference(parsedPreferences.preferences.theme);
      localStorage.setItem(themePreferenceKey, themePreference);
      applyThemePreference();
    }
    pendingImportFile = null;
    selectedVersionId = getActiveEntry(state).current_version_id;
    detailMode = "writing";
    historyEditUnlockedEntryId = null;
    view = "write";
    overviewScope = null;
    feedVisibleCount = feedPageSize;
    importConfirm.classList.add("hidden");
    importConfirmButton.disabled = false;
    refreshStorageUpgradeEntry();
    refreshStorageHealthLight();
    render();
    scheduleEntrySummaryWarmup();
  } catch {
    showImportStatus("导入失败，请确认备份文件来自逐字。", "error");
    importConfirmButton.disabled = false;
  }
}

function showImportStatus(message: string, tone: "error" | "info"): void {
  importStatus.textContent = message;
  importStatus.className = `inline-status ${tone}`;
}

function showStorageUpgradeStatus(message: string, tone: "error" | "info"): void {
  storageDialogStatus.textContent = message;
  storageDialogStatus.className = `inline-status ${tone}`;
}

function renderEntryMarkdown(entry: DailyEntry): string {
  const first = entry.versions[0];
  const last = entry.versions.at(-1);
  if (!first || !last) {
    return "";
  }

  const summary = getEntrySummary(entry);
  const sameDayEntries = getEntriesForDate(entry.date_key);
  const label = getPracticeLabel(entry, sameDayEntries);
  const lines = [
    `## ${entry.date_key} · ${label}`,
    "",
    `${last.token_stats.total_units}/300`,
    "",
    last.content || "空白版本",
    "",
    `文字 +${textInsertCount(summary)} -${textDeleteCount(summary)} · 标点 +${summary.punctuation.insert} -${summary.punctuation.delete} · 迭代 ${entry.versions.length}`,
    "",
    "### 版本",
    ""
  ];

  const checkCrossDayVersions = hasCrossDayVersions(entry);
  entry.versions.forEach((version, index) => {
    const crossDay = checkCrossDayVersions && isCrossDayVersion(entry, version) ? " · 跨天版本" : "";
    lines.push(`- V${index + 1} · ${formatDateTime(version.created_at)} · ${version.token_stats.total_units}/300${crossDay}`);
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

  return renderSummaryChips(getEntrySummary(entry), entry.versions.length);
}

function getEntrySummary(entry: DailyEntry): ReturnType<typeof summarizeDiff> {
  const first = entry.versions[0];
  const last = entry.versions.at(-1);
  if (!first || !last) {
    return summarizeDiff("", "");
  }

  const signature = `${first.version_id}:${last.version_id}:${entry.versions.length}`;
  const cached = entrySummaryCache.get(entry.entry_id);
  if (cached?.signature === signature) {
    return cached.summary;
  }

  const summary = summarizeDiff(first.content, last.content);
  entrySummaryCache.set(entry.entry_id, { signature, summary });
  return summary;
}

function scheduleEntrySummaryWarmup(): void {
  const generation = ++summaryWarmupGeneration;
  const entries = getWrittenEntries();
  let index = 0;

  const runBatch = (deadline?: IdleDeadline): void => {
    if (generation !== summaryWarmupGeneration) {
      return;
    }

    let processed = 0;
    while (index < entries.length && (processed === 0 || !deadline || deadline.timeRemaining() > 4)) {
      getEntrySummary(entries[index]);
      index += 1;
      processed += 1;
      if (!deadline && processed >= 2) {
        break;
      }
    }

    if (index < entries.length) {
      scheduleNextBatch();
    }
  };

  const scheduleNextBatch = (): void => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(runBatch, { timeout: 250 });
    } else {
      setTimeout(() => runBatch(), 0);
    }
  };

  scheduleNextBatch();
}

function hasCrossDayVersions(entry: DailyEntry): boolean {
  const lastVersionId = entry.versions.at(-1)?.version_id ?? "empty";
  const signature = `${lastVersionId}:${entry.versions.length}`;
  const cached = crossDayCache.get(entry.entry_id);
  if (cached?.signature === signature) {
    return cached.hasCrossDayVersion;
  }

  const hasCrossDayVersion = entry.versions.some((version) => isCrossDayVersion(entry, version));
  crossDayCache.set(entry.entry_id, { signature, hasCrossDayVersion });
  return hasCrossDayVersion;
}

function renderSummaryChips(summary: ReturnType<typeof summarizeDiff>, iterations: number): string {
  return `
    <span><b>文字</b> ${renderInlineDelta(textInsertCount(summary), textDeleteCount(summary))}</span>
    <span><b>标点</b> ${renderInlineDelta(summary.punctuation.insert, summary.punctuation.delete)}</span>
    <span><b>迭代</b> ${iterations} 版</span>
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

function getWrittenDateKeys(): string[] {
  return [...new Set(getWrittenEntries().map((entry) => entry.date_key))].sort();
}

function getEntriesForDate(key: string): DailyEntry[] {
  ensureEntryDateIndex();
  return entriesByDate.get(key) ?? [];
}

function ensureEntryDateIndex(): void {
  if (indexedEntriesReference === state.entries) {
    return;
  }

  const nextIndex = new Map<string, DailyEntry[]>();
  for (const entry of state.entries) {
    const entries = nextIndex.get(entry.date_key) ?? [];
    entries.push(entry);
    nextIndex.set(entry.date_key, entries);
  }
  nextIndex.forEach((entries) => entries.sort((left, right) => right.created_at.localeCompare(left.created_at)));
  indexedEntriesReference = state.entries;
  entriesByDate = nextIndex;
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

  const continuousStats = getHabitStatsForRange(firstDay, todayKey());
  const absentDays = getWritingYears([...writtenKeys], todayKey()).reduce((total, year) => {
    return total + getHabitStatsForRange(year.startKey, minDateKey(year.endKey, todayKey())).absentDays;
  }, 0);
  return {
    firstDay,
    writtenDays: writtenKeys.size,
    absentDays,
    currentStreak: continuousStats.currentStreak,
    maxStreak: continuousStats.maxStreak
  };
}

function getHabitStatsForRange(startKey: string, endKey: string): {
  writtenDays: number;
  absentDays: number;
  currentStreak: number;
  maxStreak: number;
} {
  if (startKey > endKey) {
    return { writtenDays: 0, absentDays: 0, currentStreak: 0, maxStreak: 0 };
  }

  const writtenKeys = new Set(
    state.entries
      .filter((entry) => entry.versions.length > 0 && dateKeyInRange(entry.date_key, startKey, endKey))
      .map((entry) => entry.date_key)
  );
  const keys = enumerateDays(startKey, endKey);
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
    writtenDays: writtenKeys.size,
    absentDays: keys.filter((key) => !writtenKeys.has(key)).length,
    currentStreak: trailingRun,
    maxStreak
  };
}

function getOverviewDays(startKey: string, endKey: string): OverviewDay[] {
  const writtenKeys = new Set(state.entries.filter((entry) => entry.versions.length > 0).map((entry) => entry.date_key));
  const today = todayKey();

  return enumerateDays(startKey, endKey).map((key) => {
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
        finalToInitialRatio: null
      };
    }

    return getOverviewDayMetrics(key);
  });
}

function getRecentOverviewDays(firstDay: string): OverviewDay[] {
  const recentStart = toLocalDateKey(addDays(parseDateKey(todayKey()), -29));
  return getOverviewDays(maxDateKey(firstDay, recentStart), todayKey());
}

function minDateKey(left: string, right: string): string {
  return left < right ? left : right;
}

function maxDateKey(left: string, right: string): string {
  return left > right ? left : right;
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

    const firstStats = first.token_stats;
    const finalStats = last.token_stats;
    const revisionTotals = getRevisionTotals(entry.versions);
    wordCount += finalStats.total_units;
    versions += entry.versions.length;
    inserted += revisionTotals.inserted;
    deleted += revisionTotals.deleted;
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
    finalToInitialRatio: firstUnits > 0 ? finalUnits / firstUnits : null
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

  const finalRatio = day.finalToInitialRatio === null ? "—" : `${Math.round(day.finalToInitialRatio * 100)}%`;
  return `${day.articles}篇 · 终稿${day.wordCount}字 · ${day.versions}版 · 版本修改 +${day.inserted} -${day.deleted} · 终稿/初稿 ${finalRatio}`;
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

function renderVersionContent(content: string, units: DiffUnit[]): string {
  if (content.length === 0) {
    return `<span class="muted">空白版本</span>`;
  }

  const segments = alignDiffToContent(content, units);
  if (!segments) {
    return escapeHtml(content);
  }

  return segments
    .map((segment) => {
      const value = escapeHtml(segment.value);
      return segment.op === "INSERT" ? `<mark>${value}</mark>` : `<span>${value}</span>`;
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

function hasEmptyTodayPractice(): boolean {
  return state.entries.some((entry) => entry.date_key === todayKey() && isEmptyPractice(entry));
}

function isEmptyPractice(entry: DailyEntry): boolean {
  return entry.versions.length === 0 && entry.draft.trim() === "";
}

function isCrossDayVersion(entry: DailyEntry, version: Version): boolean {
  return toLocalDateKey(new Date(version.created_at)) !== entry.date_key;
}

async function exportDailyCard(entry: DailyEntry): Promise<void> {
  const first = entry.versions[0];
  const last = entry.versions.at(-1);
  if (!first || !last) {
    return;
  }

  await document.fonts.ready;
  const summary = getEntrySummary(entry);
  const palette = getSharePalette();
  const shareLogo = await loadCanvasImage(getResolvedTheme() === "dark" ? shareLogoDarkUrl : shareLogoUrl);
  const canvas = document.createElement("canvas");
  const scale = 2;
  const lastStats = last.token_stats;
  const practiceLabel = getPracticeLabel(entry, getEntriesForDate(entry.date_key));
  const meterText = `${practiceLabel}  ·  ${lastStats.total_units} / 300`;
  const achievementText = renderShareAchievementText();
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  if (!measureCtx) {
    return;
  }

  measureCtx.font = cardFont(30);
  const initialLayout = getDailyShareLayout(1);
  const visibleLines = layoutShareText(
    last.content || "空白版本",
    initialLayout.contentWidth - 64,
    (text) => measureCtx.measureText(text).width
  );
  const layout = getDailyShareLayout(visibleLines.length);
  const footerLine1 = `${appName}，${appSlogan}`;
  const footerLine2 = appUrl;
  canvas.width = layout.width * scale;
  canvas.height = layout.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.scale(scale, scale);
  ctx.fillStyle = palette.dailyBg;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.save();
  ctx.shadowColor = palette.shadow;
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 18;
  roundRect(ctx, layout.cardX, layout.cardY, layout.cardWidth, layout.cardHeight, 30);
  ctx.fillStyle = palette.cardBg;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 2;
  roundRect(ctx, layout.cardX, layout.cardY, layout.cardWidth, layout.cardHeight, 30);
  ctx.stroke();

  ctx.fillStyle = palette.text;
  ctx.font = cardFont(35);
  ctx.fillText(formatDisplayDate(entry.date_key), layout.innerX, layout.titleY);
  ctx.font = cardFont(22);
  const meterPaddingX = 24;
  const meterWidth = Math.ceil(ctx.measureText(meterText).width + meterPaddingX * 2);
  const meterX = layout.innerRight - meterWidth;
  drawSoftPill(ctx, meterX, layout.meterY, meterWidth, 44, palette);
  ctx.fillStyle = palette.textSoft;
  ctx.fillText(meterText, meterX + meterPaddingX, layout.meterY + 30);

  roundRect(ctx, layout.contentX, layout.contentY, layout.contentWidth, layout.contentHeight, 18);
  ctx.fillStyle = palette.contentBg;
  ctx.fill();
  ctx.strokeStyle = palette.divider;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = palette.text;
  ctx.font = cardFont(30);
  visibleLines.forEach((line, index) => {
    drawShareTextLine(ctx, line, layout.contentTextX, layout.contentTextY + index * dailyShareLineHeight);
  });

  ctx.fillStyle = palette.muted;
  ctx.font = cardFont(18);
  ctx.fillText("初稿 → 终稿", layout.innerX, layout.diffLabelY);
  drawDailyDiffStrip(
    ctx,
    layout.innerX,
    layout.diffStripY,
    layout.innerRight - layout.innerX,
    layout.diffStripHeight,
    [
      { label: "文字", inserted: textInsertCount(summary), deleted: textDeleteCount(summary) },
      { label: "标点", inserted: summary.punctuation.insert, deleted: summary.punctuation.delete },
      { label: "迭代", value: `${entry.versions.length} 版` }
    ],
    palette
  );

  ctx.strokeStyle = palette.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(layout.innerX, layout.footerDividerY);
  ctx.lineTo(layout.innerRight, layout.footerDividerY);
  ctx.stroke();

  ctx.fillStyle = palette.textSoft;
  ctx.font = cardFont(23);
  ctx.fillText(achievementText, layout.innerX, layout.achievementY);
  ctx.fillStyle = palette.muted;
  ctx.font = cardFont(21);
  ctx.fillText(footerLine1, layout.innerX, layout.brandY);
  ctx.font = cardFont(19);
  ctx.fillText(footerLine2, layout.innerX, layout.urlY);

  if (shareLogo) {
    ctx.drawImage(shareLogo, layout.logoX, layout.logoY, layout.logoSize, layout.logoSize);
  }

  const link = document.createElement("a");
  link.download = `逐字-分享图-${entry.date_key}-${slugifyPracticeLabel(entry)}.png`;
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

function getSharePalette(): SharePalette {
  if (getResolvedTheme() === "dark") {
    return {
      bg: "#ffffff",
      dailyBg: "#ffffff",
      cardBg: "#1d1b1a",
      contentBg: "#181716",
      text: "#ebe6dd",
      textSoft: "rgba(235,230,221,0.78)",
      muted: "rgba(235,230,221,0.58)",
      border: "rgba(235,230,221,0.14)",
      divider: "rgba(235,230,221,0.18)",
      shadow: "rgba(0,0,0,0.38)",
      pillBg: "rgba(255,255,255,0.055)",
      success: "#7fd39a",
      danger: "#ff8b7c",
      gridAbsent: "rgba(255,255,255,0.07)",
      gridFuture: "rgba(255,255,255,0.035)",
      gridLevels: ["rgba(127,211,154,0.24)", "rgba(127,211,154,0.42)", "rgba(127,211,154,0.62)", "#7fd39a"],
      track: "rgba(235,230,221,0.72)",
      trackMuted: "rgba(235,230,221,0.2)"
    };
  }

  return {
    bg: "#ffffff",
    dailyBg: "#ffffff",
    cardBg: "#fcfbf8",
    contentBg: "#ffffff",
    text: "#1c1c1c",
    textSoft: "rgba(28,28,28,0.72)",
    muted: "rgba(28,28,28,0.56)",
    border: "rgba(28,28,28,0.08)",
    divider: "rgba(28,28,28,0.12)",
    shadow: "rgba(28,28,28,0.12)",
    pillBg: "rgba(28,28,28,0.035)",
    success: "#287a46",
    danger: "#9b3428",
    gridAbsent: "rgba(28,28,28,0.08)",
    gridFuture: "rgba(28,28,28,0.035)",
    gridLevels: ["rgba(40,122,70,0.22)", "rgba(40,122,70,0.38)", "rgba(40,122,70,0.58)", "#287a46"],
    track: "rgba(28,28,28,0.72)",
    trackMuted: "rgba(28,28,28,0.18)"
  };
}

function drawSoftPill(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, palette = getSharePalette()): void {
  roundRect(ctx, x, y, width, height, 18);
  ctx.fillStyle = palette.pillBg;
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.stroke();
}

function drawDailyDiffStrip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  items: Array<{ label: string; inserted: number; deleted: number } | { label: string; value: string }>,
  palette = getSharePalette()
): void {
  roundRect(ctx, x, y, width, height, 14);
  ctx.fillStyle = palette.pillBg;
  ctx.fill();
  ctx.strokeStyle = palette.divider;
  ctx.lineWidth = 1;
  ctx.stroke();

  const itemWidth = width / items.length;
  items.forEach((item, index) => {
    const itemX = x + index * itemWidth;
    if (index > 0) {
      ctx.beginPath();
      ctx.moveTo(itemX, y + 18);
      ctx.lineTo(itemX, y + height - 18);
      ctx.stroke();
    }

    ctx.fillStyle = palette.muted;
    ctx.font = cardFont(18);
    ctx.fillText(item.label, itemX + 24, y + 30);
    ctx.font = cardFont(26);
    if ("value" in item) {
      ctx.fillStyle = palette.text;
      ctx.fillText(item.value, itemX + 24, y + 65);
      return;
    }

    const insertedText = `+${item.inserted}`;
    ctx.fillStyle = palette.success;
    ctx.fillText(insertedText, itemX + 24, y + 65);
    ctx.fillStyle = palette.danger;
    ctx.fillText(`-${item.deleted}`, itemX + 24 + ctx.measureText(insertedText).width + 18, y + 65);
  });
}

async function loadCanvasImage(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => resolve(null), { once: true });
    image.src = source;
  });
}

function drawOverviewPeakNotes(
  ctx: CanvasRenderingContext2D,
  recentDay: OverviewDay | undefined,
  scopeDay: OverviewDay | undefined,
  scopeLabel: string,
  x: number,
  y: number,
  palette: SharePalette
): void {
  ctx.font = cardFont(18);
  if (!scopeDay || scopeDay.churn === 0) {
    ctx.fillStyle = palette.muted;
    ctx.fillText("最近30天内保存第二个版本后，这里会显示版本修改最多的一天。", x, y);
    return;
  }

  if (!recentDay || recentDay.churn === 0) {
    ctx.fillStyle = palette.muted;
    ctx.fillText("最近30天内没有发生版本修改。", x, y);
    drawOverviewPeakLine(ctx, scopeDay, `${scopeLabel}，版本修改最多的是 `, x, y + 30, palette, "。");
    return;
  }

  if (recentDay.key === scopeDay.key) {
    drawOverviewPeakLine(
      ctx,
      recentDay,
      "最近30天内，版本修改最多的是 ",
      x,
      y,
      palette,
      `；这也是${scopeLabel}修改最多的一天。`
    );
    return;
  }

  drawOverviewPeakLine(ctx, recentDay, "最近30天内，版本修改最多的是 ", x, y, palette, "。");
  drawOverviewPeakLine(ctx, scopeDay, `${scopeLabel}，版本修改最多的是 `, x, y + 30, palette, "。");
}

function drawOverviewPeakLine(
  ctx: CanvasRenderingContext2D,
  day: OverviewDay,
  scopePrefix: string,
  x: number,
  y: number,
  palette: SharePalette,
  suffix: string
): void {
  const prefix = `${scopePrefix}${formatChineseShortDate(day.key)}：新增 `;
  const middle = "，删除 ";
  ctx.fillStyle = palette.muted;
  ctx.fillText(prefix, x, y);
  x += ctx.measureText(prefix).width;
  ctx.fillStyle = palette.success;
  ctx.fillText(`+${day.inserted}`, x, y);
  x += ctx.measureText(`+${day.inserted}`).width;
  ctx.fillStyle = palette.muted;
  ctx.fillText(middle, x, y);
  x += ctx.measureText(middle).width;
  ctx.fillStyle = palette.danger;
  ctx.fillText(`-${day.deleted}`, x, y);
  x += ctx.measureText(`-${day.deleted}`).width;
  ctx.fillStyle = palette.muted;
  ctx.fillText(suffix, x, y);
}

function drawOverviewCardStats(ctx: CanvasRenderingContext2D, stats: Array<[string, string]>, palette = getSharePalette()): void {
  const startX = 96;
  const startY = 184;
  const gap = 16;
  const itemW = 260;
  const itemH = 84;

  stats.forEach(([label, value], index) => {
    const x = startX + (index % 4) * (itemW + gap);
    const y = startY + Math.floor(index / 4) * (itemH + gap);
    roundRect(ctx, x, y, itemW, itemH, 14);
    ctx.fillStyle = palette.pillBg;
    ctx.fill();
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = palette.text;
    ctx.font = cardFont(28);
    ctx.fillText(value, x + 18, y + 36);
    ctx.fillStyle = palette.muted;
    ctx.font = cardFont(19);
    ctx.fillText(label, x + 18, y + 64);
  });
}

function drawOverviewCardGrid(ctx: CanvasRenderingContext2D, days: OverviewDay[], maxChurn: number, x: number, y: number, palette = getSharePalette()): void {
  const cell = 16;
  const gap = 4;
  days.forEach((day, index) => {
    const column = Math.floor(index / 7);
    const row = index % 7;
    ctx.fillStyle = overviewCellColor(day, getOverviewLevel(day, maxChurn), palette);
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
  y: number,
  palette = getSharePalette()
): void {
  const labelW = 118;
  const trackW = overviewExportTrackWidth;
  const count = Math.max(days.length, 1);
  const { barGap, barWidth: barW, startOffset } = getOverviewExportBarLayout(count);
  const peakValue = Math.max(...days.map(getValue), 0);
  ctx.fillStyle = palette.muted;
  ctx.font = cardFont(20);
  ctx.fillText(label, x, y + 38);
  ctx.strokeStyle = palette.border;
  ctx.beginPath();
  ctx.moveTo(x + labelW, y + 48);
  ctx.lineTo(x + labelW + trackW, y + 48);
  ctx.stroke();

  days.forEach((day, index) => {
    const value = getValue(day);
    const barH = day.state === "future" || value === 0 ? 3 : Math.max(6, Math.round((value / maxValue) * 42));
    ctx.fillStyle = value > 0 && value === peakValue ? palette.success : day.state === "written" ? palette.track : palette.trackMuted;
    roundRect(ctx, x + labelW + startOffset + index * (barW + barGap), y + 48 - barH, barW, barH, 2);
    ctx.fill();
  });
}

function overviewCellColor(day: OverviewDay, level: number, palette = getSharePalette()): string {
  if (day.state === "future") {
    return palette.gridFuture;
  }

  if (day.state === "absent") {
    return palette.gridAbsent;
  }

  return palette.gridLevels[level - 1] ?? palette.success;
}

function drawShareTextLine(ctx: CanvasRenderingContext2D, line: ShareTextLine, x: number, y: number): void {
  if (line.tracking === 0) {
    ctx.fillText(line.text, x, y);
    return;
  }

  let cursorX = x;
  for (const grapheme of Array.from(line.text)) {
    ctx.fillText(grapheme, cursorX, y);
    cursorX += ctx.measureText(grapheme).width + line.tracking;
  }
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

function formatChineseShortDate(key: string): string {
  const [, month, day] = key.split("-").map(Number);
  return `${month}月${day}日`;
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
