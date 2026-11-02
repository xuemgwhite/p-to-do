# Focus Mind

Focus Mind 是一个本地优先的 macOS 主题、目标、任务、日程和专注计时应用。Tauri 桌面版使用 SQLite；普通浏览器运行的是内存预览仓库，刷新页面会恢复演示数据。

## 环境要求

- Node.js 20+ 与 pnpm 10+
- 桌面构建需要 Rust stable、macOS/Xcode Command Line Tools，以及 Tauri 2 的系统依赖
- 首次运行端到端测试前执行 `pnpm exec playwright install chromium`

安装依赖后，运行 `pnpm dev` 打开浏览器预览，或运行 `pnpm tauri dev` 启动桌面应用。预览路由为 `/`（主题）、`/?page=schedule`（日程）和 `/?page=timer`（计时）。

## 验证与构建

```bash
pnpm vitest run
pnpm test:e2e
pnpm tsc --noEmit
pnpm build
pnpm tauri build --debug
```

也可用 `pnpm playwright test tests/e2e/focus-mind.spec.ts` 仅运行关键验收路径。Playwright 会自动启动确定端口的 Vite 服务，并在 1280×800 的 Chromium 视口中检查实体创建、日/周/月日程、计时入口及浏览器 console/page error。

桌面数据库位于 Tauri 应用数据目录中的 `focus-mind.db`；macOS 通常为 `~/Library/Application Support/com.focusmind.desktop/`。备份位于应用数据目录下的 `backups/`，启动桌面版时会创建每日备份。浏览器预览不写 SQLite、不创建备份，也不保证刷新后的数据持久化。

若应用发现未结束的专注记录，会在启动时显示恢复对话框，可继续或结束该记录。调试构建产物由 Tauri 输出到 `src-tauri/target/debug/bundle/`（macOS 通常为 `macos/Focus Mind.app`）。

## 已知范围

当前版本不包含服务器同步、多人协作、iPad 客户端或 WidgetKit 小组件。浏览器模式仅用于 UI 与验收预览；文件备份、系统对话框、SQLite 持久化和原生打包只在 Tauri 桌面环境可用。
