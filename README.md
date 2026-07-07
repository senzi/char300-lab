# 逐字

让每一次修改都被看见。

逐字是一个本地优先的每日写作与版本打磨工具。它记录从草稿到终稿的修改轨迹：每天写作、保存版本、查看 token 级 diff，并在阅读流和总览里回看自己的写作节奏。

## 功能

- 每日写作：按自然日管理练习，支持回到今日和历史回看。
- 版本链：每次保存生成一个不可覆盖的版本，保留相邻版本 diff。
- 阅读流与总览：浏览每日终稿，查看年度格、写作天数、连击和每日数据。
- 统计提示：显示 300 字标尺，并统计汉字、标点、连续数字等 token。
- 主题与离线：支持跟随系统、日间、夜间；首次在线加载后可离线继续使用。
- 导出与恢复：支持分享图片、Markdown、完整数据 ZIP、JSON 导出，以及 ZIP/JSON 导入恢复。

## 当前版本

0.2.4 新增 JSON 导出、JSON 架构说明与 ZIP/JSON 兼容导入；旧版 ZIP 备份仍可继续恢复。

## 运行

```bash
npm install
npm run dev
```

默认访问地址：

```text
http://127.0.0.1:5173/
```

构建与预览：

```bash
npm run build
npm run preview
```

## 数据与备份

逐字不需要服务器，也不会主动上传内容。写作数据保存在当前浏览器、当前访问地址对应的本地存储中，优先使用 OPFS，并保留 localStorage 作为兼容兜底。

这意味着：

- 换浏览器后，看不到原浏览器里的数据。
- 换地址或端口后，可能看到另一份数据，例如 `localhost:5173` 和 `127.0.0.1:5173` 是不同 origin。
- 清理站点数据、重置浏览器资料或关闭无痕窗口，都可能删除本地数据。

认真使用时，建议定期备份：

```text
导出 → 完整数据 ZIP
```

如果只需要结构化数据，也可以使用：

```text
导出 → JSON 导出
```

完整数据 ZIP 包含：

- `zhuzi-data.json`：可导入恢复的完整数据。
- `markdown/all.md`：全部终稿的 Markdown 汇总。
- `markdown/days/*.md`：每天单独一份 Markdown。

JSON 导出得到的就是 ZIP 内 `zhuzi-data.json` 的同一份数据。JSON 备份保留完整档案状态，可能包含尚未写作或尚未保存版本的空练习；做展示或统计时可按 `versions.length > 0`、`draft.trim()` 或 `lastSavedContent.trim()` 自行过滤。

恢复方式：

```text
导出 → 从 ZIP/JSON 导入
```

导入会替换当前环境里的本地档案。导入前请确认当前内容已经备份。

## 自动化读取

推荐先手动使用“JSON 导出”，再把导出的 JSON 文件交给 AI 或脚本处理。

逐字也提供页面内只读 API，适合油猴脚本或已连接到当前页面的浏览器 Agent。它不是 HTTP API。普通 Playwright 新开的浏览器没有用户原 Chrome 里的逐字数据；自动化脚本需要连接到已有数据的浏览器上下文，或由用户先打开逐字页面后再调用：

```js
const payload = await page.evaluate(() => window.zhuzi.getBackupPayload());
const json = await page.evaluate(() => window.zhuzi.exportJson());
```

## 数据说明

`Entry` 表示某一天的写作容器；`Version` 表示每次保存后的完整文本快照。历史版本不可覆盖，只追加。

统计规则：

- 汉字：1 单位。
- 标点：1 单位。
- 连续数字：合并为 1 个数字 token。

例如 `2026年写100字。` 中，`2026` 是 1 个数字 token，`100` 也是 1 个数字 token。

## 常用命令

```bash
npm run dev      # 启动开发服务器
npm run build    # 构建静态网页
npm run preview  # 预览构建结果
```
