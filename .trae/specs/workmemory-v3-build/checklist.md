# Checklist

## L0 根地基
- [ ] Task 1: Tauri 2.x + React 18 + Vite 5 工程骨架在 `/workspace/workmemory-app/` 落盘，目录结构严格匹配 `03_CORE_ARCHITECTURE.md` §1
- [ ] Task 1: `src-tauri/Cargo.toml` 与 `package.json` 的依赖版本与 `01_ARCHITECTURAL_DECISIONS.md` §3 完全一致（tauri 2.0、rusqlite 0.31 bundled+modern_sqlite、windows 0.58 含 Media_Ocr/Graphics_Imaging、react 18.3、zustand 4.5、Radix 全套、lucide-react、zod、vite 5.2）
- [ ] Task 1: `tauri.conf.json` 主窗口 1280×720 + `decorations:false` + Mascot 透明窗口 `label:"mascot"` + `assetProtocol` 启用 scope `$RESOURCE/pet/**` + `bundle.resources` 声明 `pet/*`
- [ ] Task 1: `/workspace/pet/{1..9}/spritesheet.webp` 与 `pet.json` 已复制到 `workmemory-app/src-tauri/resources/pet/`
- [ ] Task 2: `src/styles/variables.css` 完整定义 `04_UI_SPEC.md` §1 全部 CSS 变量（基础色板、语义强调色、圆角、间距、阴影、毛玻璃）
- [ ] Task 2: `src/styles/index.css` 实现 Reset、`-webkit-app-region: drag`、HTML/Body 背景与 `--color-bg-base` 一致、Radix ScrollArea 半透明自动隐藏滚动条
- [ ] Task 2: `src/types/index.ts` 完整定义 `02_DATA_MODEL.md` §4 全部 TS 接口（WorkSegment、CleanEpisode、MemoryCell、WikiPage、WorkReport、PrivacyRule、AppSetting），字段名 camelCase

## L1 基础服务层
- [ ] Task 3: `db/connection.rs` 配置 `PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON`
- [ ] Task 3: `db/migrations.rs` 完整执行 `02_DATA_MODEL.md` §2 的 9 张表 DDL（segments/clean_episodes/memory_cells/embeddings/distill_runs/wiki_pages/reports/privacy_rules/settings）+ 全部索引
- [ ] Task 3: `db/migrations.rs` 完整建立 §3 的 3 个 FTS5 虚拟表（fts_segments/fts_clean_episodes/fts_wiki）与 9 个触发器（ai/ad/au × 3 表）
- [ ] Task 3: `models.rs` Rust 结构体字段与 DB schema 一一对应，serde 序列化为 camelCase 对齐前端
- [ ] Task 3: `db/repository.rs` 提供 9 张表的 CRUD + FTS5 highlight+snippet 查询函数
- [ ] Task 3: 单元测试覆盖：表创建成功、FTS5 触发器同步生效、FTS5 检索返回 snippet
- [ ] Task 4: `core/capture.rs` 1000ms 轮询前台窗口（GetForegroundWindow + GetWindowText）
- [ ] Task 4: 隐私守卫命中 `privacy_rules` 时插入 `is_private=1, ocr_status='skipped', screenshot_path=''` 并广播 `privacy-triggered`
- [ ] Task 4: pHash 95% 相似度 Merge 逻辑生效（不重复创建 Segment）
- [ ] Task 4: 180s 静止进入 Idle 停止轮询，鼠标键盘唤醒恢复 Recording
- [ ] Task 4: 截图仅内存流转不入磁盘（除用户在 Settings 显式开启 saveScreenshots）
- [ ] Task 5: `core/ocr.rs` 调用 `windows::Media::Ocr::OcrEngine`，支持中英文
- [ ] Task 5: `SoftwareBitmap` 从 image crate RGBA buffer 转换成功
- [ ] Task 5: `ocr_queue` 通过 Tokio Semaphore 限制并发=2
- [ ] Task 5: `ocr_text_cleaner` 完成去重、去噪、合并多行
- [ ] Task 6: Mascot 窗口 `transparent:true` + `always_on_top:true` + `skip_taskbar:true` + `decorations:false`
- [ ] Task 6: 设置 `WS_EX_NOACTIVATE` 防夺焦（点击 Mascot 不导致当前应用失焦）
- [ ] Task 6: 拖拽事件转发与贴边磁吸坐标计算（右下角优先）实现
- [ ] Task 7: `src/App.tsx` HashRouter + 三栏布局（Sidebar 72px + Main 860px + Context 348px）+ Top Bar 状态指示
- [ ] Task 7: 自定义无边框 Titlebar（最小化/最大化/关闭 + drag 区域，按钮区排除 drag）
- [ ] Task 7: `MascotSprite.tsx` 严格按 `04_UI_SPEC.md` §5.4 实现：CELL_W=192、CELL_H=208、STATE_ROWS 9 行配置、background-position 步进、`asset://localhost/pet/{id}/spritesheet.webp`、`imageRendering: pixelated`、非循环动画 onAnimationEnd 回调
- [ ] Task 7: `useAppStore.ts` Zustand 状态：recorderState、episodes、activeView、settings、mascotId、mascotState
- [ ] Task 7: `recorderStateToMascotState` 映射函数与 `04_UI_SPEC.md` §5.5 完全一致（recording→idle、idle→sleep、paused→sit、privacy_mode→special、error→sit）
- [ ] Task 7: `MascotWindow.tsx` 监听 `recorder-state-changed`/`privacy-triggered`/`report-ready`，处理 drag/fall 一次性动画与贴边磁吸
- [ ] Task 7: `mock.ts` Mock 挡板覆盖全部 IPC 命令（get_recorder_state、get_today_summary、get_episodes_by_date 等）
- [ ] Task 7: `api.ts` 统一 invoke 封装自动检测 Tauri/Web 环境切换 Mock

## L2 粘合与核心逻辑
- [ ] Task 8: `ipc/commands.rs` 注册 `03_CORE_ARCHITECTURE.md` §3.1 全部 9 个 `#[tauri::command]`（get_recorder_state、set_recorder_state、trigger_manual_capture、get_today_summary、get_episodes_by_date、update_episode_title_summary、search_memories、generate_report、save_to_wiki），函数名与入参完全对应
- [ ] Task 8: `ipc/events.rs` 定义并广播 6 个事件（recorder-state-changed、segment-captured、privacy-triggered、distill-completed、focus-remind、report-ready）的 Payload 结构
- [ ] Task 8: `main.rs` 注册命令、初始化 DB、启动 capture 轮询、启动整点 distill 调度
- [ ] Task 8: Tauri tray-icon 系统托盘 + 全局快捷键 `Ctrl+Shift+C`（Ghost Capture）配置完成
- [x] Task 9: `core/distill.rs` 整点 HH:00 触发，检查 `distill_runs` 幂等（已 done 则跳过）
- [x] Task 9: AI 蒸馏管道使用 `08_AI_PROMPTS.md` §1 的 `build_distill_prompt`，强约束 JSON Mode 解析（首字符 `{` 末字符 `}`），原子写入 `clean_episodes` + `memory_cells`
- [x] Task 9: No-AI 物理聚类降级：基于 App 邻近度与 10 分钟时间窗聚类，提取窗口标题关键词组装 Title
- [x] Task 9: 今日一句话总结：有 Key 走 LLM，无 Key 走规则统计模板
- [x] Task 9: 蒸馏完成后广播 `distill-completed`
- [ ] Task 10: `core/report.rs` `generate_report` 命令实现，支持 4 模板（enhanced/concise/okr/structured）
- [ ] Task 10: AI 生成使用 `08_AI_PROMPTS.md` §2 的 `build_report_prompt`
- [ ] Task 10: 降级模板拼接按 `05_INTERACTION.md` §4.2 的 Bullet 模板格式化
- [ ] Task 10: 写入 `reports` 表并广播 `report-ready`（触发 Mascot jump Row 5 一次性动画）
- [x] Task 11: `TodayView.tsx` SummaryBar（毛玻璃大圆角 + 15px 加粗主色调 + 内联编辑 + "用户已改写"徽标）
- [x] Task 11: `TodayView.tsx` TimelineRail（垂直灰色虚线贯穿）+ MemoryCard（时间戳/标题双击改写/13px 摘要/App+项目+证据 Chip/五角星/保存 Wiki 按钮）
- [x] Task 11: `TodayView.tsx` 空状态（Mascot sleep 动画 + 14px 灰字引导 + 恢复记录按钮）
- [x] Task 11: `MemoryCard.tsx`/`TimelineRail.tsx`/`SourceBadge.tsx` 原子组件独立可复用
- [x] Task 11: `ReportsView.tsx` 左侧 Episode Checklist（批量多选/反选）+ 右侧 Markdown 编辑器 + 4 模板切换 + Regenerate/Copy Rich Text/Export Markdown 顶栏
- [x] Task 11: 富文本复制同时写入 `text/html` + `text/plain`，飞书/钉钉粘贴保持标题级差/加粗/Bullet/行内代码样式
- [x] Task 11: `SettingsView.tsx` 通用设置（API Key/模型/保留天数/截图开关/Embedding 开关/Mascot 透明度/活跃频率）
- [x] Task 11: `SettingsView.tsx` 伙伴选择 UI（9 张 idle 缩略图 scale=0.5，当前选中 `2px solid var(--color-primary)` 边框，点击即时写入 `settings.mascot_id`，下方标注中文名）
- [x] Task 11: SummaryBar 与 MemoryCard 实现 6 种状态（Normal/Hover/Active/Loading 骨架屏/Deleted 撤销浮条 8 秒/Private 紫色斜条 + 🔒 标题替换）

## P0 集成验收（Checkpoint 1）
- [ ] Task 12: Mock 挡板下 TodayView/ReportsView/SettingsView UI 走线通过
- [ ] Task 12: Tauri 环境下 capture→ocr→distill→today→report 全链路打通
- [ ] Task 12: 用例 1（隐私黑名单拦截）通过：Mascot 拉帘、托盘变紫、`segments` 新增 `is_private=1, ocr_status='skipped'`、Timeline 显示 `🔒 已保护隐私窗口`
- [ ] Task 12: 用例 2（静止 Idle 防抖）通过：3 分钟无操作切换 Idle + Mascot sleep + 停止轮询 + 唤醒恢复
- [ ] Task 12: 用例 3（蒸馏幂等）通过：`distill_runs` 记录 running→done，重启后不重复执行
- [ ] Task 12: 用例 4（无 AI 降级）通过：无 Key 时静默降级为本地聚类，不抛错弹窗，日报走降级模板
- [ ] Task 12: 用例 5（富文本复制兼容）通过：飞书/钉钉粘贴样式完整保留
- [ ] Task 12: 性能红线：轮询 CPU < 2%、OCR < 150ms、报告 First Token < 1s

## P1 历史反查与时间审计
- [ ] Task 13: `search_memories` 实现 FTS5 `highlight()` + `snippet()` 跨 segments/clean_episodes/wiki_pages 三表联合查询
- [ ] Task 13: 返回 `SearchResult` DTO 含 source_id/source_type/date/time_range/primary_text/snippet/score/match_reason
- [ ] Task 13: 10w 条 Segment 下 top-20 检索 < 30ms（基准测试通过）
- [ ] Task 14: `CalendarView.tsx` 7×6 月历网格 + 工作强度绿/青渐变条 + 日格一句话缩写省略号 + 已生成日报灰色 ✔ 徽章 + 右侧 Context 面板
- [ ] Task 14: `SearchView.tsx` 大圆角搜索框 + `Ctrl+K` 全局快捷键 + 双栏（Episode Matches / OCR Snippets）+ 命中原因标签 + `==关键字==` 浅黄高亮（border-radius:2px）+ 双击反查右侧 Context
- [ ] Task 14: `InsightsView.tsx` 时间分布饼图 + 异常频繁切换提醒卡 + 未完成线索卡 + 深度专注统计卡
- [ ] Task 14: `InsightCard.tsx` 原子组件独立可复用
- [ ] Task 15: 气泡频控算法：每小时 ≤1 次、隐私首闪、6 秒淡出、× 关闭当日同类禁推、累计 3 次当日全禁
- [ ] Task 15: 右键快捷菜单包含 `05_INTERACTION.md` §2.4 全部菜单项（打开主窗口/暂停恢复/隐私模式/快速捕捉/生成日报/查看总结/隐藏 1 小时/隐藏今天/更换形象/设置）
- [ ] Task 15: 17:30-19:30 日报复盘气泡（jump 动画 + 中性话术，无评判字眼）
- [ ] Task 15: 45 分钟专注休息提醒（focus-remind 事件 + 端茶气泡）
- [ ] Task 15: 10 分钟/30 次切换降噪建议（InsightsView 卡片 + 头顶轻提示）
- [ ] Task 15: Mascot 全屏/演示/专业软件（devenv/idea64/Photoshop）前台时自动降透明度至 0.15
- [ ] Task 16: 用例 6（OCR 关键词毫秒高亮反查）通过：搜索"退款异常"瞬间展示 `...确认了==退款异常==枚举...`，双击反查原始 Segment
- [ ] Task 16: FTS5 < 30ms / 10w 条、Mascot 内存 < 20MB、吸附 60fps 性能红线通过

## P2 知识沉淀与关系网
- [ ] Task 17: `core/embedding.rs` OpenAI `text-embedding-3-small` 客户端（reqwest rustls-tls）实现
- [ ] Task 17: 蒸馏后异步向量化 `memory_cells` 事实文本，写入 `embeddings` 表（f32 LE 字节序列）
- [ ] Task 17: 本地余弦相似度召回（加载全部 embeddings 到内存做 top-k）
- [ ] Task 17: `search_memories` 融合 FTS5 + 向量结果（混合 score）
- [ ] Task 18: 自研 Markdown 编辑器渲染标题/加粗/列表/代码/引用
- [ ] Task 18: `[[wikilink]]` 实时高亮（主色调加粗）+ 输入 `[[` 自动补全已有 Wiki 标题
- [ ] Task 18: 跳转逻辑：存在则跳转，不存在则创建以链接文本为标题的新草稿
- [ ] Task 18: References（来源 Episode）与 Backlinks（反向链接）计算实现
- [ ] Task 19: `WikiView.tsx` 左侧目录树（项目/人名/知识点）+ 中间编辑面板 + 右侧 References/Backlinks
- [ ] Task 19: Review Queue 悬浮条扫描 `wiki_eligible=1 AND wiki_status='eligible'`，红点提示数量
- [ ] Task 19: "一键接受"调用 `save_to_wiki`，状态置 `draft`，清空红点
- [ ] Task 19: `save_to_wiki` 后端命令写 `wiki_pages` + 更新 `clean_episodes.wiki_status='saved'`
- [ ] Task 20: `GraphView.tsx` 力导向图引擎，5 类节点（人/事/项目/时间/文档）不同颜色
- [ ] Task 20: 基于 SQLite 外键 + `[[wikilink]]` 文本关联计算边
- [ ] Task 20: 双击节点穿梭回 Episode 详情（复用 MemoryCard）
- [ ] Task 21: 用例 7（[[wikilink]] 动态跳转与 Review Queue）通过：手写 `[[退款接口说明]]` 高亮加粗，点击创建新草稿，Review Queue 接受后清空红点
- [ ] Task 21: 模糊语义检索："昨天那个蓝色背景的 PPT" 通过向量召回对应 memory_cell

## 跨阶段治理与红线
- [ ] Task 22: 8 大主页面（Today/Calendar/Search/Insights/Wiki/Graph/Reports/Settings）逐页截图通过 3 秒法则
- [ ] Task 22: 全代码无 Hardcode 颜色（grep `#[0-9a-fA-F]{3,6}` 与 `rgb(` 仅出现在 variables.css）
- [ ] Task 22: 无系统滚动条（全部走 Radix ScrollArea）、无白色闪烁、圆角统一 8px / Modal 12px
- [ ] Task 22: 空状态温暖插图 + 引导文案、Loading 局部骨架屏、Deleted 撤销浮条 8 秒、Private 紫色斜条 + 🔒 标题
- [ ] Task 22: 禁用 Tailwind CSS 与 Fluent UI v9（package.json 无相关依赖）
- [ ] Task 22: 禁用 PaddleOCR（Cargo.toml 无相关依赖）
- [ ] Task 22: 无键盘记录器代码、无截图离域上传、无强弹窗 Modal、无评判式话术（"低效"/"摸鱼"/"浪费时间" 等字眼 grep 为空）
- [ ] Task 22: 桌面伙伴动画全部通过 `MascotSprite` + `STATE_ROWS` 驱动，无 GIF/APNG，直接读取 `pet/{1..9}/spritesheet.webp`
