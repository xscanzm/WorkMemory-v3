# WorkMemory-v4 审计加固与体验补全 Spec

## Why
审计 AI 提交了 5 大类共 25 项缺陷与缺失组件意见。经复核，绝大多数属实：后端跨表写无事务、全局单 SQLite 连接锁阻塞、IPC 参数校验缺失、专注计时器寄生组件导致后台冻结、Store 乐观更新无回滚、8 个 UI 组件缺失、4 类交互缺失、测试覆盖不足、文档重复。本 Spec 全量推进，使 WorkMemory 达到生产级健壮性与完整体验。

## 复核结论（经代码核查）

| 审计项 | 复核结果 |
|---|---|
| 1.1 save_to_wiki 无事务 | ✅ 属实（commands.rs:158 存在，全文件无 `.transaction()`） |
| 1.2 全局单 Mutex<Connection> 阻塞 | ✅ 属实（61 处 `Mutex<rusqlite::Connection>` 调用） |
| 1.3 days_in_month 非法月份穿透 | ✅ 属实（commands.rs:1066 `_ => 30` 默认分支） |
| 1.4 IPC 强输入校验缺失 | ✅ 属实（serde 强转，无长度/边界校验层） |
| 1.5 系统句柄 panic 隔离缺失 | ✅ 属实（capture.rs/uia.rs 无 catch_unwind） |
| 1.6 WAL checkpoint 与外键级联缺失 | ✅ 属实（scheduler.rs 无 wal_checkpoint；删 Task 无子任务解绑） |
| 2.1 专注计时器寄生组件 | ✅ 属实（FocusView.tsx:348 setInterval 在 useEffect） |
| 2.2 搜索框无防抖 | ⚠️ 部分属实（TasksView 已有 debounce，SearchView/WikiView 未确认） |
| 2.3 Store 无回滚 | ✅ 属实（taskStore 失败仅 console.error） |
| 2.4 脏数据路由拦截缺失 | ✅ 属实（无全局 dirty 监听） |
| 2.5 数据获取范式不统一 | ✅ 属实（部分 useEffect 直连 IPC，部分 Store） |
| 3.1-3.8 8 个 UI 组件缺失 | ✅ 属实（CommandPalette/QuickCaptureWindow/Breadcrumbs 等均不存在） |
| 4.1-4.4 4 类交互缺失 | ✅ 属实（无全局快捷键矩阵、右键菜单、批量选择、过渡动画补全） |
| 5.1 测试覆盖不足 | ✅ 属实（Rust 34 测试 + 前端 22 测试，远未达 80%） |
| 5.2 文档 SSOT | ⚠️ 待核查（需确认 doc/ 目录是否存在重复副本） |

## What Changes

### A. 后端架构与数据库加固（1.1-1.6）
- **事务包裹**：repository 层所有跨表写命令采用 `conn.transaction()?`，至少覆盖 save_to_wiki/generate_report/distill_episode/clean_episodes 等多步写
- **连接池**：引入 `r2d2` + `r2d2_sqlite`，AppState 从 `Mutex<Connection>` 改为 `Pool<SqliteConnectionManager>`；后台写连接与前台读连接分离
- **边界校验**：`days_in_month` 非法月份返回 `AppError::ValidationError`；所有日期/范围辅助函数添加硬校验
- **IPC Validator 层**：新建 `core/validator.rs` 统一校验字符串长度（标题 ≤200、内容 ≤50000）、数值边界（offset ≥0、limit ≤500）、UUID 格式
- **panic 隔离**：capture.rs/uia.rs 的系统调用包裹 `std::panic::catch_unwind`，panic 时记录日志并降级返回 None
- **WAL Checkpoint**：scheduler 新增每小时 `PRAGMA wal_checkpoint(TRUNCATE)` 任务
- **外键级联**：删 Task 时显式清理 subtasks JSON 引用、focus_sessions.task_id SET NULL、pet_interaction_logs 保留

### B. 前端状态与核心逻辑（2.1-2.5）
- **计时器提升**：focusStore 内部管理 setInterval（store action 启动/停止 ticker），FocusView 仅订阅状态；组件卸载不影响计时
- **防抖统一**：新建 `utils/debounce.ts`，SearchView/WikiView/TopBar 搜索框统一 300ms debounce
- **Store 回滚**：taskStore/petStore 在 updateTask/deleteTask 前快照 prevState，IPC 失败时 set(prevState) + toast.error
- **脏数据拦截**：新建 `useDirtyGuard` hook + 全局 `<UnsavedChangesDialog>`，路由切换前若 dirty 则拦截
- **Error Boundary 扩展**：现有 ErrorBoundary 已存在，补充视图级 ErrorBoundary 包裹 + 统一数据获取范式（建议引入轻量 `useAsync` hook 或保持 Store 订阅为主）

### C. UI 组件开发（3.1-3.8）
- **CommandPalette**（Ctrl+K）：Radix Dialog + cmdk 风格，支持搜索记忆/创建任务/切换视图/系统指令
- **QuickCaptureWindow**：Tauri 独立小窗口（label: "quick-capture"），快捷键唤出，极简捕获闪念/截图
- **Breadcrumbs**：TopBar 重构，显示当前视图层级路径
- **TagManagementPanel**：独立标签管理视图，支持重命名/合并/颜色/全局筛选
- **MemoryFullscreenModal**：扩展 MemoryCard 为全屏模态，展示证据链/素材/关联
- **AchievementUnlockModal**：粒子动画 + 升级特效弹窗，取代普通 Toast
- **SessionSummaryCard**：专注结束总结卡片（时长分布/注意力流失/关联任务）
- **SidebarCategories**：侧边栏重构为可折叠多维分组（导航/收藏/标签/最近）

### D. 交互规范补全（4.1-4.4）
- **全局快捷键矩阵**：Ctrl+N（新建）、Ctrl+S（保存）、Ctrl+F（搜索）、Ctrl+K（命令面板）、Esc（关闭模态）等
- **右键上下文菜单**：Radix ContextMenu，覆盖 Task/Wiki/Episode 列表（编辑/删除/归档/导出）
- **批量多选**：Shift/Ctrl+Click 批量选择 + 批量操作工具栏
- **动画补全**：视图切换 300ms ease-out 过渡、模态进出 spring physics 动画

### E. 工程质量与文档（5.1-5.2）
- **测试补齐**：Rust core/ 引擎扩充至 ≥80% 覆盖率（focus_engine/pet_engine/analytics_engine/task_engine/soundscape_engine 完整覆盖）；前端 Store/Component 扩充至 ≥70%
- **文档 SSOT**：核查 `doc/` 目录，删除过时副本，根目录文档为唯一真实来源

## Impact
- 后端：`src-tauri/src/db/repository.rs`（事务+连接池）、`src-tauri/src/core/{validator,scheduler,capture,uia}.rs`、`src-tauri/src/ipc/commands.rs`、`src-tauri/src/lib.rs`（AppState 改 Pool）、`Cargo.toml`（+r2d2/r2d2_sqlite）
- 前端 store：`src/store/{focusStore,taskStore,petStore}.ts`
- 前端组件（新建）：`src/components/{CommandPalette,QuickCaptureWindow,Breadcrumbs,TagManagementPanel,MemoryFullscreenModal,AchievementUnlockModal,SessionSummaryCard,SidebarCategories,UnsavedChangesDialog,ContextMenu,BatchToolbar}.tsx`
- 前端 hooks/utils：`src/hooks/{useDirtyGuard,useHotkeys,useAsync}.ts`、`src/utils/debounce.ts`
- 前端视图（重构）：`src/views/{FocusView,SearchView,WikiView,TopBar}.tsx`、`src/App.tsx`
- 测试：`src-tauri/src/core/*` 扩充 `#[cfg(test)]`、`src/**/__tests__/*` 扩充
- 文档：清理 `doc/` 目录重复副本

## ADDED Requirements

### Requirement: 数据库事务一致性
系统 SHALL 在所有跨表写 IPC 命令中采用 `conn.transaction()` 显式事务包裹，SHALL 在任一步骤失败时回滚全部变更，SHALL 至少覆盖 save_to_wiki/generate_report/distill_episode/clean_episodes。

#### Scenario: 跨表写部分失败回滚
- **WHEN** save_to_wiki 在写入 wiki_pages 后更新 episodes 状态时失败
- **THEN** wiki_pages 的写入回滚
- **AND** episodes 状态保持原值
- **AND** 前端收到 AppError 并 Toast 提示

### Requirement: SQLite 连接池
系统 SHALL 使用 r2d2 连接池替代单一 Mutex<Connection>，SHALL 配置最小 2 / 最大 8 连接，SHALL 保证后台高频写不阻塞前台轻量读。

#### Scenario: 后台写入不阻塞前台查询
- **WHEN** capture.rs 后台抓屏写入 segments 时
- **THEN** 前端 UI 的 get_all_tasks 查询从池中获取独立连接
- **AND** 不发生同步等待卡顿

### Requirement: IPC 参数强校验
系统 SHALL 在 IPC 命令入口统一校验输入参数，SHALL 拦截非法日期（月份 1-12）、超长字符串（标题 ≤200）、越界分页（offset ≥0、limit ≤500）、非法 UUID，SHALL 返回 AppError::ValidationError。

#### Scenario: 非法月份拦截
- **WHEN** IPC 命令收到 month=13
- **THEN** 返回 AppError::ValidationError("月份必须在 1-12 范围")
- **AND** 不进入 SQL 检索

### Requirement: 专注计时器全域生命周期
系统 SHALL 将计时器 setInterval 提升至 focusStore 内部管理，SHALL 保证组件卸载不影响后台计时，SHALL 在 store action 启动/停止 ticker。

#### Scenario: 切换视图不冻结计时
- **WHEN** 用户在专注计时运行中切换到 Wiki 视图
- **THEN** FocusView 组件卸载
- **AND** focusStore 的 setInterval 继续推进 elapsedSeconds
- **AND** 切回 FocusView 时显示正确累计时长

### Requirement: Store 乐观更新回滚
系统 SHALL 在 updateTask/deleteTask 执行前快照 prevState，SHALL 在 IPC 失败时自动 set(prevState) 并 toast.error，SHALL 保证 UI 与数据库一致。

#### Scenario: 更新失败回滚
- **WHEN** updateTask IPC 抛出异常
- **THEN** taskStore 恢复到更新前的 tasks 数组
- **AND** Toast 显示 "更新失败，已回滚"
- **AND** UI 不显示未持久化的状态

### Requirement: 命令面板
系统 SHALL 提供 Ctrl+K 唤出的浮动命令面板，SHALL 支持搜索记忆、创建任务、切换视图、执行系统指令，SHALL 支持模糊匹配与键盘导航。

### Requirement: 全局快捷键系统
系统 SHALL 提供全局快捷键矩阵，SHALL 至少支持 Ctrl+N（新建）、Ctrl+S（保存）、Ctrl+F（搜索）、Ctrl+K（命令面板）、Esc（关闭模态），SHALL 在输入框聚焦时正确处理冲突。

### Requirement: 右键上下文菜单
系统 SHALL 为 Task/Wiki/Episode 列表提供统一右键菜单，SHALL 支持快速编辑、删除、归档、导出操作。

### Requirement: 批量多选
系统 SHALL 支持 Shift/Ctrl+Click 批量选择列表项，SHALL 提供批量操作工具栏（批量完成、批量删除、批量归档）。

## MODIFIED Requirements

### Requirement: 数据库连接管理
现有 `AppState = Mutex<rusqlite::Connection>` 修改为 `AppState = r2d2::Pool<SqliteConnectionManager>`，所有 `state.lock().unwrap()` 改为 `state.get()?`。

### Requirement: 侧边栏导航
现有扁平侧边栏修改为可折叠多维分组（导航/收藏/标签/最近），保留 5-Tab 主导航。

### Requirement: 专注计时器驱动
现有 FocusView useEffect setInterval 修改为 focusStore 内部 ticker，组件仅订阅状态。

## REMOVED Requirements

### Requirement: 单一全局 SQLite 连接
**Reason**: 导致后台写阻塞前台读
**Migration**: 迁移到 r2d2 连接池，所有 `app.state::<Mutex<Connection>>()` 改为 `app.state::<Pool<SqliteConnectionManager>>().get()?`
