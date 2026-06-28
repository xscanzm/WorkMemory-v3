# Checklist

## 一、后端架构与数据库加固（1.1-1.6）
- [x] Cargo.toml 添加 r2d2 + r2d2_sqlite 依赖
- [x] lib.rs AppState 改为 `r2d2::Pool<SqliteConnectionManager>`，配置 min=2/max=8
- [x] 全部 61 处 `Mutex<rusqlite::Connection>` 调用迁移为 `Pool.get()?`
- [x] `cargo check --lib` 通过（仅预存 stats_engine/capture/distill/report/embedding 裸路径错误）
- [x] repository.rs 跨表写函数（save_to_wiki/generate_report/distill_episode/clean_episodes）采用 `conn.transaction()` 包裹
- [x] 单元测试覆盖"跨表写部分失败回滚"场景
- [x] `days_in_month` 非法月份返回 `AppError::ValidationError`（不再默认返回 30）
- [x] 新建 `core/validator.rs` 提供 validate_title/content/pagination/uuid/month
- [x] commands.rs 所有 IPC 入口调用 validator，非法参数返回 ValidationError
- [x] 单元测试覆盖各 validator 边界
- [x] capture.rs/uia.rs 系统调用包裹 `std::panic::catch_unwind`
- [x] panic 时 log::error 记录 + 降级返回 None/默认值
- [x] 后台轮询任务包裹 catch_unwind 防止进程退出
- [x] scheduler.rs 新增每小时 `PRAGMA wal_checkpoint(TRUNCATE)` 任务
- [x] task_engine.rs delete_task 时清理 subtasks JSON 引用、focus_sessions.task_id SET NULL
- [x] 单元测试覆盖删除 Task 后的级联清理

## 二、前端状态与核心逻辑（2.1-2.5）
- [x] focusStore.ts 内部管理 setInterval（startTimer 启动 ticker，stopTimer/reset 清除）
- [x] FocusView.tsx 移除 useEffect setInterval，仅订阅 store 状态
- [x] Vitest 测试覆盖"组件卸载后计时继续"
- [x] 新建 `utils/debounce.ts` 通用 debounce 工具
- [x] SearchView/WikiView/TopBar 搜索框统一 300ms debounce
- [x] Vitest 测试覆盖 debounce 行为
- [x] taskStore.ts updateTask/deleteTask 前快照 prevState
- [x] IPC 失败时 set(prevState) + toast.error("更新失败，已回滚")
- [x] petStore 同样应用回滚机制
- [x] Vitest 测试覆盖回滚场景
- [x] 新建 `hooks/useDirtyGuard.ts`（全局 dirty 状态 + 注册/注销）
- [x] 新建 `components/UnsavedChangesDialog.tsx`（Radix Dialog 确认弹窗）
- [x] App.tsx 路由切换前检查 dirty，拦截并弹窗
- [x] WikiMarkdownEditor 等编辑器接入 useDirtyGuard
- [x] 新建 `hooks/useAsync.ts`（轻量异步数据获取 hook）
- [x] 视图层 useEffect 直连 IPC 迁移为 useAsync 或 Store 订阅
- [x] 补充视图级 ErrorBoundary 包裹

## 三、UI 组件开发（3.1-3.8）
- [x] CommandPalette.tsx 新建（Radix Dialog + cmdk 风格，模糊搜索）
- [x] 支持搜索记忆/创建任务/切换视图/系统指令四类命令
- [x] App.tsx 挂载 + Ctrl+K 唤出
- [x] 键盘导航（↑↓选择、Enter执行、Esc关闭）
- [x] tauri.conf.json 新增 quick-capture 窗口配置
- [x] QuickCaptureView.tsx 新建（极简闪念输入 + 截图按钮）
- [x] Rust 端新增 show_quick_capture/hide_quick_capture IPC 命令
- [x] 快捷键唤出快速捕获窗口
- [x] Breadcrumbs.tsx 新建
- [x] TopBar 重构集成面包屑，根据路由显示层级路径
- [x] 支持 Wiki 深层页面路径
- [x] TagManagementView.tsx + TagCloud.tsx 新建
- [x] 后端新增 list_tags/rename_tag/merge_tags/set_tag_color IPC 命令
- [x] 支持标签重命名/合并/颜色标注/全局关联筛选
- [x] 路由 /tags + 侧边栏入口
- [x] MemoryFullscreenModal.tsx 新建（扩展 MemoryCard）
- [x] 展示 Episode 证据链/素材/关联结构
- [x] TodayView/CalendarView/SearchView 卡片点击唤出模态
- [x] AchievementUnlockModal.tsx 新建（粒子动画 + 升级特效）
- [x] achievement_engine 解锁时通知前端
- [x] 取代普通 Toast，显示专属弹窗
- [ ] SessionSummaryCard.tsx 新建
- [ ] FocusView 专注完成时弹出总结（时长分布/注意力流失/关联任务）
- [ ] 后端 focus_engine 返回会话分析数据
- [ ] Sidebar.tsx 重构为可折叠多维分组（导航/收藏/标签/最近）
- [ ] 保留 5-Tab 主导航，新增可折叠子分组
- [ ] 折叠状态持久化到 localStorage

## 四、交互规范补全（4.1-4.4）
- [x] useHotkeys.ts 新建（全局快捷键监听矩阵）
- [x] 支持 Ctrl+N（新建）/Ctrl+S（保存）/Ctrl+F（搜索）/Ctrl+K（命令面板）/Esc（关闭模态）
- [x] 输入框聚焦时正确处理冲突
- [x] App.tsx 挂载 useHotkeys
- [ ] ContextMenu.tsx 新建（基于 Radix ContextMenu）
- [ ] Task 列表右键（编辑/删除/归档/置顶/导出）
- [ ] Wiki 列表右键（编辑/删除/导出/移动）
- [ ] Episode 卡片右键（查看详情/导出/删除）
- [ ] TasksView/WikiView 支持 Shift/Ctrl+Click 批量选择
- [ ] BatchToolbar.tsx 新建（批量完成/批量删除/批量归档）
- [ ] 后端新增 batch_update_tasks/batch_delete_tasks IPC 命令（事务化）
- [ ] 视图切换 300ms ease-out 过渡
- [ ] 模态框进出 spring physics 动画
- [ ] 尊重 prefers-reduced-motion

## 五、工程质量与文档（5.1-5.2）
- [ ] focus_engine/pet_engine/analytics_engine/task_engine/soundscape_engine 完整覆盖（≥80% 行覆盖）
- [ ] 新增 validator.rs/catch_unwind/事务回滚的测试
- [ ] `cargo test` 验证全部通过
- [ ] taskStore/petStore/focusStore 完整覆盖（含回滚场景）
- [ ] 新组件（CommandPalette/ContextMenu/Breadcrumbs 等）渲染测试
- [ ] `pnpm test` 验证 ≥70% 覆盖率
- [ ] 核查 doc/ 目录是否存在重复副本
- [ ] 删除过时副本，根目录文档为唯一真实来源
- [ ] 在 10_DEVELOPMENT_GUIDE.md 说明文档结构

## 六、集成验证
- [ ] 后端验证（cargo check 仅预存错误 + cargo test 通过）
- [ ] 前端验证（pnpm typecheck 仅预存错误 + pnpm test 通过）
- [ ] 连接池验证（后台写不阻塞前台读）
- [ ] 事务验证（跨表写部分失败回滚）
- [ ] 计时器验证（切换视图不冻结）
- [ ] 快捷键验证（Ctrl+K/N/S/F/Esc 全部生效）

# 验证总结
本 Spec 全量覆盖审计 AI 的 5 大类 25 项意见：后端 6 项（事务/连接池/校验/panic 隔离/WAL/级联）、前端 5 项（计时器/防抖/回滚/脏数据/范式）、UI 8 项（命令面板/快速捕获/面包屑/标签/记忆模态/成就特效/专注总结/侧边栏）、交互 4 项（快捷键/右键菜单/批量/动画）、工程 2 项（测试/文档 SSOT）。经代码核查，绝大多数属实，部分（防抖/文档 SSOT）需进一步核查后定范围。
