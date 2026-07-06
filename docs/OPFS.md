下面是一份偏工程落地导向的升级指南，默认你目标是：完全 Web 化 + OPFS 作为主存储 + 保留 IndexedDB fallback + 移除 Tauri。

---

# OPFS Storage Upgrade Guide (Local-first rewrite)

## 0. 目标概述

本次改造的目标不是“替换 localStorage”，而是将当前 JSON snapshot 模型升级为：

* OPFS：主存储（WAL + checkpoint）
* IndexedDB：缓存与索引层
* localStorage：仅保留迁移入口（一次性）
* 浏览器 Web 应用：唯一运行环境（移除 Tauri）

核心收益：

* 突破 5–10MB localStorage 限制
* 支持长期写作历史
* 提升写入性能（异步 IO）
* 为未来“流式版本/增量 diff 存储”铺路

---

## 0.1 评估结论：方案方向正确，但不能按原计划直接切换

当前代码的真实状态：

* 主数据保存在 `localStorage["char300-lab-state-v2"]`
* 旧版单篇数据保存在 `localStorage["char300-lab-state-v1"]`
* `loadState()` 和 `persistState()` 是同步 API，且 `main.ts` 在启动、输入、切换文章、保存版本、删除练习、ZIP 导入等路径都会直接调用
* ZIP 导入会覆盖当前本地档案，因此它也是迁移后必须同步到新主存储的写入入口
* 主题偏好与存储提醒也使用 localStorage，但它们不是文章数据，不能和文章迁移混在一起处理

所以，OPFS 升级不能做成“上线后立即停写 localStorage”。如果 OPFS 初始化失败、浏览器不支持 OPFS、迁移过程崩溃，或者用户在多标签页中打开旧版本，直接停写会造成“用户以为保存了，但实际新旧存储分叉”的风险。

无感升级的最低要求：

* 首次启动必须先完整读取并规范化现有 `v2` / `v1` localStorage 数据
* 迁移写入 OPFS 后必须回读校验，确认 `AppState` 等价，再标记迁移完成
* OPFS 未可用或校验失败时，继续使用 localStorage，用户不应看到空档案
* 在至少一个兼容版本周期内继续镜像写入 localStorage，作为回滚与旧版本兜底
* 只有当 OPFS / IndexedDB 路径稳定后，才能把 localStorage 从“镜像兜底”降级为“迁移入口”
* `normalizeState()` 必须保持向后兼容，不应删除旧字段补全逻辑

结论：本文档原来的 OPFS + WAL + checkpoint 架构可以作为目标态，但执行顺序需要调整为“先兼容读写、再迁移、再切主、最后清理”。Tauri 移除也应放到存储切换稳定之后，避免一次发布同时改变运行环境和数据层。

---

## 1. 架构变更

### 1.1 当前架构（旧）

```
AppState
  → JSON.stringify
  → localStorage
```

问题：

* 全量写入
* 线性增长性能退化
* 无恢复能力（除 snapshot）

---

### 1.2 新架构（目标）

```
UI Layer
   ↓
State Manager
   ↓
Storage Router
   ├── OPFS (WAL + checkpoint) ← source of truth
   ├── IndexedDB (cache + index)
   └── localStorage (migration only)
```

---

## 2. OPFS 存储设计

### 2.1 文件结构

在 OPFS 中建立如下目录：

```
/opfs-root/
  /char300/
    wal.log
    checkpoint.json
    meta.json
    /snapshots/
      2026-07-06.json
```

---

### 2.2 数据语义

#### WAL（Write Ahead Log）

追加写入：

```
ADD_ENTRY
UPDATE_DRAFT
SAVE_VERSION
```

每一条为 JSON line：

```json
{"op":"UPDATE_DRAFT","entry_id":"xxx","payload":{...},"ts":123}
```

---

#### checkpoint.json

周期性完整快照：

```json
{
  "entries": [...],
  "active_entry_id": "...",
  "last_wal_offset": 12345
}
```

---

#### meta.json

```json
{
  "schema_version": 2,
  "created_at": "...",
  "last_compaction": "..."
}
```

---

## 3. 核心模块拆分

### 3.1 StorageAdapter（必须先做）

新增抽象层：

```
/src/storage/
  StorageAdapter.ts
  opfs.ts
  idb.ts
  legacy.ts
```

接口定义：

```ts
interface StorageAdapter {
  init(): Promise<void>;
  load(): Promise<AppState | null>;
  append(event: WriteEvent): Promise<void>;
  checkpoint(state: AppState): Promise<void>;
  migrateFromLegacy?(): Promise<void>;
}
```

---

## 4. OPFS 实现方案

### 4.1 初始化

```ts
const root = await navigator.storage.getDirectory();
const dir = await root.getDirectoryHandle("char300", { create: true });
```

---

### 4.2 WAL 写入

策略：append-only

```ts
const file = await dir.getFileHandle("wal.log", { create: true });
const writable = await file.createWritable({ keepExistingData: true });
await writable.seek(fileSize);
await writable.write(line + "\n");
await writable.close();
```

---

### 4.3 checkpoint 写入

```ts
const file = await dir.getFileHandle("checkpoint.json", { create: true });
const writable = await file.createWritable();
await writable.write(JSON.stringify(state));
await writable.close();
```

---

### 4.4 启动恢复逻辑

启动时：

1. 读取 checkpoint.json
2. 读取 wal.log
3. replay WAL（offset > checkpoint.last_wal_offset）
4. 合成最终 state

---

## 5. IndexedDB 设计（缓存层）

用途：

* UI 快速加载
* fallback
* search index（未来可扩展）

结构：

```
store: state_cache
key: "latest_state"
value: AppState
```

写策略：

* 每次 debounce（500–2000ms）写一次

---

## 6. 数据写入路径（关键）

### 6.1 写入顺序

```
UI action
  ↓
updateState()
  ↓
emit event
  ↓
Storage Router
    ├── OPFS WAL (sync-ish, authoritative)
    ├── IndexedDB (debounced cache)
```

---

### 6.2 一致性规则

优先级：

```
OPFS WAL > checkpoint > IndexedDB > localStorage
```

---

## 7. migration 计划（非常关键）

### Phase 0：冻结当前文章数据 schema

* lock current localStorage schema
* add version flag v2
* 明确文章数据 key：

  * `char300-lab-state-v2`：当前多篇 `AppState`
  * `char300-lab-state-v1`：历史单篇 legacy 数据

* 保留 `normalizeState()` 和 v1 → v2 迁移逻辑
* 为迁移结果增加等价性检查：entry 数量、active entry、每篇 entry id/date/draft/lastSavedContent/version id/content 必须一致

### Phase 1：抽象存储层，但行为不变

目标：降低改造风险，不改变用户可见行为。

* 新增 `StorageAdapter` / `StorageRouter`
* 把现有 localStorage 逻辑封装成 `LegacyLocalStorageAdapter`
* `loadState()` 可以内部过渡为 async，但 UI 初始化必须有明确 loading 状态
* 默认仍从 localStorage 读取，仍写 localStorage
* ZIP 导入、保存版本、草稿输入、切换文章等所有写入口统一走 router

### Phase 2：OPFS 影子写入（shadow write）

目标：验证 OPFS 写入，不让 OPFS 影响用户数据读取。

* 初始化 OPFS
* 每次 `persistState(state)` 同步写 localStorage，同时异步写 OPFS checkpoint
* OPFS 写失败只记录状态，不阻塞用户保存
* 启动时仍以 localStorage 为准
* 后台对 OPFS 回读并与 localStorage state 做等价校验
* 校验连续成功后，写入 `meta.json`：

```json
{
  "schema_version": 2,
  "migration": {
    "source": "localStorage:char300-lab-state-v2",
    "verified": true,
    "verified_at": "..."
  }
}
```

### Phase 3：OPFS 优先读取，localStorage 持续镜像

目标：把 OPFS 变成主读取路径，同时保留完全回滚能力。

读取顺序：

```
verified OPFS checkpoint/WAL
  → IndexedDB cache
  → localStorage v2
  → localStorage v1
  → createEmptyState()
```

写入顺序：

```
OPFS checkpoint/WAL
  → IndexedDB cache
  → localStorage v2 mirror
```

要求：

* OPFS 写入失败时，必须保留 localStorage mirror 成功写入
* 下一次启动如果 OPFS 数据损坏，必须自动回退到 localStorage mirror 并修复 OPFS
* 用户不需要手动导入、确认或清缓存

### Phase 4：启用 WAL 作为增量层

目标：在 checkpoint 迁移稳定后，再引入 WAL，避免一次性改变太多变量。

* checkpoint 仍保存完整 `AppState`
* WAL 只记录 checkpoint 之后的增量事件
* replay 后必须经过 `normalizeState()`
* WAL corrupt 时可以丢弃 WAL，回到最近 checkpoint；不能丢 checkpoint
* compaction 成功写入新 checkpoint 后，再截断 WAL

### Phase 5：localStorage 降级为迁移入口

进入条件：

* 至少一个发布版本已经完成 OPFS 优先读取 + localStorage mirror
* OPFS unsupported / blocked 的浏览器已有 IndexedDB 或 localStorage fallback
* 导入 ZIP、导出 ZIP、每日写作、保存版本、删除练习都已覆盖测试

操作：

* 新写入不再依赖 localStorage 作为主兜底
* 仍保留 localStorage loader，用于旧用户首次打开新版
* 不主动删除 `char300-lab-state-v2`，除非用户明确选择清理本地数据

---

## 8. Tauri 移除步骤

### checklist

建议在 Phase 3 稳定后再做，避免“运行环境迁移”和“数据层迁移”同时上线。

* [ ] 删除 `/src-tauri`
* [ ] 删除 tauri config
* [ ] 移除 npm scripts:

  * tauri dev
  * tauri build
* [ ] package.json 清理 tauri deps
* [ ] 检查 fs API 替换（如果有 node fs）
* [ ] 确认所有 IO 使用 OPFS / IndexedDB

---

## 9. 风险控制

### 9.1 crash recovery

必须保证：

* WAL 写入是 append-only
* checkpoint 永远可重建 state

---

### 9.2 文件损坏

策略：

* checkpoint corrupt → replay WAL
* WAL corrupt → fallback checkpoint
* both corrupt → IndexedDB fallback

---

### 9.3 性能问题

注意：

* WAL 不要无限增长
* 每 100–500 次写入触发 compaction

---

## 10. compaction 机制（必须有）

触发条件：

* WAL > 5MB
* 或 > 1000 events

操作：

```
state = replay(WAL + checkpoint)
write checkpoint.json
truncate WAL
```

---

## 11. 最小任务 Checklist（执行顺序）

### Stage 1：结构准备

* [ ] 创建 `/storage` 模块
* [ ] 定义 StorageAdapter interface
* [ ] 封装现有 localStorage 作为 LegacyAdapter

---

### Stage 2：OPFS 骨架

* [ ] 初始化 OPFS directory
* [ ] 实现 read/write file helper
* [ ] 能写 wal.log（最小 append）

---

### Stage 3：恢复系统

* [ ] checkpoint.json 读写
* [ ] WAL replay 逻辑
* [ ] state reconstruction

---

### Stage 4：双写系统

* [ ] UI → event emitter
* [ ] 同时写 OPFS + IndexedDB + localStorage mirror
* [ ] debounce IndexedDB cache

---

### Stage 5：迁移逻辑

* [ ] localStorage import → OPFS checkpoint
* [ ] 自动 migration runner
* [ ] OPFS 回读校验通过后再写入 verified migration flag
* [ ] OPFS 失败时自动回退 localStorage，不展示空状态

---

### Stage 6：移除旧系统

* [ ] 将 localStorage persistState 降级为旧版本 mirror / 迁移 hook
* [ ] 保留 legacy schema loader
* [ ] 移除 Tauri

---

## 13. 兼容性验收清单

必须用真实浏览器验证以下场景：

* 只有 `char300-lab-state-v2`：首次打开后内容、当前选中文章、草稿、版本历史完全一致
* 只有 `char300-lab-state-v1`：首次打开后仍能迁移成一篇 `DailyEntry`
* v1 和 v2 同时存在：以 v2 为准
* OPFS 不可用：继续读写 localStorage，不能出现空档案
* OPFS checkpoint 损坏：回退 localStorage mirror，并重建 OPFS
* WAL 损坏：保留 checkpoint 数据，丢弃损坏 WAL 尾部或整体 WAL
* ZIP 导入后：OPFS、IndexedDB、localStorage mirror 都更新为导入后的状态
* 多次刷新：不会重复创建今天的空练习，除非用户点击“新练习”
* 大数据量：超过 localStorage 常见限制时，OPFS 正常保存；localStorage mirror 写失败不能覆盖 OPFS 成功结果
* 旧版本回滚：用户打开仍依赖 localStorage 的旧版本时，至少能看到升级前或 mirror 中的最新可用数据

## 12. 最终状态

系统变成：

```
Char300 Lab
  ├── UI (stateless-ish)
  ├── State Manager (event-driven)
  ├── OPFS WAL (truth)
  ├── OPFS checkpoint (snapshot)
  └── IndexedDB (cache/index)
```

---
