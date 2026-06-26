# Tasks

## L0：根地基（最先生成，无依赖）

- [x] Task 1: 初始化 Tauri 2.x 双层工程骨架
  - [x] SubTask 1.1: 在 `/workspace/workmemory-app/` 下创建 Tauri 2.x + React 18 + Vite 5 工程结构，按 `03_CORE_ARCHITECTURE.md` §1 的目录布局落盘
  - [x] SubTask 1.2: 编写 `src-tauri/Cargo.toml`，严格锁定 `01_ARCHITECTURAL_DECISIONS.md` §3.1 全部依赖版本（tauri 2.0、rusqlite 0.31 bundled+modern_sqlite、windows 0.58 含 Media_Ocr 等）
  - [x] SubTask 1.3: 编写前端 `package.json`，严格锁定 §3.2 全部依赖（react 18.3、react-router-dom 6.23、zustand 4.5、Radix 全套、lucide-react、zod、vite 5.2）
  - [x] SubTask 1.4: 编写 `src-tauri/tauri.conf.json`：主窗口 1280×720、`decorations:false`、Mascot 透明窗口 `label:"mascot"`、`assetProtocol` 启用 scope `$RESOURCE/pet/**`、`bundle.resources` 声明 `pet/*`
  - [x] SubTask 1.5: 将 `/workspace/pet/{1..9}/` 复制到 `workmemory-app/src-tauri/resources/pet/` 作为打包资源

- [ ] Task 2: 前端全局设计 Token 与 Reset（L0）
  - [ ] SubTask 2.1: 编写 `src/styles/variables.css`，完整定义 `04_UI_SPEC.md` §1 全部 CSS 变量（色板、圆角、间距、阴影、毛玻璃）
  - [ ] SubTask 2.2: 编写 `src/styles/index.css`：Reset、`-webkit-app-region: drag`、HTML/Body 背景与 `--color-bg-base` 一致、自定义 Radix ScrollArea 半透明自动隐藏滚动条
  - [ ] SubTask 2.3: 编写 `src/types/index.ts`，完整定义 `02_DATA_MODEL.md` §4 全部 TS 接口（WorkSegment、CleanEpisode、MemoryCell、WikiPage、WorkReport、PrivacyRule、AppSetting、SearchResult）

## L1：基础服务层（可并行）

- [ ] Task 3: Rust 数据库存储层（依赖 Task 1）
  - [ ] SubTask 3.1: 编写 `src-tauri/src/db/connection.rs`：初始化 SQLite、`PRAGMA journal_mode=WAL`、`PRAGMA foreign_keys=ON`、应用迁移
  - [ ] SubTask 3.2: 编写 `src-tauri/src/db/migrations.rs`：完整执行 `02_DATA_MODEL.md` §2 的 9 张表 DDL + §3 的 3 个 FTS5 虚拟表与 9 个触发器
  - [ ] SubTask 3.3: 编写 `src-tauri/src/models.rs`：定义对应 9 张表的 Rust 结构体（serde 序列化字段名 camelCase 对齐前端）
  - [ ] SubTask 3.4: 编写 `src-tauri/src/db/repository.rs`：segments/clean_episodes/memory_cells/embeddings/distill_runs/wiki_pages/reports/privacy_rules/settings 的 CRUD，FTS5 highlight+snippet 查询
  - [ ] SubTask 3.5: 单元测试覆盖表创建、触发器同步、FTS5 检索

- [ ] Task 4: Windows 窗口监听与截图（依赖 Task 1、Task 3）
  - [ ] SubTask 4.1: 编写 `src-tauri/src/core/capture.rs`：1000ms 轮询前台窗口（GetForegroundWindow + GetWindowText）
  - [ ] SubTask 4.2: 实现隐私守卫：查询 `privacy_rules` 命中即插入 `is_private=1, ocr_status='skipped'` 并广播 `privacy-triggered`
  - [ ] SubTask 4.3: 实现 pHash 计算与 95% 相似度 Merge 逻辑
  - [ ] SubTask 4.4: 实现 180s 静止 Idle 检测，进入 Idle 停止轮询，鼠标键盘唤醒恢复
  - [ ] SubTask 4.5: 实现截图捕获（BitBlt + image crate 解码），仅内存流转不入磁盘

- [ ] Task 5: WinRT OCR 引擎封装（依赖 Task 1）
  - [ ] SubTask 5.1: 编写 `src-tauri/src/core/ocr.rs`：调用 `windows::Media::Ocr::OcrEngine`，支持中英文
  - [ ] SubTask 5.2: 实现 `SoftwareBitmap` 转换（从 image crate 的 RGBA buffer）
  - [ ] SubTask 5.3: 实现 `ocr_queue`（Tokio Semaphore 并发=2），OCR 完成后写回 `segments.ocr_text`
  - [ ] SubTask 5.4: 实现 `ocr_text_cleaner`：去重、去噪、合并多行

- [ ] Task 6: Mascot 透明窗口控制器（依赖 Task 1）
  - [ ] SubTask 6.1: 编写 `src-tauri/src/core/mascot.rs`：通过 Tauri WebviewWindow 创建透明、置顶、`skip_taskbar:true` 窗口
  - [ ] SubTask 6.2: 设置 `WS_EX_NOACTIVATE` 防夺焦，`decorations:false`、`transparent:true`、`always_on_top:true`
  - [ ] SubTask 6.3: 实现拖拽事件转发与贴边磁吸坐标计算（右下角优先）

- [ ] Task 7: 前端全局框架与 Mascot 组件（依赖 Task 2）
  - [ ] SubTask 7.1: 编写 `src/App.tsx`：HashRouter、三栏布局（Sidebar 72px + Main 860px + Context 348px）、Top Bar 状态指示
  - [ ] SubTask 7.2: 编写自定义无边框 Titlebar 组件（最小化/最大化/关闭按钮 + drag 区域）
  - [ ] SubTask 7.3: 编写 `src/components/mascot/MascotSprite.tsx`，严格按 `04_UI_SPEC.md` §5.4 实现 STATE_ROWS 与 background-position 步进
  - [ ] SubTask 7.4: 编写 `src/store/useAppStore.ts`（Zustand）：recorderState、episodes、activeView、settings、mascotId、mascotState
  - [ ] SubTask 7.5: 编写 `src/store/mascotStore.ts` 的 `recorderStateToMascotState` 映射函数（`04_UI_SPEC.md` §5.5）
  - [ ] SubTask 7.6: 编写 `src/components/MascotWindow.tsx`：监听 `recorder-state-changed`、`privacy-triggered`、`report-ready`，处理 drag/fall 一次性动画与贴边磁吸
  - [ ] SubTask 7.7: 编写 `src/src-tauri/mock.ts` 前端 Mock 挡板（按 `07_ROADMAP.md` §5 策略，覆盖全部 IPC 命令）
  - [ ] SubTask 7.8: 编写 `src/src-tauri/api.ts` 统一 invoke 封装（自动检测 Tauri/Web 环境切换 Mock）

## L2：粘合与核心逻辑层

- [ ] Task 8: IPC 命令注册与事件广播（依赖 Task 3-6）
  - [ ] SubTask 8.1: 编写 `src-tauri/src/ipc/commands.rs`：注册 `03_CORE_ARCHITECTURE.md` §3.1 全部 `#[tauri::command]`（get_recorder_state、set_recorder_state、trigger_manual_capture、get_today_summary、get_episodes_by_date、update_episode_title_summary、search_memories、generate_report、save_to_wiki）
  - [ ] SubTask 8.2: 编写 `src-tauri/src/ipc/events.rs`：定义 `recorder-state-changed`、`segment-captured`、`privacy-triggered`、`distill-completed`、`focus-remind`、`report-ready` 的 Payload 并通过 `app.emit` 广播
  - [ ] SubTask 8.3: 在 `main.rs` 注册命令、初始化数据库、启动 capture 轮询、启动整点 distill 调度
  - [ ] SubTask 8.4: 配置 Tauri tray-icon（系统托盘）+ 全局快捷键 `Ctrl+Shift+C`（Ghost Capture）

- [x] Task 9: 小时蒸馏与降级管道（依赖 Task 3、Task 5、Task 8）
  - [x] SubTask 9.1: 编写 `src-tauri/src/core/distill.rs`：整点 HH:00 触发，检查 `distill_runs` 幂等
  - [x] SubTask 9.2: 实现 AI 蒸馏管道：组装 OCR 文本 + 窗口标题流，调用 `08_AI_PROMPTS.md` §1 的 `build_distill_prompt`，强约束 JSON Mode 解析，原子写入 `clean_episodes` + `memory_cells`
  - [x] SubTask 9.3: 实现 No-AI 物理聚类降级：基于 App 邻近度与 10 分钟时间窗聚类，提取窗口标题关键词组装 Title，生成统计性 Summary
  - [x] SubTask 9.4: 实现今日一句话总结：有 Key 走 LLM，无 Key 走规则统计模板
  - [x] SubTask 9.5: 蒸馏完成后广播 `distill-completed`

- [ ] Task 10: 日报生成器（依赖 Task 8、Task 9）
  - [ ] SubTask 10.1: 编写 `src-tauri/src/core/report.rs`：`generate_report` 命令实现
  - [ ] SubTask 10.2: 实现 AI 生成：调用 `08_AI_PROMPTS.md` §2 的 `build_report_prompt`，按 4 模板（enhanced/concise/okr/structured）生成 Markdown
  - [ ] SubTask 10.3: 实现降级模板拼接：按 `05_INTERACTION.md` §4.2 的 Bullet 模板格式化拼装
  - [ ] SubTask 10.4: 写入 `reports` 表并广播 `report-ready`（触发 Mascot jump 动画）

- [x] Task 11: 前端 P0 视图（依赖 Task 7、Task 8）
  - [x] SubTask 11.1: 编写 `src/views/TodayView.tsx`：SummaryBar（毛玻璃大圆角卡 + 内联编辑 + "用户已改写"徽标）+ TimelineRail（垂直灰色虚线）+ MemoryCard（时间戳/标题双击改写/摘要/App+项目+证据 Chip/五角星/保存 Wiki 按钮）+ 空状态（Mascot sleep + 引导文案 + 恢复记录按钮）
  - [x] SubTask 11.2: 编写 `src/components/MemoryCard.tsx`、`TimelineRail.tsx`、`SourceBadge.tsx` 原子组件
  - [x] SubTask 11.3: 编写 `src/views/ReportsView.tsx`：左侧 Episode Checklist（批量多选/反选）+ 右侧 Markdown 编辑器 + 4 模板切换 + Regenerate/Copy Rich Text/Export Markdown 顶栏
  - [x] SubTask 11.4: 实现富文本双格式复制（`text/html` + `text/plain`，飞书/钉钉样式兼容）
  - [x] SubTask 11.5: 编写 `src/views/SettingsView.tsx`：通用设置（API Key/模型/保留天数/截图开关/Embedding 开关）+ 伙伴选择 UI（9 张 idle 缩略图 scale=0.5，点击即时写入 `settings.mascot_id`）
  - [x] SubTask 11.6: 实现 SummaryBar 与 MemoryCard 的 6 种状态（Normal/Hover/Active/Loading 骨架屏/Deleted 撤销浮条/Private 紫色斜条）

## L2 集成：Checkpoint 1 验收

- [ ] Task 12: P0 端到端集成与验收
  - [ ] SubTask 12.1: 通过 Mock 挡板完成 TodayView/ReportsView/SettingsView UI 走线
  - [ ] SubTask 12.2: 在 Tauri 环境下打通 capture→ocr→distill→today→report 全链路
  - [ ] SubTask 12.3: 执行 `09_PRODUCT_ACCEPTANCE_LEDGER.md` 用例 1（隐私黑名单拦截）、用例 2（静止 Idle 防抖）、用例 3（蒸馏幂等）、用例 4（无 AI 降级）、用例 5（富文本复制兼容）
  - [ ] SubTask 12.4: 性能红线校验：轮询 CPU < 2%、OCR < 150ms、报告 First Token < 1s

## L2/L3：P1 历史反查与时间审计

- [ ] Task 13: FTS5 检索查询层（依赖 Task 3）
  - [ ] SubTask 13.1: 在 repository.rs 实现 `search_memories`：FTS5 `highlight()` + `snippet()` 跨 segments/clean_episodes/wiki_pages 三表联合查询
  - [ ] SubTask 13.2: 返回 `SearchResult` DTO（`03_CORE_ARCHITECTURE.md` §3.3），含 source_id/source_type/date/time_range/primary_text/snippet/score/match_reason
  - [ ] SubTask 13.3: 性能基准：10w 条 Segment 下 top-20 < 30ms

- [ ] Task 14: 前端 P1 视图（依赖 Task 11、Task 13）
  - [ ] SubTask 14.1: 编写 `src/views/CalendarView.tsx`：7×6 月历网格、工作强度绿/青渐变条、日格一句话缩写省略号、已生成日报灰色 ✔ 徽章、右侧 Context 面板刷入当日 Summary+Episode+导出按钮
  - [ ] SubTask 14.2: 编写 `src/views/SearchView.tsx`：大圆角搜索框 + `Ctrl+K` 全局快捷键、双栏（Episode Matches / OCR Snippets）、命中原因标签（💡 OCR 匹配 / 🏷️ 标签匹配）、`==关键字==` 浅黄高亮渲染（border-radius:2px）、双击反查右侧 Context
  - [ ] SubTask 14.3: 编写 `src/views/InsightsView.tsx`：时间分布饼图、异常频繁切换提醒卡、未完成线索卡、深度专注统计卡
  - [ ] SubTask 14.4: 编写 `src/components/InsightCard.tsx` 原子组件

- [ ] Task 15: Mascot 2.0 气泡频控与主动智能（依赖 Task 6、Task 8）
  - [ ] SubTask 15.1: 实现气泡频控算法（`05_INTERACTION.md` §2.3）：每小时 ≤1 次、隐私首闪、6 秒淡出、× 关闭当日同类禁推、累计 3 次当日全禁
  - [ ] SubTask 15.2: 实现右键快捷菜单（§2.4 全部菜单项）
  - [ ] SubTask 15.3: 实现 17:30-19:30 日报复盘气泡（jump 动画 + 中性话术）
  - [ ] SubTask 15.4: 实现 45 分钟专注休息提醒（focus-remind 事件 + 端茶气泡）
  - [ ] SubTask 15.5: 实现 10 分钟/30 次切换降噪建议（InsightsView 卡片 + 头顶轻提示）
  - [ ] SubTask 15.6: 实现 Mascot 全屏/演示/专业软件自动降透明度至 0.15（§2.1）

- [ ] Task 16: P1 集成验收
  - [ ] SubTask 16.1: 执行 `09_PRODUCT_ACCEPTANCE_LEDGER.md` 用例 6（OCR 关键词毫秒高亮反查）
  - [ ] SubTask 16.2: 校验 FTS5 < 30ms / 10w 条、Mascot 内存 < 20MB、吸附 60fps

## L3：P2 知识沉淀与关系网

- [ ] Task 17: 向量语义检索（依赖 Task 9、Task 13）
  - [ ] SubTask 17.1: 编写 `src-tauri/src/core/embedding.rs`：OpenAI `text-embedding-3-small` 客户端（reqwest rustls-tls）
  - [ ] SubTask 17.2: 蒸馏后异步向量化 `memory_cells` 事实文本，写入 `embeddings` 表（f32 LE 字节序列）
  - [ ] SubTask 17.3: 实现本地余弦相似度召回（加载全部 embeddings 到内存做 top-k）
  - [ ] SubTask 17.4: 在 `search_memories` 中融合 FTS5 + 向量结果（混合 score）

- [ ] Task 18: 双链 Markdown 编辑器（依赖 Task 11）
  - [ ] SubTask 18.1: 自研轻量 Markdown 编辑器组件：基础语法渲染（标题/加粗/列表/代码/引用）
  - [ ] SubTask 18.2: 实现 `[[wikilink]]` 实时高亮（主色调加粗）+ 输入 `[[` 时自动补全已有 Wiki 标题
  - [ ] SubTask 18.3: 实现跳转逻辑：存在则跳转，不存在则创建以链接文本为标题的新草稿
  - [ ] SubTask 18.4: 实现 References（来源 Episode）与 Backlinks（反向链接）计算

- [ ] Task 19: WikiView 与 Review Queue（依赖 Task 18）
  - [ ] SubTask 19.1: 编写 `src/views/WikiView.tsx`：左侧目录树（项目/人名/知识点）+ 中间编辑面板 + 右侧 References/Backlinks
  - [ ] SubTask 19.2: 实现 Review Queue 悬浮条：扫描 `wiki_eligible=1 AND wiki_status='eligible'` 的 Episode，红点提示数量
  - [ ] SubTask 19.3: 实现"一键接受"：调用 `save_to_wiki` IPC，状态置 `draft`，清空红点
  - [ ] SubTask 19.4: 实现 `save_to_wiki` 后端命令：写 `wiki_pages` + 更新 `clean_episodes.wiki_status='saved'`

- [ ] Task 20: GraphView 记忆图谱（依赖 Task 19）
  - [ ] SubTask 20.1: 编写 `src/views/GraphView.tsx`：前端轻量力导向图引擎（人/事/项目/时间/文档 5 类节点，不同颜色）
  - [ ] SubTask 20.2: 基于 SQLite 外键 + `[[wikilink]]` 文本关联计算边
  - [ ] SubTask 20.3: 实现双击节点穿梭回 Episode 详情（复用 TodayView 的 MemoryCard）

- [ ] Task 21: P2 集成验收
  - [ ] SubTask 21.1: 执行 `09_PRODUCT_ACCEPTANCE_LEDGER.md` 用例 7（[[wikilink]] 动态跳转与 Review Queue）
  - [ ] SubTask 21.2: 模糊语义检索测试："昨天那个蓝色背景的 PPT" 应通过向量召回对应 memory_cell

## 收尾：全量视觉与文档治理

- [ ] Task 22: 设计治理 3 秒法则验收
  - [ ] SubTask 22.1: 对 TodayView/CalendarView/SearchView/InsightsView/WikiView/GraphView/ReportsView/SettingsView 逐页截图自检
  - [ ] SubTask 22.2: 校验无 Hardcode 颜色（全部走 CSS 变量）、无系统滚动条、无白色闪烁、圆角统一 8px/Modal 12px
  - [ ] SubTask 22.3: 校验空状态温暖插图 + 引导文案、Loading 骨架屏、Deleted 撤销浮条、Private 紫色斜条

# Task Dependencies
- Task 1 (工程骨架) → 所有后续 Task
- Task 2 (CSS Token + types) → Task 7、Task 11、Task 14、Task 18、Task 19、Task 20
- Task 3 (DB 层) → Task 4、Task 8、Task 9、Task 13、Task 17、Task 19
- Task 4 (capture) → Task 8、Task 9
- Task 5 (OCR) → Task 8、Task 9
- Task 6 (mascot window) → Task 8、Task 15
- Task 7 (前端框架 + Mascot 组件) → Task 11、Task 14、Task 18
- Task 8 (IPC) → Task 9、Task 10、Task 11、Task 15、Task 19
- Task 9 (distill) → Task 10、Task 17
- Task 10 (report) → Task 11、Task 12
- Task 11 (P0 视图) → Task 12、Task 14、Task 18
- Task 12 (P0 验收) → Task 13、Task 14、Task 15（P1 可在 P0 验收后并行启动）
- Task 13 (FTS5 查询) → Task 14、Task 17
- Task 14 (P1 视图) → Task 16
- Task 15 (Mascot 2.0) → Task 16
- Task 16 (P1 验收) → Task 17、Task 18、Task 19、Task 20（P2 可在 P1 验收后启动）
- Task 17 (向量检索) → Task 20、Task 21
- Task 18 (双链编辑器) → Task 19、Task 20
- Task 19 (WikiView) → Task 20、Task 21
- Task 20 (GraphView) → Task 21
- Task 22 (视觉验收) 依赖全部功能 Task 完成

# Parallelizable Work
- L1 阶段：Task 3 / Task 4 / Task 5 / Task 6 / Task 7 完全可并行
- L2 阶段：Task 8 / Task 9 / Task 10 在 IPC 契约冻结后可并行
- P1 阶段：Task 13 / Task 14 / Task 15 可并行
- P2 阶段：Task 17 / Task 18 可并行，Task 19 / Task 20 串行
