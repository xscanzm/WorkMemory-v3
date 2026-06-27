# Checklist

## 一、数据层与持久化基础（BUG-001~006/014 / 优化 1/2/3/11）
- [ ] migrations.rs 新增 8 张表 DDL（tasks/pet_state/daily_stats/focus_sessions/user_preferences/achievements/soundscape_packs/pet_interaction_logs）
- [ ] Task 表含完整字段：id(uuid)/title/status(inbox/todo/in_progress/completed/archived)/priority(none/low/medium/high/urgent)/due_date/mood_tag/recurrence_rule/is_pinned/sort_order/subtasks
- [ ] PetState 表含字段：species/level/xp/hunger/energy/happiness/cleanliness/bond_level/mood(7 种)
- [ ] FocusSession 表含字段：start_time/end_time/duration_seconds/type/interrupted/interruption_reason/task_id
- [ ] tasks 表 FTS5 全文搜索虚拟表 + 索引（status/priority/category/date）
- [ ] repository.rs 新增对应 CRUD 方法 + 单元测试
- [ ] models.rs 新增 Rust 类型定义
- [ ] AppError 枚举定义（DbError/IoError/NotFoundError/ValidationError/Internal）+ Serialize
- [ ] Tauri 命令返回 Result<T, AppError>

## 二、TaskEngine（BUG-001/002/003/008/014 / 优化 1/2/3）
- [ ] save_task 后端生成 uuid v4（非 Date.now()）
- [ ] get_all_tasks/get_task/update_task/delete_task 命令实现
- [ ] 状态机单向流转：inbox→todo→in_progress→completed→archived（archived 不可转换）
- [ ] search_tasks FTS5 全文搜索命令
- [ ] 命令注册到 invoke_handler
- [ ] 单元测试覆盖状态机 + UUID 唯一性

## 三、PetEngine（BUG-004/012 / 优化 12）
- [x] save_pet_state/get_pet_state/feed/play/rest/clean 命令
- [x] XP 升级公式 `XP_needed = level*100 + (level-1)*50`
- [x] 衍生计算：on_task_completed(+10 XP/+5 hunger)、on_focus_completed(+20 XP/+10 energy)
- [x] 时间衰减：hunger-5%/hr、energy-3%/hr
- [x] pet_interaction_logs 记录每次交互
- [x] 单元测试覆盖 XP/衰减/衍生计算（8 个测试；pet_engine.rs 无编译错误，cargo test 待并行任务修复预存错误后可执行）

## 四、DailyStats（BUG-005）
- [ ] get_daily_stats/save_daily_stats/update_daily_stats 命令
- [ ] 任务完成自动递增 tasks_completed
- [ ] streak_count 连续天数计算
- [ ] 单元测试

## 五、前端 Store + 启动加载（优化 1）
- [ ] taskStore.ts（tasks 数组 + CRUD action）
- [ ] petStore.ts（petState + 交互 action）
- [ ] focusStore.ts（当前会话状态 + 计时器控制）
- [ ] toastStore.ts（toasts + showToast/dismissToast）
- [ ] App.tsx useEffect 启动加载 tasks/petState/dailyStats

## 六、错误反馈体系（BUG-009/013 / 优化 10）
- [ ] Toast.tsx 组件（Portal + 3 秒自动消失 + × 关闭 + type 着色）
- [ ] ErrorBoundary.tsx 组件（class + 降级 UI + 重试按钮）
- [ ] ConfirmDialog.tsx 组件（模态确认 + 5 秒撤销 Toast）
- [ ] App.tsx 包裹 ErrorBoundary + 渲染 ToastContainer
- [ ] 现有 15+ 处 console.error catch 块接入 Toast
- [ ] 成功操作（generateReport/saveToWiki 等）接入 success Toast

## 七、5-Tab 导航 + 路由（优化 6）
- [ ] Sidebar 重构为 5-Tab：Home/Tasks/Focus/Pet/Settings
- [ ] 记忆捕获功能保留为子模块或独立路由
- [ ] 路由表新增 /home /tasks /focus /pet
- [ ] 新导航项 aria-label 覆盖

## 八、任务管理 UI（BUG-007/008/009 / 优化 1-4）
- [ ] TasksView.tsx（列表 + 状态过滤 + 排序）
- [ ] TaskForm.tsx（新建/编辑模态，含 due_date/mood_tag/priority/recurrence 字段）
- [ ] TaskCard.tsx（状态徽章单向流转 + 删除 ConfirmDialog + 编辑）
- [ ] FAB.tsx（悬浮快速添加）
- [ ] TaskCard 状态更新/删除调用 Tauri 命令（修复 BUG-003）
- [ ] 接入 Toast 成功/失败反馈

## 九、宠物 UI + 帧动画（BUG-007 / 优化 5）
- [ ] PetView.tsx（宠物展示 + 喂食/玩耍/休息/清洁交互）
- [ ] SpriteAnimator.tsx（requestAnimationFrame 播放 spritesheet.webp）
- [ ] 动画状态机：idle/walk/happy/sad/sleep/work/eat/wave/levelup
- [ ] PetView 交互调用 save_pet_state（修复 BUG-004）
- [ ] 属性面板（hunger/energy/happiness/cleanliness/bond_level 进度条）
- [ ] emoji 宠物表示全部替换为 SpriteAnimator

## 十、仪表盘首页（优化 7）
- [ ] HomeView.tsx
- [ ] 时间感知问候语（早/午/晚）
- [ ] 宠物小组件（SpriteAnimator 缩略 + 点击跳转）
- [ ] 今日统计条（tasks_completed/total_focus_time/streak_count）
- [ ] 置顶任务列表（is_pinned=true）
- [ ] 最近任务列表（top 5 by updated_at）

## 十一、FocusEngine + 番茄钟（优化 8）
- [ ] focus_engine.rs（start_pomodoro/start_free_timer/stop/interrupt/get_focus_sessions）
- [ ] FocusSession 持久化
- [ ] 完成时 EventBus 发 FocusCompleted → PetEngine + AnalyticsEngine
- [ ] FocusView.tsx
- [ ] FocusTimerRing.tsx（SVG 圆形倒计时进度环）
- [ ] 番茄钟(25+5)/自由计时模式切换
- [ ] 中断按钮 + 原因输入
- [ ] 关联任务选择
- [ ] 单元测试

## 十二、EventBus + BackgroundScheduler（优化 12/13）
- [ ] event_bus.rs（tokio::broadcast + 事件类型枚举）
- [ ] PetEngine/AnalyticsEngine 订阅事件
- [ ] scheduler.rs（每小时宠物衰减、每日 23:00 摘要）
- [ ] lib.rs 启动 scheduler
- [ ] 单元测试覆盖事件流转

## 十三、AnalyticsEngine + 分析 UI（Phase 3）
- [ ] analytics_engine.rs（每日摘要/周报/连续天数/生产力评分）
- [ ] 接收事件更新 daily_stats
- [ ] StreakCalendar.tsx（连续打卡日历热力图）
- [ ] MoodBadge.tsx（情绪徽章）
- [ ] AIInsightCard.tsx（AI 见解卡片）
- [ ] 分析图表（任务完成趋势/专注时长分布）

## 十四、CSP 安全策略（BUG-010 / 优化 14）
- [ ] tauri.conf.json 配置显式 CSP（default-src 'self'; img-src 'self' asset: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.openai.com ipc:）
- [ ] 验证 pet 加载/OpenAI API/IPC 不被阻断
- [ ] DevTools Console 无 CSP 违规

## 十五、无障碍 WCAG 2.1 AA（优化 17）
- [ ] 所有纯图标按钮 aria-label 补齐
- [ ] prefers-reduced-motion 媒体查询
- [ ] :focus-visible 全局焦点可见样式
- [ ] 高对比度主题
- [ ] 触摸目标 ≥44×44px 核查

## 十六、i18n 国际化（优化 18）
- [ ] src/i18n/zh-CN.ts + en-US.ts 语言包
- [ ] useTranslation hook / i18next 集成
- [ ] 所有硬编码中文抽取到语言包
- [ ] SettingsView 语言切换

## 十七、设计系统升级（优化 9）
- [ ] Inter + JetBrains Mono 字体引入
- [ ] variables.css 紫色调调整（与现有浅色毛玻璃协调）
- [ ] glassmorphism 增强
- [ ] spring-based 动画（200-400ms + cubic-bezier）

## 十八、测试体系（优化 16）
- [ ] Rust 单元测试覆盖所有引擎（task/pet/focus/analytics/event_bus/scheduler）
- [ ] Vitest + React Testing Library 配置 + 前端组件测试
- [ ] Playwright E2E 配置 + 关键流程测试（创建任务/完成专注/宠物交互）
- [ ] CI 配置（package.json scripts）

## 十九、性能优化（优化 15）
- [ ] 任务列表虚拟滚动（react-window/@tanstack/react-virtual）
- [ ] SpriteAnimator Canvas 渲染选项
- [ ] 数据库查询分页
- [ ] 音景资源懒加载

## 二十、Phase 4 功能
- [ ] 成就系统（achievements + AchievementCard + 解锁逻辑）
- [ ] 宠物换装/外观（species 切换 + spritesheet 选择）
- [ ] 升级动画（levelup 状态触发）
- [ ] 引导流程（onboarding 向导）
- [ ] 任务拖拽排序（dnd-kit + sort_order）
- [ ] 任务滑动手势（完成/删除）
- [ ] SettingsView 完善（主题/语言/音景/通知/数据管理）
- [ ] 数据导出（JSON/CSV）
- [ ] 数据导入
- [ ] 通知系统（系统通知 + 应用内）

## 二十一、SoundscapeEngine（Phase 2）
- [ ] soundscape_engine.rs（音频包加载/多层混合/音量控制）
- [ ] soundscape_packs 表数据
- [ ] SoundscapeMixer.tsx（音景混合器 UI）
- [ ] FocusView 集成音景播放

## 二十二、开发文档
- [ ] 更新 01_ARCHITECTURAL_DECISIONS.md（任务/宠物/专注层 + EventBus + Scheduler）
- [ ] 更新 02_DATA_MODEL.md（+8 张表 DDL + 关系图）
- [ ] 更新 03_CORE_ARCHITECTURE.md（+8 个引擎模块 + 调用链）
- [ ] 更新 04_UI_SPEC.md（5-Tab 导航 + 13 个新组件规格）
- [ ] 更新 05_INTERACTION.md（任务/专注/宠物交互状态机）
- [ ] 更新 06_DESIGN_GOVERNANCE.md（设计系统升级 + i18n + a11y）
- [ ] 新增 07_DEVELOPMENT_GUIDE.md（环境/构建/测试/调试 + src/src-tauri/ 用途说明）
- [ ] 新增 08_TESTING_STRATEGY.md（Rust/Vitest/Playwright 规范 + 覆盖率目标）
- [ ] 新增 CHANGELOG.md

## 二十三、集成验证
- [ ] 启动加载验证（tasks/petState/dailyStats 从 DB 加载）
- [ ] 任务 CRUD 全链路（创建→状态流转→删除撤销）
- [ ] 宠物交互全链路（喂食→+hunger→持久化→衍生计算）
- [ ] 番茄钟全链路（开始→完成→FocusSession→PetEngine+XP→daily_stats）
- [ ] EventBus 事件流转验证
- [ ] CSP 无违规 + a11y 审查 + i18n 切换
- [ ] 全部测试通过（Rust + Vitest + Playwright）

## 二十四、BUG-011 核验结论
- [ ] src/src-tauri/ 经核验为前端 Tauri API 封装（api.ts/mock.ts），非重复骨架
- [ ] 不删除，在 07_DEVELOPMENT_GUIDE.md 中说明其用途
- [ ] 不视为 Bug，标记为"设计误解"

# 验证总结
本 Spec 全量覆盖 analysis_results.md 的 14 Bug + 19 优化 + 13 缺失组件 + 8 缺失引擎 + 8 份开发文档。仅 BUG-011 经核验为误解（src/src-tauri/ 是前端 API 封装），保留并在文档说明。其余 13 Bug + 19 优化全部纳入实施范围。
