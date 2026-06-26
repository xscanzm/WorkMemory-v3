# WorkMemory-v3 全量开发 Spec (P0-P2)

## Why
仓库已提供完整产品愿景（`00_PRODUCT_VISION.md`）、架构决策（`01_ARCHITECTURAL_DECISIONS.md`）、数据模型（`02_DATA_MODEL.md`）、核心架构与 IPC 契约（`03_CORE_ARCHITECTURE.md`）、UI 规格（`04_UI_SPEC.md`）、交互逻辑（`05_INTERACTION.md`）、设计治理（`06_DESIGN_GOVERNANCE.md`）、并行路线图（`07_ROADMAP.md`）、AI Prompt 模板（`08_AI_PROMPTS.md`）、验收账本（`09_PRODUCT_ACCEPTANCE_LEDGER.md`）以及 9 套桌面伙伴 Spritesheet 资产（`pet/{1..9}/`）。当前仓库除规格文档外**没有任何代码实现**。本 Spec 负责从零搭建 Tauri 2 + React 18 + Rust 工程骨架，并按 P0→P1→P2 三个 Checkpoint 完整交付一个本地优先、颜值优先、可降级运行的 WorkMemory 桌面应用。

## What Changes
### P0：极简日报闭环 MVP
- 初始化 Tauri 2.x 双层工程骨架（Rust 后端 + React 18 + Vite 前端），锁定 `01_ARCHITECTURAL_DECISIONS.md` §3 中的全部依赖版本。
- 建立 Rust 后端基础层：`db/connection.rs`（WAL + 外键）、`db/migrations.rs`、`db/repository.rs`、`models.rs`，完整实现 `02_DATA_MODEL.md` §2 的全部 9 张表 + §3 的 FTS5 虚拟表与触发器。
- 实现 `core/capture.rs`：1000ms 轮询前台窗口、隐私守卫、pHash 合并、Idle 检测（180s）、CaptureAction（Create/Merge）。
- 实现 `core/ocr.rs`：WinRT `Media.Ocr` 封装、并发=2 的 `ocr_queue`、`ocr_text_cleaner`。
- 实现 `core/distill.rs`：整点触发、`distill_runs` 幂等保护、AI 蒸馏管道（JSON Mode）+ No-AI 物理聚类降级。
- 实现 `core/mascot.rs`：透明、置顶、`skip_taskbar`、`WS_EX_NOACTIVATE`、贴边磁吸。
- 注册全部 `#[tauri::command]` 与 `AppEvent` 广播（按 `03_CORE_ARCHITECTURE.md` §3 契约）。
- 前端：全局 CSS Token（`04_UI_SPEC.md` §1）、自定义无边框 Titlebar（`06_DESIGN_GOVERNANCE.md` §2.1）、`useAppStore.ts`、`MascotSprite.tsx`、`MascotWindow.tsx`。
- 前端：`TodayView`（SummaryBar + Timeline + MemoryCard + 空状态）、`ReportsView`（Episode Checklist + Markdown 编辑器 + 一键复制富文本 + 4 模板）、`SettingsView`（含 9 套伙伴选择 UI）。
- 前端 Mock 挡板 `src-tauri/mock.ts`（按 `07_ROADMAP.md` §5 策略）。
- 打包 `pet/{1..9}/spritesheet.webp` 与 `pet.json` 为 Tauri resources，启用 `assetProtocol`。
- 通过 `09_PRODUCT_ACCEPTANCE_LEDGER.md` 用例 1-5。

### P1：历史反查与时间审计
- FTS5 检索查询层（highlight + snippet），`search_memories` IPC 命令返回混合结果。
- `CalendarView`：7×6 月历、工作强度条、日格一句话缩写、已生成日报徽章、右侧 Context 面板。
- `SearchView`：`Ctrl+K` Command Center、双栏（Episode Matches / OCR Snippets）、命中原因标签、高亮 `==关键字==` 渲染。
- `InsightsView`：时间分布、异常频繁切换、未完成线索等 Insight 卡片。
- Mascot 2.0：每小时 1 次气泡上限、6 秒淡出、连续关闭 3 次降频、右键菜单（`05_INTERACTION.md` §2.4）。
- 主动智能：17:30-19:30 日报复盘气泡、45 分钟专注休息提醒、10 分钟/30 次切换降噪建议。
- 通过 `09_PRODUCT_ACCEPTANCE_LEDGER.md` 用例 6 + P1 性能红线（FTS5 < 30ms / 10w 条）。

### P2：知识沉淀与关系网
- `core/embedding.rs`：OpenAI `text-embedding-3-small` 客户端、`embeddings` 表写入、本地余弦相似度召回。
- 自研轻量双链 Markdown 编辑器：`[[wikilink]]` 高亮、自动补全、不存在则创建、存在则跳转。
- `WikiView`：左侧目录树、中间编辑面板、右侧 References + Backlinks、Review Queue 悬浮条。
- `GraphView`：力导向图谱画布（人/事/项目/时间/文档节点），双击节点穿梭回 Episode。
- `save_to_wiki` IPC、`wiki_eligible=1` 自动推送 Review Queue。
- 通过 `09_PRODUCT_ACCEPTANCE_LEDGER.md` 用例 7。

### 跨阶段硬约束 (**BREAKING** 级治理)
- 完全禁用 Tailwind CSS 与 Fluent UI v9，仅用 Radix Primitives + 自研 CSS 变量系统。
- 完全禁用 PaddleOCR，仅用 WinRT Media.Ocr。
- 禁止键盘记录器、禁止截图离域、禁止强弹窗、禁止评判式话术。
- 所有页面必须通过 `06_DESIGN_GOVERNANCE.md` §4 的"3秒法则"。
- 桌面伙伴动画**必须**直接读取 `pet/{1..9}/spritesheet.webp`，禁止重新生成资产。

## Impact
- Affected specs: 00-09 全部文档均为本 Spec 的输入约束。
- Affected code: 全新工程 `workmemory-app/`（含 `src-tauri/` Rust 后端与 `src/` React 前端），无既有代码需迁移。
- 复用资产: `pet/{1..9}/spritesheet.webp` + `pet/{1..9}/pet.json`（作为 Tauri resources 打包）。
- 平台: Windows 10/11（WinRT OCR 与窗口控制为 Windows 专属能力）。

## ADDED Requirements

### Requirement: 工程骨架与依赖锁定
系统 SHALL 使用 Tauri 2.x + React 18 + Vite 5 + Rust Stable 构建，并 SHALL 严格锁定 `01_ARCHITECTURAL_DECISIONS.md` §3 中列出的全部依赖版本（Cargo.toml 与 package.json 一致）。

#### Scenario: 工程初始化成功
- **WHEN** 开发者执行 `pnpm install` 与 `cargo build`
- **THEN** 前后端均能成功编译，Tauri 主窗口与 Mascot 透明窗口均可启动。

### Requirement: 本地优先与隐私红线
系统 SHALL 在本地完成全部截图、OCR、聚类与蒸馏；SHALL 仅在用户配置 OpenAI Key 且主动触发生成日报/蒸馏时发起 HTTPS 请求；SHALL NEVER 实现键盘记录器、NEVER 上传原始截图、NEVER 发送强遮挡弹窗、NEVER 使用评判式话术。

#### Scenario: 隐私规则命中
- **WHEN** 前台窗口命中 `privacy_rules`（如 `chrome-extension://`）
- **THEN** Mascot 拉帘闭眼（Row 8），托盘变紫，`segments` 新增 `is_private=1, ocr_status='skipped', screenshot_path=''`，Timeline 显示 `🔒 已保护隐私窗口`，不存储任何像素与 OCR 文本。

### Requirement: 无 AI 降级模式
系统 SHALL 在未配置 API Key 或网络离线时无缝降级：今日一句话用规则统计、Episode 用 App 邻近度聚类、搜索用 FTS5、日报用模板拼接、Wiki 用纯人工双链；SHALL NEVER 因无 Key 抛错弹窗。

#### Scenario: 离线蒸馏
- **WHEN** 整点触发蒸馏且无 API Key
- **THEN** `distill_runs` 记录 `model_name='local-cluster'`，`clean_episodes` 按 App 邻近度物理聚类生成，前端日报生成零延迟走降级模板。

### Requirement: 桌面伙伴 Spritesheet 渲染
系统 SHALL 通过 `MascotSprite` 组件统一驱动全部 9 套伙伴，SHALL 直接读取 `asset://localhost/pet/{id}/spritesheet.webp`，SHALL 严格按 `04_UI_SPEC.md` §5.2 的 192×208 / 9 行布局与 `STATE_ROWS` 配置表步进 `background-position`，SHALL NEVER 重新生成或替换资产、NEVER 使用 GIF/APNG。

#### Scenario: 状态自动切换
- **WHEN** 后端广播 `recorder-state-changed` 为 `PrivacyMode`
- **THEN** Mascot 切换至 `special`（Row 8）拉帘动画；恢复 `Recording` 时切回 `idle`（Row 0）。

### Requirement: P0 日报闭环
系统 SHALL 提供"零操作捕获 → WinRT OCR → 整点蒸馏 → TodayView Timeline → ReportsView 一键生成 → 富文本双格式复制"的完整链路，并 SHALL 通过 `09_PRODUCT_ACCEPTANCE_LEDGER.md` 用例 1-5。

#### Scenario: 富文本复制兼容飞书/钉钉
- **WHEN** 用户在 ReportsView 点击"复制富文本"
- **THEN** 剪贴板同时写入 `text/html` 与 `text/plain`，粘贴至飞书/钉钉时标题级差、加粗、Bullet、行内代码样式完整保留。

### Requirement: P1 FTS5 检索与日历反查
系统 SHALL 在 100,000 条 Segment 下保持 FTS5 top-20 检索 < 30ms，SHALL 在 SearchView 高亮 `==关键字==`，SHALL 提供 CalendarView 月历反查任意一天的 Summary 与 Episode。

#### Scenario: OCR 关键词反查
- **WHEN** 用户在搜索框输入"退款异常"并回车
- **THEN** "OCR Snippets" 栏瞬间展示 `...确认了==退款异常==枚举...`，双击反查出原始 Segment 详情。

### Requirement: P1 Mascot 气泡频控
系统 SHALL 执行 `05_INTERACTION.md` §2.3 的气泡算法：每小时 ≤1 次、隐私拦截首闪、6 秒淡出、× 关闭当日同类禁推、累计关闭 3 次当日全禁。

#### Scenario: 连续关闭降频
- **WHEN** 用户当天累计点击 × 关闭气泡 3 次
- **THEN** 当天剩余时间 Mascot 不再主动推送任何气泡。

### Requirement: P2 双链 Wiki 与图谱
系统 SHALL 提供自研双链 Markdown 编辑器（`[[wikilink]]` 高亮、不存在则创建、存在则跳转）、Review Queue 自动推送 `wiki_eligible=1` 草稿、GraphView 力导向图谱穿梭。

#### Scenario: 双链动态跳转
- **WHEN** 用户在 Wiki 编辑器手写 `[[退款接口说明]]` 且该页面不存在
- **THEN** 文字变为主色调加粗；点击后自动创建以"退款接口说明"为标题的新 Wiki 草稿页。

### Requirement: 设计治理 3 秒法则
任意主页面 SHALL 通过 `06_DESIGN_GOVERNANCE.md` §4 的"3 秒截图检查"：3 秒内看出核心任务、看出捕获状态、截图可直接用于宣发。

#### Scenario: 视觉验收
- **WHEN** QA 对 TodayView / CalendarView / ReportsView / WikiView 截图
- **THEN** 每张图均呈现单色主义美感、像素级精细、毛玻璃材质与精致边框，无 Hardcode 颜色、无系统滚动条、无白色闪烁。
