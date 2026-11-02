<div align="center">
  <img src="./focus-mind/public/app-icon.png" width="112" alt="土豆栗丝特应用图标" />
  <h1>土豆栗丝特</h1>
  <p>把想做的大项目拆成能落地的任务，再用日程、专注和统计慢慢完成。</p>
</div>

土豆栗丝特是一款本地优先的 macOS 任务与专注管理应用。它以「主题 → 目标 → 任务」组织生活和项目，把计划安排到日、周、月日程中，并通过专注计时与统计回顾执行情况。

## 功能

- **主题与目标**：用主题颜色区分不同生活领域，将长期目标继续拆成具体任务。
- **灵活任务计划**：支持一次性任务、每日重复、每周次数，以及为每日重复排除指定星期。
- **日程视图**：提供日、周、月三种视图；未设置日期的任务不会进入日程。
- **专注计时**：为当天任务记录专注时间，并可编辑已有专注片段。
- **完成记录**：任务可直接完成；没有专注记录时，会自动补充一段不与现有记录重叠的 15 分钟记录。
- **专注统计**：按日、周、月、年查看专注时长、完成任务数、热力图、主题分布与专注趋势。
- **悬浮待办**：桌面悬浮球显示今日未完成数量，展开后可按主题查看、勾选任务或直接开始专注。
- **本地数据与备份**：桌面数据保存在本机 SQLite 数据库中，启动时自动创建每日备份。

## 技术栈

- React 19 + TypeScript
- Tauri 2 + Rust
- SQLite
- Vite + Vitest + Playwright

## 本地运行

环境要求：Node.js 20+、pnpm 10+、Rust stable，以及 macOS/Xcode Command Line Tools。

```bash
cd focus-mind
pnpm install
pnpm dev
```

`pnpm dev` 启动浏览器预览。浏览器使用内存数据，仅用于界面预览和开发，刷新后会重置。

启动桌面版：

```bash
pnpm tauri dev
```

## 验证与构建

```bash
pnpm lint
pnpm exec vitest run
pnpm build
pnpm exec tauri build
```

如需运行端到端测试，首次使用前安装 Chromium：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

macOS 安装包通常生成在：

```text
focus-mind/src-tauri/target/release/bundle/dmg/
```

## 数据与隐私

土豆栗丝特没有账号系统，也不会把任务或专注记录上传到服务器。桌面数据库位于 Tauri 应用数据目录，macOS 通常为：

```text
~/Library/Application Support/com.focusmind.desktop/focus-mind.db
```

自动备份保存在同一目录下的 `backups/` 文件夹。数据库、备份、构建产物和本地演示脚本均已通过 `.gitignore` 排除，不会提交到代码仓库。

## 当前范围

当前版本面向 macOS，本地单人使用；暂不包含云同步、多人协作、移动端客户端或系统小组件。
