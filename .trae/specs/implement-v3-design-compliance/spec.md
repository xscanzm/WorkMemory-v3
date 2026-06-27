# WorkMemory-v3 设计合规全量实施 Spec

## Why
`analysis_results.md` 审查报告对比 11 份设计文档与实际代码，发现 14 项 Bug、19 项优化建议、13 个缺失 UI 组件、8 个缺失引擎。当前工作区已实现"工作记忆捕获"层（segments/clean_episodes + OCR + Mascot），但**任务/宠物/专注/仪表盘/分析**等设计文档要求的核心功能层完全缺失。本 Spec 全量实施所有项目，使 WorkMemory-v3 达到设计文档要求的完整功能形态，并新增/更新开发文档。

## 范围基线核验（当前工作区真实状态）
- ✅ 已存在：OCR 捕获管线、segments/clean_episodes/memory_cells/embeddings/wiki_pages/reports 表、MascotSprite spritesheet 帧动画、WAL+FTS5+索引、repository_tests/ocr/capture/distill/url_util 测试、aria-label 30+ 处、浅色毛玻璃设计系统、backdrop-filter
- ❌ 完全缺失（本 Spec 全量新建）：tasks/pet_state/daily_stats/focus_sessions/user_preferences/achievements/soundscape_packs/pet_interaction_logs 表；TaskForm/TaskCard/PetView/FocusTimerView/DashboardView 组件；5-Tab 导航；番茄钟；EventBus；BackgroundScheduler；Toast/ErrorBoundary；CSP；prefers-reduced-motion；i18n；删除确认对话框

## What Changes

### A. Bug 修复（14 项）
- **BUG-001~005 数据持久化断裂**：新建 tasks/pet_state/daily_stats 表 + Tauri 命令 + App.tsx 启动加载 + 所有操作写入 DB
- **BUG-006 数据模型字段缺失**：扩展 Task（inbox/archived 状态、none/urgent 优先级、due_date/mood_tag/recurrence_rule/is_pinned/sort_order/subtasks）、PetState（species/cleanliness/bond_level/7 种 mood）、新增 Category/Tag/FocusSession/UserPreferences/Achievement/SoundscapePack/PetInteractionLog 表
- **BUG-007 宠物动画用 emoji**：新建 PetView 使用 spritesheet 帧动画（资源已在 src-tauri/resources/pet/1-9/）
- **BUG-008 任务状态循环**：实现单向状态机 inbox→todo→in_progress→completed→archived
- **BUG-009 删除无确认**：新建 ConfirmDialog 组件 + 5 秒撤销 Toast
- **BUG-010 CSP=null**：配置显式 CSP 策略
- **BUG-011 嵌套 src-tauri**：核验后保留（src/src-tauri/ 实为前端 Tauri API 封装 api.ts/mock.ts，非重复骨架）；在开发文档中说明其用途
- **BUG-012 XP 公式**：实现 `XP_needed = level * 100 + (level - 1) * 50`
- **BUG-013 无错误处理**：新建 AppError 枚举 + ErrorBoundary + Toast + 操作反馈
- **BUG-014 Task ID 用 Date.now()**：改用 uuid v4（后端生成）

### B. 优化建议（19 项）
- **优化 1-4**：数据启动加载、持久化修复、UUID、删除确认（与 Bug 合并）
- **优化 5**：宠物帧动画 SpriteAnimator 组件 + 状态机
- **优化 6**：5-Tab 导航（Home/Tasks/Focus/Pet/Settings）
- **优化 7**：仪表盘首页（问候语、宠物小组件、今日统计、置顶任务、最近任务）
- **优化 8**：番茄钟计时器（FocusEngine）
- **优化 9**：设计系统升级（Inter + JetBrains Mono 字体、紫色调、glassmorphism、spring 动画）
- **优化 10**：错误处理体系（与 BUG-013 合并）
- **优化 11**：数据库优化（tasks 表索引、FTS5；现有 segments 已有）
- **优化 12**：宠物状态衍生引擎（完成任务→+XP、专注→+XP、时间衰减）
- **优化 13**：EventBus 模式（TaskCompleted→PetEngine→AnalyticsEngine）
- **优化 14**：CSP（与 BUG-010 合并）
- **优化 15**：性能优化（虚拟滚动、Canvas 渲染、分页、懒加载）
- **优化 16**：测试体系（Rust 单元 + Vitest 前端 + Playwright E2E）
- **优化 17**：无障碍 WCAG 2.1 AA（aria-label 补齐、键盘导航、prefers-reduced-motion、高对比度、触摸目标 ≥44px）
- **优化 18**：i18n 国际化（抽取语言包）
- **优化 19**：清理重复目录（核验后保留 src/src-tauri/，文档说明用途）

### C. 缺失 UI 组件（13 个）
FAB、FocusTimerRing、PetAvatar、StatBar（渐变）、MoodBadge、AchievementCard、SoundscapeMixer、StreakCalendar、AIInsightCard、Toast/Snackbar、问候语、任务滑动手势、拖拽排序

### D. 缺失引擎（8 个）
TaskEngine（验证/状态守卫/FTS5/批量/重复）、FocusEngine（番茄钟/自由计时/会话/中断）、PetEngine（衍生计算/衰减/动画状态机）、AnalyticsEngine（每日摘要/周报/连续天数/生产力评分）、AIEngine（本地 LLM/提示词模板）、SoundscapeEngine（音频包/多层混合）、EventBus、BackgroundScheduler

### E. 开发文档（新增/更新）
- 更新 `docs/01_ARCHITECTURAL_DECISIONS.md`：新增任务/宠物/专注层架构决策
- 更新 `docs/02_DATA_MODEL.md`：新增 8 张表 DDL
- 更新 `docs/03_CORE_ARCHITECTURE.md`：新增 8 个引擎模块说明
- 更新 `docs/04_UI_SPEC.md`：5-Tab 导航 + 13 个新组件规格
- 新增 `docs/07_DEVELOPMENT_GUIDE.md`：开发环境、构建、测试、调试指南
- 新增 `docs/08_TESTING_STRATEGY.md`：测试体系规范

## Impact
- Affected code（新建为主）：
  - `src-tauri/src/db/migrations.rs`（+8 张表 DDL）
  - `src-tauri/src/models.rs`（+Task/PetState/FocusSession 等类型）
  - `src-tauri/src/ipc/commands.rs`（+20+ Tauri 命令）
  - `src-tauri/src/core/`（+task_engine.rs/focus_engine.rs/pet_engine.rs/analytics_engine.rs/ai_engine.rs/soundscape_engine.rs/event_bus.rs/scheduler.rs）
  - `src/components/`（+TaskForm/TaskCard/PetView/FocusTimerView/DashboardView/ConfirmDialog/Toast/ErrorBoundary/FAB/StatBar/MoodBadge/AchievementCard/SoundscapeMixer/StreakCalendar/AIInsightCard/SpriteAnimator）
  - `src/views/`（+HomeView/TasksView/FocusView/PetView/SettingsView 扩展）
  - `src/store/`（+taskStore/petStore/focusStore/toastStore）
  - `src/i18n/`（新建语言包）
  - `src-tauri/tauri.conf.json`（CSP）
  - `src/styles/`（设计系统升级）
  - `docs/`（6 份文档新增/更新）

## ADDED Requirements

### Requirement: 任务管理层（TaskEngine）
系统 SHALL 提供 Task 实体的完整 CRUD，SHALL 支持单向状态机 inbox→todo→in_progress→completed→archived，SHALL 使用 uuid v4 生成 ID，SHALL 支持 due_date/mood_tag/recurrence_rule/is_pinned/sort_order/subtasks 字段，SHALL 提供 FTS5 全文搜索，SHALL 在前端启动时从 DB 加载所有任务。

#### Scenario: 任务创建持久化
- **WHEN** 用户在 TaskForm 创建任务并提交
- **THEN** 后端生成 uuid v4 作为 ID，写入 tasks 表
- **AND** 前端 store 同步更新
- **AND** 失败时 Toast 显示错误

#### Scenario: 任务状态单向流转
- **WHEN** 用户点击 completed 任务的徽章
- **THEN** 状态变为 archived（而非循环回 inbox）
- **AND** archived 状态不可再转换

#### Scenario: 删除确认
- **WHEN** 用户点击删除任务
- **THEN** 弹出 ConfirmDialog 确认
- **AND** 确认后删除并显示 5 秒撤销 Toast

### Requirement: 宠物层（PetEngine）
系统 SHALL 使用 spritesheet 帧动画渲染宠物（非 emoji），SHALL 实现 9 种动画状态（idle/walk/happy/sad/sleep/work/eat/wave/levelup），SHALL 支持衍生计算（完成任务→+XP/+hunger、专注→+XP/+energy、时间衰减 hunger-5%/hr energy-3%/hr），SHALL 使用 `XP_needed = level*100 + (level-1)*50` 公式，SHALL 持久化所有交互到 pet_state 表，SHALL 支持 species/cleanliness/bond_level/7 种 mood 字段。

#### Scenario: 完成任务自动奖励宠物
- **WHEN** 任务状态变为 completed
- **THEN** EventBus 发出 TaskCompleted 事件
- **AND** PetEngine 接收并 +10 XP、+5 hunger
- **AND** 若 XP 达升级阈值，触发 levelup 动画

#### Scenario: 宠物状态衰减
- **WHEN** BackgroundScheduler 每小时触发
- **THEN** PetEngine 计算 hunger -= 5%、energy -= 3%
- **AND** 持久化到 pet_state 表

### Requirement: 专注层（FocusEngine）
系统 SHALL 提供番茄钟计时器（25 分钟工作 + 5 分钟休息），SHALL 提供自由计时器，SHALL 记录 FocusSession（开始/结束/中断/时长），SHALL 在专注完成时通过 EventBus 通知 PetEngine +XP、AnalyticsEngine 更新统计。

#### Scenario: 番茄钟完成
- **WHEN** 25 分钟工作计时结束
- **THEN** 创建 FocusSession 记录写入 focus_sessions 表
- **AND** EventBus 发出 FocusCompleted 事件
- **AND** PetEngine +20 XP、+10 energy
- **AND** daily_stats.total_focus_time += 25 分钟

### Requirement: 仪表盘首页
系统 SHALL 提供时间感知问候语，SHALL 展示宠物小组件（可点击进入宠物页），SHALL 展示今日统计条（完成任务数/专注时长/连续天数），SHALL 展示置顶任务，SHALL 展示最近任务列表。

### Requirement: 5-Tab 导航
系统 SHALL 提供 Home/Tasks/Focus/Pet/Settings 五个 Tab，SHALL 在底部或侧边导航栏展示。

### Requirement: 错误处理体系
系统 SHALL 在 Rust 端定义 AppError 枚举（DbError/IoError/NotFoundError/ValidationError），SHALL 在前端提供 ErrorBoundary 捕获渲染异常，SHALL 提供 Toast 通知组件（success/error/info），SHALL 将所有 console.error catch 块升级为 Toast 反馈。

### Requirement: CSP 安全策略
系统 SHALL 配置非空 CSP，SHALL 允许 self/asset/ipc/OpenAI API，SHALL 禁止外部脚本/样式注入。

### Requirement: 无障碍支持 WCAG 2.1 AA
系统 SHALL 为所有交互元素提供 aria-label，SHALL 支持键盘导航，SHALL 响应 prefers-reduced-motion，SHALL 提供高对比度主题，SHALL 确保触摸目标 ≥44×44px。

### Requirement: i18n 国际化
系统 SHALL 将所有硬编码中文抽取为语言包，SHALL 支持至少 zh-CN 和 en-US 两种语言，SHALL 提供语言切换设置。

### Requirement: 测试体系
系统 SHALL 提供 Rust 单元测试（覆盖所有引擎），SHALL 提供 Vitest 前端组件测试，SHALL 提供 Playwright E2E 测试（覆盖关键用户流程）。

### Requirement: EventBus 模式
系统 SHALL 提供事件总线机制用于模块间通信，SHALL 支持 TaskCompleted/FocusCompleted/PetInteraction/PetLevelUp 等事件类型，SHALL 降低模块间耦合。

### Requirement: BackgroundScheduler
系统 SHALL 提供后台调度器，SHALL 定时执行宠物衰减（每小时）、每日摘要生成（每日 23:00），SHALL 不阻塞主线程。

### Requirement: 设计系统升级
系统 SHALL 引入 Inter + JetBrains Mono 字体，SHALL 调整色系为文档规范的紫色调（与现有浅色毛玻璃设计协调），SHALL 增强 glassmorphism 效果，SHALL 升级动画为 spring-based（200-400ms）。

### Requirement: 开发文档
系统 SHALL 更新 01-06 设计文档以反映任务/宠物/专注层，SHALL 新增 07_DEVELOPMENT_GUIDE.md（环境/构建/测试/调试），SHALL 新增 08_TESTING_STRATEGY.md（测试规范），SHALL 在文档中说明 src/src-tauri/ 用途（前端 Tauri API 封装，非重复骨架）。

## MODIFIED Requirements

### Requirement: 应用导航结构
现有 Sidebar 8 项导航（今日/日历/搜索/洞察/Wiki/图谱/报告/设置）修改为 5-Tab 主导航（Home/Tasks/Focus/Pet/Settings），原有记忆捕获功能整合到 Home 或作为子页面保留。

### Requirement: tauri.conf.json 安全配置
`"csp": null` 修改为显式 CSP 策略字符串。

## REMOVED Requirements

### Requirement: emoji 宠物表示
**Reason**: 设计文档要求 spritesheet 帧动画，emoji 表示不符合规范
**Migration**: 所有 emoji 宠物渲染替换为 SpriteAnimator 组件读取 resources/pet/{id}/spritesheet.webp
