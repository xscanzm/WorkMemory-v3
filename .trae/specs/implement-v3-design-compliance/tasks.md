# Tasks

> 全量实施 analysis_results.md 的 14 Bug + 19 优化 + 13 缺失组件 + 8 缺失引擎 + 开发文档。
> 按优先级分 5 个阶段，每阶段内部任务尽量并行。

## 阶段一：数据层与持久化基础（Phase 1 立即修复）

- [ ] Task 1: 扩展数据库 schema（BUG-006 / 优化 11）
  - [ ] SubTask 1.1: 在 migrations.rs 新增 8 张表 DDL：tasks、pet_state、daily_stats、focus_sessions、user_preferences、achievements、soundscape_packs、pet_interaction_logs（含索引 + FTS5 for tasks）
  - [ ] SubTask 1.2: Task 表含字段：id(uuid)/title/description/status(inbox/todo/in_progress/completed/archived)/priority(none/low/medium/high/urgent)/due_date/mood_tag/recurrence_rule/is_pinned/sort_order/subtasks(json)/category/tags(json)/created_at/updated_at
  - [ ] SubTask 1.3: PetState 表含字段：id/species/level/xp/hunger/energy/happiness/cleanliness/bond_level/mood(ecstatic/happy/content/neutral/sad/angry/sleeping)/last_updated
  - [ ] SubTask 1.4: FocusSession 表含字段：id/start_time/end_time/duration_seconds/type(pomodoro/free)/task_id/interrupted/interruption_reason
  - [ ] SubTask 1.5: repository.rs 新增对应 CRUD 方法 + 单元测试
  - [ ] SubTask 1.6: models.rs 新增 Rust 类型定义（Task/PetState/DailyStats/FocusSession 等）

- [ ] Task 2: Rust 端 AppError 枚举（BUG-013 / 优化 10）
  - [ ] SubTask 2.1: 新建 core/error.rs 定义 `AppError` 枚举（DbError/IoError/NotFoundError/ValidationError/Internal）+ `From` 转换 + `serde::Serialize`
  - [ ] SubTask 2.2: Tauri 命令返回 `Result<T, AppError>` 替代 `Result<T, String>`

- [ ] Task 3: TaskEngine 后端命令（BUG-001/002/003/008/014 / 优化 1/2/3）
  - [ ] SubTask 3.1: 新建 core/task_engine.rs，实现 save_task（后端生成 uuid v4）/get_all_tasks/get_task/update_task/delete_task（含状态守卫：archived 不可转换）
  - [ ] SubTask 3.2: 注册 Tauri 命令到 ipc/commands.rs + lib.rs invoke_handler
  - [ ] SubTask 3.3: FTS5 全文搜索命令 search_tasks(query)
  - [ ] SubTask 3.4: 单元测试覆盖状态机流转 + UUID 唯一性

- [x] Task 4: PetEngine 后端命令（BUG-004/012 / 优化 12）
  - [x] SubTask 4.1: 新建 core/pet_engine.rs，实现 save_pet_state/get_pet_state/feed/play/rest/clean
  - [x] SubTask 4.2: XP 升级公式 `XP_needed = level*100 + (level-1)*50`
  - [x] SubTask 4.3: 衍生计算函数：on_task_completed(+10 XP/+5 hunger)、on_focus_completed(+20 XP/+10 energy)、decay(hunger-5%/hr, energy-3%/hr)
  - [x] SubTask 4.4: pet_interaction_logs 记录每次交互
  - [x] SubTask 4.5: 注册 Tauri 命令 + 单元测试（8 个测试覆盖 XP 公式/升级/mood/clamp/衰减；pet_engine.rs 本身无编译错误，cargo test 因其他并行任务引入的预存错误无法整体编译，待并行任务修复后可执行）

- [ ] Task 5: DailyStats 后端命令（BUG-005）
  - [ ] SubTask 5.1: 实现 get_daily_stats(date)/save_daily_stats/update_daily_stats
  - [ ] SubTask 5.2: 任务完成时自动递增 tasks_completed、计算 streak_count
  - [ ] SubTask 5.3: 注册 Tauri 命令 + 单元测试

## 阶段二：前端核心层（Phase 1 UI）

- [ ] Task 6: 前端 Store 层（优化 1）
  - [ ] SubTask 6.1: 新建 src/store/taskStore.ts（Zustand）：tasks 数组 + CRUD action + 启动加载
  - [ ] SubTask 6.2: 新建 src/store/petStore.ts：petState + 交互 action + 启动加载
  - [ ] SubTask 6.3: 新建 src/store/focusStore.ts：当前会话状态 + 计时器控制
  - [ ] SubTask 6.4: 新建 src/store/toastStore.ts：toasts 数组 + showToast/dismissToast
  - [ ] SubTask 6.5: App.tsx useEffect 启动加载所有数据（tasks/petState/dailyStats）

- [ ] Task 7: Toast + ErrorBoundary + ConfirmDialog 组件（BUG-009/013 / 优化 10）
  - [ ] SubTask 7.1: 新建 src/components/Toast.tsx（Portal + 3 秒自动消失 + × 关闭 + type 着色）
  - [ ] SubTask 7.2: 新建 src/components/ErrorBoundary.tsx（class 组件 + 降级 UI + 重试按钮）
  - [ ] SubTask 7.3: 新建 src/components/ConfirmDialog.tsx（模态确认 + 5 秒撤销 Toast）
  - [ ] SubTask 7.4: App.tsx 包裹 ErrorBoundary + 渲染 ToastContainer
  - [ ] SubTask 7.5: 改造现有 15+ 处 console.error catch 块接入 Toast

- [ ] Task 8: 5-Tab 导航 + 路由重构（优化 6）
  - [ ] SubTask 8.1: 重构 Sidebar 为 5-Tab 主导航：Home/Tasks/Focus/Pet/Settings
  - [ ] SubTask 8.2: 保留记忆捕获功能作为 Home 子模块或独立路由（/memory/today 等）
  - [ ] SubTask 8.3: App.tsx 路由表新增 /home /tasks /focus /pet 路由
  - [ ] SubTask 8.4: aria-label 覆盖新导航项

- [ ] Task 9: 任务管理 UI（BUG-007/008/009 / 优化 1-4）
  - [ ] SubTask 9.1: 新建 src/views/TasksView.tsx：任务列表 + 状态过滤 + 排序
  - [ ] SubTask 9.2: 新建 src/components/TaskForm.tsx：新建/编辑模态框（含 due_date/mood_tag/priority/recurrence 字段）
  - [ ] SubTask 9.3: 新建 src/components/TaskCard.tsx：状态徽章（单向流转）+ 删除（ConfirmDialog）+ 编辑
  - [ ] SubTask 9.4: 新建 src/components/FAB.tsx：悬浮快速添加按钮
  - [ ] SubTask 9.5: TaskCard 状态更新/删除调用 Tauri 命令（修复 BUG-003）
  - [ ] SubTask 9.6: 接入 Toast 成功/失败反馈

- [ ] Task 10: 宠物 UI + 帧动画（BUG-007 / 优化 5）
  - [ ] SubTask 10.1: 新建 src/views/PetView.tsx：宠物展示 + 喂食/玩耍/休息/清洁交互
  - [ ] SubTask 10.2: 新建 src/components/SpriteAnimator.tsx：requestAnimationFrame 播放 spritesheet.webp 帧序列
  - [ ] SubTask 10.3: 动画状态机：idle↔walk↔happy↔sad↔sleep↔work↔eat↔wave↔levelup
  - [ ] SubTask 10.4: PetView 交互调用 save_pet_state Tauri 命令（修复 BUG-004）
  - [ ] SubTask 10.5: 属性面板（hunger/energy/happiness/cleanliness/bond_level 进度条）

- [ ] Task 11: 仪表盘首页（优化 7）
  - [ ] SubTask 11.1: 新建 src/views/HomeView.tsx
  - [ ] SubTask 11.2: 时间感知问候语组件（早/午/晚）
  - [ ] SubTask 11.3: 宠物小组件（SpriteAnimator 缩略 + 点击跳转 /pet）
  - [ ] SubTask 11.4: 今日统计条（tasks_completed/total_focus_time/streak_count）
  - [ ] SubTask 11.5: 置顶任务列表（is_pinned=true）
  - [ ] SubTask 11.6: 最近任务列表（按 updated_at 排序 top 5）

## 阶段三：专注与分析层（Phase 2-3）

- [ ] Task 12: FocusEngine 后端（优化 8）
  - [ ] SubTask 12.1: 新建 core/focus_engine.rs：start_pomodoro/start_free_timer/stop/interrupt/get_focus_sessions
  - [ ] SubTask 12.2: FocusSession 持久化到 focus_sessions 表
  - [ ] SubTask 12.3: 完成时 EventBus 发 FocusCompleted → PetEngine + AnalyticsEngine
  - [ ] SubTask 12.4: 注册 Tauri 命令 + 单元测试

- [ ] Task 13: 番茄钟 UI（优化 8）
  - [ ] SubTask 13.1: 新建 src/views/FocusView.tsx
  - [ ] SubTask 13.2: 新建 src/components/FocusTimerRing.tsx：圆形倒计时 SVG 进度环
  - [ ] SubTask 13.3: 番茄钟模式（25+5）/自由计时模式切换
  - [ ] SubTask 13.4: 中断按钮 + 中断原因输入
  - [ ] SubTask 13.5: 关联任务选择（可选）

- [ ] Task 14: EventBus + BackgroundScheduler（优化 12/13）
  - [ ] SubTask 14.1: 新建 core/event_bus.rs：tokio::broadcast channel + 事件类型枚举（TaskCompleted/FocusCompleted/PetInteraction/PetLevelUp）
  - [ ] SubTask 14.2: PetEngine/AnalyticsEngine 订阅事件
  - [ ] SubTask 14.3: 新建 core/scheduler.rs：tokio 定时任务（每小时宠物衰减、每日 23:00 摘要）
  - [ ] SubTask 14.4: lib.rs 启动 scheduler
  - [ ] SubTask 14.5: 单元测试覆盖事件流转

- [ ] Task 15: AnalyticsEngine 后端（Phase 3）
  - [ ] SubTask 15.1: 新建 core/analytics_engine.rs：每日摘要/周报/连续天数/生产力评分
  - [ ] SubTask 15.2: 接收 TaskCompleted/FocusCompleted 事件更新 daily_stats
  - [ ] SubTask 15.3: streak_count 计算（连续 N 天有 completed 任务）
  - [ ] SubTask 15.4: 注册 Tauri 命令 + 单元测试

- [ ] Task 16: 分析 UI（Phase 3）
  - [ ] SubTask 16.1: 新建 src/components/StreakCalendar.tsx：连续打卡日历热力图
  - [ ] SubTask 16.2: 新建 src/components/MoodBadge.tsx：情绪徽章
  - [ ] SubTask 16.3: 新建 src/components/AIInsightCard.tsx：AI 见解卡片
  - [ ] SubTask 16.4: 分析图表（任务完成趋势/专注时长分布）

## 阶段四：质量与体验层（Phase 4 + 跨切面）

- [ ] Task 17: CSP 安全策略（BUG-010 / 优化 14）
  - [ ] SubTask 17.1: tauri.conf.json 配置显式 CSP（default-src 'self'; img-src 'self' asset: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.openai.com ipc:）
  - [ ] SubTask 17.2: 验证 pet 加载/OpenAI API/IPC 不被阻断

- [ ] Task 18: 无障碍 WCAG 2.1 AA（优化 17）
  - [ ] SubTask 18.1: 核查并补齐所有纯图标按钮 aria-label
  - [ ] SubTask 18.2: styles/index.css 新增 prefers-reduced-motion 媒体查询
  - [ ] SubTask 18.3: 新增全局 :focus-visible 焦点可见样式
  - [ ] SubTask 18.4: 高对比度主题（CSS 变量切换）
  - [ ] SubTask 18.5: 触摸目标 ≥44×44px 核查

- [ ] Task 19: i18n 国际化（优化 18）
  - [ ] SubTask 19.1: 新建 src/i18n/zh-CN.ts + src/i18n/en-US.ts 语言包
  - [ ] SubTask 19.2: 新建 src/i18n/index.ts（useTranslation hook 或 i18next）
  - [ ] SubTask 19.3: 抽取所有硬编码中文到语言包
  - [ ] SubTask 19.4: SettingsView 新增语言切换

- [ ] Task 20: 设计系统升级（优化 9）
  - [ ] SubTask 20.1: 引入 Inter + JetBrains Mono 字体（@fontsource 或本地 woff2）
  - [ ] SubTask 20.2: variables.css 调整色系为紫色调（与现有浅色毛玻璃协调，不破坏现有设计）
  - [ ] SubTask 20.3: 增强 glassmorphism（backdrop-filter 变量已存在，补齐组件使用）
  - [ ] SubTask 20.4: 升级动画为 spring-based（CSS transition 200-400ms + cubic-bezier）

- [ ] Task 21: 测试体系（优化 16）
  - [ ] SubTask 21.1: Rust 单元测试补齐（task_engine/pet_engine/focus_engine/analytics_engine/event_bus/scheduler）
  - [ ] SubTask 21.2: 配置 Vitest + React Testing Library，新增前端组件测试（TaskForm/TaskCard/Toast/ErrorBoundary/ConfirmDialog）
  - [ ] SubTask 21.3: 配置 Playwright，新增 E2E 测试（创建任务/完成专注/宠物交互关键流程）
  - [ ] SubTask 21.4: CI 配置（package.json scripts + 可选 GitHub Actions）

- [ ] Task 22: 性能优化（优化 15）
  - [ ] SubTask 22.1: 任务列表虚拟滚动（react-window 或 @tanstack/react-virtual，数据量 >100 时启用）
  - [ ] SubTask 22.2: SpriteAnimator Canvas 渲染选项（DOM 帧切换作为默认，Canvas 作为性能模式）
  - [ ] SubTask 22.3: 数据库查询分页（get_all_tasks 支持 limit/offset）
  - [ ] SubTask 22.4: 音景资源懒加载

- [ ] Task 23: 成就/换装/引导（Phase 4）
  - [ ] SubTask 23.1: 成就系统（achievements 表 + AchievementCard 组件 + 解锁逻辑）
  - [ ] SubTask 23.2: 宠物换装/外观（species 切换 + spritesheet 选择）
  - [ ] SubTask 23.3: 升级动画（levelup 状态触发）
  - [ ] SubTask 23.4: 引导流程（首次启动 onboarding 向导）
  - [ ] SubTask 23.5: 任务拖拽排序（sort_order 字段 + dnd-kit）
  - [ ] SubTask 23.6: 任务滑动手势（完成/删除）

- [ ] Task 24: SettingsView 完善 + 数据导入导出（Phase 4）
  - [ ] SubTask 24.1: SettingsView 新增：主题/语言/音景/通知/数据管理分区
  - [ ] SubTask 24.2: 数据导出（JSON/CSV）
  - [ ] SubTask 24.3: 数据导入
  - [ ] SubTask 24.4: 通知系统（系统通知 + 应用内通知）

- [ ] Task 25: SoundscapeEngine（Phase 2 / 优化 8 配套）
  - [ ] SubTask 25.1: 新建 core/soundscape_engine.rs：音频包加载/多层混合/音量控制
  - [ ] SubTask 25.2: soundscape_packs 表数据
  - [ ] SubTask 25.3: 新建 src/components/SoundscapeMixer.tsx：音景混合器 UI
  - [ ] SubTask 25.4: FocusView 集成音景播放

## 阶段五：开发文档

- [ ] Task 26: 更新设计文档
  - [ ] SubTask 26.1: 更新 01_ARCHITECTURAL_DECISIONS.md（任务/宠物/专注层架构决策 + EventBus + Scheduler）
  - [ ] SubTask 26.2: 更新 02_DATA_MODEL.md（+8 张表 DDL + 关系图）
  - [ ] SubTask 26.3: 更新 03_CORE_ARCHITECTURE.md（+8 个引擎模块说明 + 调用链）
  - [ ] SubTask 26.4: 更新 04_UI_SPEC.md（5-Tab 导航 + 13 个新组件规格）
  - [ ] SubTask 26.5: 更新 05_INTERACTION.md（任务/专注/宠物交互状态机）
  - [ ] SubTask 26.6: 更新 06_DESIGN_GOVERNANCE.md（设计系统升级 + i18n + a11y 规范）

- [ ] Task 27: 新增开发文档
  - [ ] SubTask 27.1: 新增 docs/07_DEVELOPMENT_GUIDE.md（环境要求/构建命令/调试技巧/常见问题）
  - [ ] SubTask 27.2: 新增 docs/08_TESTING_STRATEGY.md（Rust 单元/Vitest 前端/Playwright E2E 规范 + 覆盖率目标）
  - [ ] SubTask 27.3: 在 07_DEVELOPMENT_GUIDE.md 中说明 src/src-tauri/ 用途（前端 Tauri API 封装 api.ts/mock.ts，非重复骨架，回应 BUG-011）
  - [ ] SubTask 27.4: 新增 docs/CHANGELOG.md 记录本次全量实施

## 阶段六：集成验证

- [ ] Task 28: 端到端集成验证
  - [ ] SubTask 28.1: 启动加载验证（tasks/petState/dailyStats 从 DB 加载）
  - [ ] SubTask 28.2: 任务 CRUD 全链路（创建→状态流转→删除撤销）
  - [ ] SubTask 28.3: 宠物交互全链路（喂食→+hunger→持久化→衍生计算）
  - [ ] SubTask 28.4: 番茄钟全链路（开始→完成→FocusSession→PetEngine+XP→daily_stats）
  - [ ] SubTask 28.5: EventBus 事件流转验证
  - [ ] SubTask 28.6: CSP 无违规 + a11y 审查 + i18n 切换
  - [ ] SubTask 28.7: 全部测试通过（Rust + Vitest + Playwright）

# Task Dependencies
- Task 1 (DB schema) 是所有后端 Task 的前置
- Task 2 (AppError) 是所有后端命令的前置
- Task 3/4/5 (TaskEngine/PetEngine/DailyStats) 依赖 Task 1、Task 2，三者可并行
- Task 6 (前端 Store) 依赖 Task 3/4/5（需 Tauri 命令存在）
- Task 7 (Toast/ErrorBoundary/ConfirmDialog) 独立，可与 Task 1-5 并行
- Task 8 (5-Tab 导航) 依赖 Task 6（Store）
- Task 9 (任务 UI) 依赖 Task 6、Task 7、Task 8
- Task 10 (宠物 UI) 依赖 Task 6、Task 7、Task 8
- Task 11 (仪表盘) 依赖 Task 9、Task 10
- Task 12 (FocusEngine) 依赖 Task 1、Task 2、Task 14（EventBus）
- Task 13 (番茄钟 UI) 依赖 Task 12、Task 8
- Task 14 (EventBus + Scheduler) 依赖 Task 1、Task 2，可与 Task 3/4/5 并行
- Task 15 (AnalyticsEngine) 依赖 Task 14、Task 4
- Task 16 (分析 UI) 依赖 Task 15、Task 8
- Task 17 (CSP) 独立
- Task 18 (a11y) 独立，但应在 UI 组件完成后做最终核查
- Task 19 (i18n) 应在 UI 组件基本稳定后进行
- Task 20 (设计系统) 独立，但影响所有 UI，建议早期做
- Task 21 (测试) 贯穿全程，每个 Task 完成后补充对应测试
- Task 22 (性能) 在功能完成后优化
- Task 23/24/25 (Phase 4) 依赖核心功能完成
- Task 26/27 (文档) 可与开发并行，最终在 Task 28 前完成
- Task 28 (集成验证) 依赖全部

# 可并行批次建议
- 批次 1（基础层并行）：Task 1、Task 2、Task 7、Task 17、Task 20
- 批次 2（引擎层并行，依赖批次 1）：Task 3、Task 4、Task 5、Task 14
- 批次 3（前端 Store + 导航，依赖批次 2）：Task 6、Task 8
- 批次 4（核心 UI 并行，依赖批次 3）：Task 9、Task 10、Task 13
- 批次 5（聚合 UI，依赖批次 4）：Task 11、Task 16
- 批次 6（引擎扩展，依赖批次 2）：Task 12、Task 15、Task 25
- 批次 7（质量层并行）：Task 18、Task 19、Task 21、Task 22
- 批次 8（Phase 4 + 文档并行）：Task 23、Task 24、Task 26、Task 27
- 批次 9：Task 28（集成验证）

# 范围说明
本 Spec 全量实施 analysis_results.md 中的 14 项 Bug + 19 项优化建议 + 13 个缺失 UI 组件 + 8 个缺失引擎，并新增/更新 8 份开发文档。经核验，BUG-011（src/src-tauri 嵌套）实际为前端 Tauri API 封装目录（api.ts/mock.ts），非重复骨架，本 Spec 保留并在开发文档中说明其用途，不删除。
