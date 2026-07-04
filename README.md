# 逐字

让每一次修改都被看见。

逐字是一个本地优先的每日写作与版本打磨工具。它不是内容生成器，而是记录你从初稿到终稿的修改轨迹：每天一篇，每次保存生成一个不可覆盖的版本，并用 token 级 diff 展示文字如何被删减、补充和收束。

## 功能

- 每日写作：按自然日自动管理条目，支持回到今日和历史日期回看。
- 版本链：每次保存生成一个不可变版本，保留相邻版本 diff。
- 阅读流：像时间线一样浏览自己写过的每日终稿。
- 300 字标尺：显示 `当前 total_units / 300`，只做表达密度提示，不限制输入。
- 中文 token 统计：汉字、中文/英文标点、连续数字 token 统计。
- 写作统计：写作天数、缺席天数、当前连击、最大连击。
- 导出：
  - 分享图片
  - 当日 Markdown
  - 全部 Markdown
  - 完整数据 ZIP
  - 从 ZIP 导入恢复

## 使用方式

### 1. 直接运行网页版

适合不想安装或不信任预编译 App 的用户。所有数据保存在当前浏览器的本地存储中。

```bash
npm install
npm run dev
```

然后打开终端里显示的地址，默认是：

```text
http://127.0.0.1:5173/
```

重要：`npm run dev` 不会把你的文章保存到项目目录里的某个 `.md` 或 `.json` 文件。数据保存在浏览器针对当前地址的 localStorage 中，通常绑定到类似下面这样的 origin：

```text
http://127.0.0.1:5173
```

这意味着：

- 换浏览器后，看不到原来的数据。
- 换成不同地址或端口后，可能看不到原来的数据，例如 `localhost:5173` 和 `127.0.0.1:5173` 是两份浏览器存储。
- 清理浏览器站点数据、缓存清理工具、重置浏览器资料、无痕模式关闭，都可能导致数据消失。
- 删除项目文件夹通常不会直接删除浏览器 localStorage，但如果你之后用不同地址重新打开，也可能以为数据丢了。
- `npm run dev` 是开发服务器，长期自用建议固定使用同一个地址和端口。

网页版首次打开时会显示本地存储提醒。只有勾选“不再提醒”并点击确认后，才会在 localStorage 中写入提醒关闭标记：

```text
zhuzi-storage-notice-dismissed-v1=true
```

如果只是关闭提醒但不勾选“不再提醒”，下次打开仍会继续提醒。

### 2. 构建静态网页版

```bash
npm install
npm run build
npm run preview
```

这种方式会先生成 `dist/`，再用本地预览服务器访问构建后的网页版本。

### 3. 运行桌面开发版

需要本机安装 Rust 和平台相关构建工具。

```bash
npm install
npm run tauri -- dev
```

### 4. 构建桌面 App

macOS：

```bash
npm install
npm run tauri -- build
```

构建产物会出现在：

```text
src-tauri/target/release/bundle/
```

Windows 后续也可以用同样方式构建，但需要在 Windows 环境里安装：

- Node.js
- Rust
- Microsoft Visual Studio Build Tools
- WebView2 Runtime

然后执行：

```bash
npm install
npm run tauri -- build
```

## 网页版和桌面版的区别

逐字的核心逻辑在前端，因此可以只用网页版。

区别主要在数据所在位置：

- 网页版：数据保存在当前浏览器对该地址的 localStorage 中，不在项目文件夹里。
- 桌面版：数据保存在 Tauri WebView 的本地存储中。

两者都不需要服务器，也不会主动上传内容。

如果要换设备、换浏览器、从网页版迁移到桌面版，建议使用：

```text
导出 → 完整数据 ZIP
```

再在另一个环境中使用：

```text
导出 → 从 ZIP 导入
```

## 备份建议

如果你认真使用逐字写东西，强烈建议定期备份。最稳妥的方式是：

```text
导出 → 完整数据 ZIP
```

建议频率：

- 每次写完重要内容后导出一次 ZIP。
- 至少每周导出一次 ZIP。
- 换浏览器、换电脑、升级系统、清理浏览器数据、改用桌面版之前，先导出 ZIP。
- ZIP 备份建议放到云盘、Git 私有仓库、NAS 或其他你信任的位置。

完整数据 ZIP 里包含：

- `zhuzi-data.json`：可导入恢复的完整数据。
- `markdown/all.md`：全部终稿的 Markdown 汇总。
- `markdown/days/*.md`：每天单独一份 Markdown。

恢复方式：

```text
导出 → 从 ZIP 导入
```

导入会替换当前环境里的本地档案，所以导入前请确认当前环境里没有未备份的重要内容。

## 数据说明

Entry 表示某一天的写作容器；Version 表示每次保存后的完整文本快照。历史版本不可覆盖，只追加。

统计规则：

- 汉字：1 单位
- 标点：1 单位
- 连续数字：合并为 1 个数字 token

例如：

```text
2026年写100字。
```

其中 `2026` 是 1 个数字 token，`100` 也是 1 个数字 token。

## 常用命令

```bash
npm run dev          # 启动网页版开发服务器
npm run build        # 构建静态网页
npm run preview      # 预览构建后的网页
npm run tauri -- dev # 启动桌面开发版
npm run tauri -- build # 构建桌面 App
```

## 设计参考

- PRD：`docs/prd.md`
- 设计参考：`docs/DESIGN-lovable.md`
