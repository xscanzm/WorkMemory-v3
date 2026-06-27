# Changelog

All notable changes to WorkMemory-v3 are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> 本变更日志记录 WorkMemory-v3 全量实施（对应 `analysis_results.md` 的 14 Bug + 19 优化 + 13 缺失组件 + 8 缺失引擎）。
> 详细开发与测试操作分别见 `10_DEVELOPMENT_GUIDE.md` 与 `11_TESTING_STRATEGY.md`。

## [Unreleased]

### Added

- Playwright E2E 测试框架与关键流程用例（创建任务→完成→streak、专注会话→XP、宠物交互→hunger），对应 `tasks.md` SubTask 21.3（计划中）
- Windows 构建前置条件文档（`10_DEVELOPMENT_GUIDE.md` 新增「Windows 构建注意事项」章节：SDK 版本/RC.EXE 编码/中文路径/MSI/WiX/透明窗口/windows crate 版本对齐）
- GitHub Actions CI 工作流（`.github/workflows/ci.yml`：Windows + Ubuntu matrix，typecheck + Vitest + cargo test + tauri build）
- `tauri.conf.json` NSIS/WiX 安装包语言配置（`bundle.windows.nsis.languages: [SimpChinese, English]`、`bundle.windows.wix.language: [zh-CN, en-US]`、`installMode: perMachine`）

### Changed

- `windows` crate 0.58 → 0.61（对齐 Tauri 2.11.3 依赖树，消除 0.58/0.61 双版本重复编译；`Cargo.toml` `[target.'cfg(target_os = "windows")'.dependencies]`）
- 性能优化：任务列表虚拟滚动、SpriteAnimator Canvas 渲染、DB 查询分页、音景资源懒加载（对应 Task 22，计划中）
- 成就/换装/引导流程与任务拖拽/滑动手势（对应 Task 23，计划中）
- SettingsView 数据导入导出与通知系统（对应 Task 24，计划中）

### Fixed

- 修复 `src-tauri/src/ipc/commands.rs` 中 `core::stats_engine`/`capture`/`distill`/`report`/`embedding` 裸模块路径解析为外部 `core` crate 的预存编译问题（详见 `10_DEVELOPMENT_GUIDE.md` §6 Q1，待修复）

## [3.0.0] - 2026-06-27

### Added

- TaskEngine：完整 CRUD + 单向状态机（inbox→todo→in_progress→completed→archived）+ FTS5 全文搜索 + uuid v4 ID
- PetEngine：精灵图帧动画（9 状态）、XP 公式 `level*100 + (level-1)*50`、衍生计算（task→+10XP/+5hunger，focus→+20XP/+10energy）、按小时衰减
- FocusEngine：pomodoro（25+5）与 free 计时模式、FocusSession 持久化、中断处理
- AnalyticsEngine：streak 连续天数、weekly stats、生产力评分、daily_stats upsert
- SoundscapeEngine：多层音频包加载与 enable/disable 切换
- EventBus：基于 `tokio::broadcast` channel 的事件总线（TaskCompleted/FocusCompleted/PetInteraction/PetLevelUp）
- BackgroundScheduler：每小时宠物衰减 + 每日 23:00 摘要调度
- 8 张新数据库表：tasks、pet_state、daily_stats、focus_sessions、user_preferences、achievements、soundscape_packs、pet_interaction_logs
- 13 个新 UI 组件：FAB、TaskForm、TaskCard、Toast、ErrorBoundary、ConfirmDialog、StreakCalendar、MoodBadge、AIInsightCard、SoundscapeMixer、PetSpriteDisplay、AchievementCard、OnboardingWizard
- 5 个新视图：HomeView、TasksView、FocusView、PetView（替换原 emoji 实现）、增强版 SettingsView
- 5-Tab 混合导航（Home/Tasks/Focus/Pet + 7 个记忆项 + Settings）
- i18n：轻量 React Context 国际化，含 zh-CN/en-US 语言包，持久化到 localStorage
- a11y：prefers-reduced-motion、:focus-visible、aria-label 覆盖、≥44px 触摸目标
- 设计系统：Inter + JetBrains Mono 字体、spring-based 动画、glassmorphism 工具类
- Vitest 测试套件（23 个测试）+ Rust 单元测试（34 个测试）
- 3 份新开发文档：`10_DEVELOPMENT_GUIDE.md`、`11_TESTING_STRATEGY.md`、`CHANGELOG.md`
- 更新 6 份设计文档（01-06）以反映 v3 架构

### Changed

- CSP：从 `null` 改为显式策略（允许 self/asset/ipc/https://api.openai.com）
- AppError：Tauri 命令返回 `Result<T, AppError>` 替代 `Result<T, String>`
- 任务 ID：从 `Date.now()` 改为 uuid v4（后端生成）
- 宠物渲染：从 emoji 改为精灵图帧动画
- 侧边栏：从扁平 8 项列表改为 5-Tab 混合 3 分组布局
- 错误处理：所有 `console.error` catch 块升级为 Toast 反馈

### Deprecated

- 无

### Removed

- 无

### Fixed

- BUG-001~005：数据持久化（tasks/pet_state/daily_stats 现持久化到 DB）
- BUG-006：数据模型字段补齐（完整 Task/PetState/FocusSession schema）
- BUG-007：宠物动画改用精灵图（非 emoji）
- BUG-008：任务状态机改为单向流转（无环路）
- BUG-009：删除任务增加 ConfirmDialog 确认 + 5s 撤销 Toast
- BUG-010：CSP 显式配置
- BUG-012：XP 公式修正为 `level*100 + (level-1)*50`
- BUG-013：错误处理改用 AppError + ErrorBoundary + Toast
- BUG-014：任务 ID 改用 uuid v4（非 Date.now()）

### Security

- 显式 CSP 阻止外部脚本/样式注入

### Notes

- BUG-011（`src/src-tauri/` 嵌套目录）经核实为前端 Tauri API 封装层（`api.ts`/`mock.ts`），属设计模式而非 Bug，予以保留并在 `10_DEVELOPMENT_GUIDE.md` §6 Q2 中说明用途。
- 已知预存问题：`src-tauri/src/ipc/commands.rs` 中 `core::stats_engine`/`capture`/`distill`/`report`/`embedding` 等裸模块路径会被解析为外部 `core` crate，导致 `cargo build`/`cargo test` 整体编译失败。临时修复见 `10_DEVELOPMENT_GUIDE.md` §6 Q1。

[3.0.0]: https://keepachangelog.com/en/1.1.0/
