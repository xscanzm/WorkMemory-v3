# WorkMemory 01: 核心架构决策 (Architectural Decisions & ADR)

> **文档定位**：本项目最高技术决策文档（ADR），定义技术栈、核心引擎及模块分期。AI Coding Agent 在编写代码、配置环境、设计数据库、选择库依赖时，必须无条件遵守本文档。如有其他文档与本文档冲突，**以本文档为准**。

---

## 1. 核心技术栈决策 (Technology Stack)

```
┌─────────────────────────────────────────────────────────┐
│                    WorkMemory 架构                      │
├─────────────────────────────────────────────────────────┤
│  前端层 (Frontend): React 18 + TS + Vite 5               │
│  状态与路由: Zustand + React Router Dom (HashRouter)    │
│  UI 组件与样式: Radix Primitives + 自研 CSS 变量设计系统  │
├─────────────────────────────────────────────────────────┤
│  IPC 通信桥梁: Tauri 2.x (tauri::command / emit)         │
├─────────────────────────────────────────────────────────┤
│  后端层 (Backend): Rust Stable (1.77+) + Tokio (异步)    │
│  本地存储: SQLite (rusqlite 0.31, WAL 模式)             │
│  OCR 引擎: Windows WinRT Media.Ocr                       │
└─────────────────────────────────────────────────────────┘
```

### 1.1 为什么选择 Tauri 2.x 而非 Electron
*   **决策**：锁定 **Tauri 2.x + React** 作为桌面壳与前端基础。
*   **理由**：
    1.  **极轻量**：Tauri 2.x 打包产物仅 10-15MB，运行内存占用极低（约 30-50MB），而 Electron 动辄 100MB+、内存占用 150MB+。这对于需要 24 小时后台常驻的工具而言是决定性的。
    2.  **安全性**：Tauri 2.x 进程隔离更严密，Rust 后端天然免疫大量内存安全漏洞。
    3.  **系统原生集成**：Tauri 2.x 对 Windows 托盘、单例启动、快捷键注册有极佳的支持，无需第三方原生模块编译。

### 1.2 为什么禁用 Tailwind CSS 和 Fluent UI v9 库
*   **决策**：**完全禁用 Tailwind CSS 编译器**与 **Fluent UI v9 组件库**。采用 **Radix UI Primitives + 自研 CSS 变量设计系统**。
*   **理由**：
    1.  **打包与性能体积**：Fluent UI v9 为大型企业级 Web 网页设计，打包体积巨大，在 Tauri Webview 中渲染开销重，容易产生“网页套壳感”。
    2.  **Tailwind 构建开销**：在 Rust/Tauri 混合工程中，Tailwind 的 PostCSS 编译链常与 Vite 产生配置冲突，且不易在多个独立窗口（主窗口、透明 Mascot 窗口）间共享轻量样式。
    3.  **自研设计系统**：通过原生 CSS Variables（定义在 `:root` 中）和干净的 CSS 模块（CSS Modules）定义阴影、圆角（6-8px）、色彩 token、毛玻璃材质。配合 Radix 无样式原语（无样式、无侵入，仅提供 A11y 行为），可以手写出极高颜值、流畅、完全自主可控的 Fluent/Linear 混合质感 UI。

---

## 2. 本地 OCR 决策：WinRT Media.Ocr

*   **决策**：锁定 **Windows 原生 WinRT OCR 引擎 (windows::Media::Ocr)**。**完全禁用 PaddleOCR (PP-OCRv6)**。
*   **理由**：
    1.  **零运行依赖**：WinRT OCR 是 Windows 10/11 操作系统自带的系统级 API。我们不需要在打包时塞入 100MB+ 的 Paddle 推理 Runtime、不需要打包 C++ DLL 依赖、不需要在用户电脑上解压 Python 运行时或庞大的 `.pdparams` 模型文件。
    2.  **极低 CPU/内存占用**：WinRT OCR 直接调用系统组件，速度极快（单张截图识别通常在 30-80ms 内），内存开销几乎为零，非常适合后台低能耗常驻。
    3.  **版面识别退避**：P0 阶段我们不需要 Paddle 的高精度版面分析（Layout Analysis）和表格还原，只需要干净的文字、坐标和置信度，这对于 WinRT OCR 绰绰有余。

---

## 3. 核心依赖管理 (Key Dependencies)

AI Coding Agent 在生成 `Cargo.toml` 和 `package.json` 时必须锁定以下依赖库：

### 3.1 Rust 后端依赖 (Cargo.toml)
```toml
[dependencies]
tauri = { version = "2.0", features = ["tray-icon", "system-tray", "global-shortcut"] }
tauri-plugin-shell = "2.0"
tauri-plugin-keychain = "2.0" # 用于加密存储 API Key
tokio = { version = "1.35", features = ["full"] }
rusqlite = { version = "0.31", features = ["bundled", "modern_sqlite"] } # 捆绑编译最新的 SQLite，确保支持 FTS5
chrono = { version = "0.4", features = ["serde"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
image = "0.24" # 用于截图图像解码和 pHash 计算
uuid = { version = "1.6", features = ["v4", "serde"] }
reqwest = { version = "0.12", features = ["json", "stream", "rustls-tls"] }
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_UI_WindowsAndMessaging",
    "Win32_System_Threading",
    "Win32_Graphics_Gdi",
    "Media_Ocr",
    "Graphics_Imaging"
] }
```

### 3.2 前端依赖 (package.json)
```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.23.0",
    "zustand": "^4.5.2",
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-tooltip": "^1.0.7",
    "@radix-ui/react-popover": "^1.0.7",
    "@radix-ui/react-dropdown-menu": "^2.0.6",
    "@radix-ui/react-scroll-area": "^1.0.5",
    "lucide-react": "^0.379.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "vite": "^5.2.11"
  }
}
```

---

## 4. 无 AI 降级模式决策 (No-AI Fallback Mode)

为解决“用户未配置 API Key”或“网络断开”时产品直接报废、导致用户流失的重大缺陷，系统必须无缝支持**本地非 AI 运行模式**。

### 4.1 核心表现对比
| 功能模块 | AI 在线状态 (With API Key) | AI 离线/未配置状态 (No-AI Fallback) |
|---|---|---|
| **今日一句话总结** | AI 分析一整天主线，总结为 1-2 句流畅的自然语言。 | **基于规则的统计总结**：“今天你主要使用了 [Word] 和 [Edge]，专注时长共计 4 小时，产生了 12 条线索。” |
| **小时级蒸馏 (Episode)** | AI 将重复 Segment 智能聚合成主题清晰的 Episode，去除垃圾信息。 | **基于时间/应用邻近度的聚类算法**：10分钟内没有窗口切换或在同个 App 中，自动聚合成一个“活动时间块 (TimeBlock)”。 |
| **全局搜索** | 支持向量语义搜索 + 自然语言模糊描述（如“上周改的蓝色 PPT”）。 | **高精度本地 FTS5 全文检索**：支持拼音/英文精确、通配符匹配。 |
| **日报生成** | AI 提炼排版优雅、带有逻辑关联的富文本日报（Markdown）。 | **模板化文本拼接导出**：将用户勾选的事件，按时间戳、窗口标题和应用名称，格式化拼装成干净的 Bullet List 文本直接导出。 |
| **知识 Wiki & 双链** | AI 自动扫描 Episode 并提示沉淀双链知识，生成摘要。 | **纯人工双链沉淀**：用户手动创建 Wiki 页面，手写 `[[wikilink]]`，系统仅提供自动补全和历史 Segment 反查。 |

---

## 5. 项目分期决策 (Implementation Phasing)

我们不追求一次性塞满所有功能。采用“敏捷闭环，层层递进”的分期策略：

### P0：极简可用闭环 (Today & Daily Report MVP)
*   **目标**：解决核心刚需，打通“后台捕获 → 生成日报”的全链路。
*   **范围**：
    1.  **Window Watcher & Screen Capture**：自动监听窗口并截图（不保存、内存 OCR 后释放）。
    2.  **WinRT OCR**：毫秒级解析屏幕文字，保存文本入库。
    3.  **小时蒸馏 (Hour-bucket Distill)**：将上一小时的碎片降噪聚合成 Episode（有 Key 调用 LLM，无 Key 采用邻近度聚类）。
    4.  **今日页主 UI**：展示 Timeline、Episode 列表、今日一句话总结。
    5.  **Mascot（桌面伙伴）1.0**：透明窗口显示状态（正在记录/已暂停/隐私模式），支持右键菜单。
    6.  **日报生成**：一键生成 MarkDown/富文本日报并提供一键复制。

### P1：记忆穿梭与智能分析 (Search, Calendar & Insights)
*   **目标**：提供历史回顾、全局反查及低干扰主动提醒。
*   **范围**：
    1.  **日历复看 (Calendar)**：支持月视图/周视图，查看历史任意一天的 Summary。
    2.  **FTS5 全文搜索**：秒级搜索历史窗口标题、OCR 文本。
    3.  **Insights（时间审计与主动洞察）**：生成时间分布、异常频繁切换提醒、未完成线索等 Insight 卡片。
    4.  **Mascot 2.0**：增加低频气泡、根据专注状态、隐私模式切换微表情。

### P2：知识沉淀与关系网 (Wiki, Vector Search & Graph)
*   **目标**：将记忆升级为可长期沉淀的个人资产。
*   **范围**：
    1.  **Wiki 知识库**：自研轻量双链 Markdown 编辑器，支持 Review Queue 推荐沉淀机制。
    2.  **向量语义检索**：接入 Embedding API，支持“我上周看过的蓝色背景 PPT”等高级意图搜索。
    3.  **记忆关系图谱 (Graph)**：基于 SQLite 外键和文本关联计算，渲染人、事、项目、时间、文档的连接导图。

---

## v3 设计合规补全 (2026-06)

> 本节记录 WorkMemory-v3 在「任务 / 宠物 / 专注 / 分析」四大新增业务域落地的架构决策，对应 `analysis_results.md` 中 8 个缺失引擎与 13 个缺失组件的补全。所有决策均已落地为 `/workspace/workmemory-app/src-tauri/src/core/` 下的可编译模块。

### A1. 任务引擎 (TaskEngine)
*   **决策**：任务 ID 由**后端统一生成 `uuid v4`**（`uuid::Uuid::new_v4()`），禁止前端用 `Date.now()` 拼接（修复 BUG-001）。状态采用**单向状态机** `inbox → todo → in_progress → completed → archived`，其中 `archived` 为终态不可再流转，由 `task_engine::validate_transition` 在 `update_task` 内强制守卫（修复 BUG-002/003）。任务全文检索复用 **FTS5 虚拟表 `fts_tasks`**，对中文子串场景在 FTS5 `MATCH` 无命中时回退 `LIKE` 模糊匹配（见 `task_engine.rs::search_tasks`）。
*   **实现**：`/workspace/workmemory-app/src-tauri/src/core/task_engine.rs`，公开 `save_task / get_all_tasks / get_task / update_task / delete_task / search_tasks / validate_transition`。

### A2. 宠物引擎 (PetEngine)
*   **决策**：桌面伙伴沿用 `pet/{1..9}/spritesheet.webp` 物理规格（cellWidth 192 / rowHeight 208 / 9 行），前端 `PetSpriteDisplay` 将 `pet_state.mood` 映射到 `MascotStateName`，精灵图加载失败时降级为 emoji（修复 BUG-012 空白方框）。XP 升级公式锁定为 `XP_needed = level*100 + (level-1)*50`（Level 1→100、2→250、3→400），由 `apply_xp` 循环处理连升。时间衰减按小时线性：`hunger -5%/hr、energy -3%/hr`，属性统一钳制到 `[0,100]`。
*   **实现**：`/workspace/workmemory-app/src-tauri/src/core/pet_engine.rs`，公开 `save_pet_state / get_pet_state / feed / play / rest / clean / on_task_completed / on_focus_completed / decay / apply_xp / xp_needed_for_next_level / infer_mood`，每次交互落 `pet_interaction_logs`。

### A3. 专注引擎 (FocusEngine)
*   **决策**：专注会话支持两种类型 `pomodoro`（番茄钟）/`free`（自由计时），会话生命周期 `start → complete|interrupt`，开始即落库 `focus_sessions`（写入计划时长），完成时回写 `end_time + 实际时长` 并发布 `FocusCompleted` 事件，中断时记录 `interrupted=1 + interruption_reason`。`complete_focus_session` 同步调用 `pet_engine::on_focus_completed`（+20 XP / +10 energy），best-effort 忽略未初始化错误。
*   **实现**：`/workspace/workmemory-app/src-tauri/src/core/focus_engine.rs`，公开 `start_focus_session / complete_focus_session / interrupt_focus_session / get_focus_session / get_today_focus_sessions`。

### A4. 分析引擎 (AnalyticsEngine)
*   **决策**：与基础 `stats_engine` 分层——本模块只负责**派生计算**。`calculate_streak` 从今日/昨日往前数连续有 `completed` 任务的日期数（允许今日未完成）。`on_task_completed / on_focus_completed` 以 `INSERT ... ON CONFLICT(date) DO UPDATE` 幂等 upsert `daily_stats`。生产力评分 `productivity_score = min(tasks*10 + focus_minutes, 100)`。
*   **实现**：`/workspace/workmemory-app/src-tauri/src/core/analytics_engine.rs`，公开 `calculate_streak / get_weekly_stats / on_task_completed / on_focus_completed / productivity_score / get_daily_stats`。

### A5. 事件总线 (EventBus)
*   **决策**：模块间解耦采用 `tokio::sync::broadcast` channel（容量 256），`AppEvent` 枚举含 `TaskCompleted / FocusCompleted / PetInteraction / PetLevelUp` 四类，全局单例由 `OnceLock` 持有（`global_event_bus()`）。`publish` 忽略无订阅者错误，订阅者通过 `subscribe()` 拿 `broadcast::Receiver`。
*   **实现**：`/workspace/workmemory-app/src-tauri/src/core/event_bus.rs`。

### A6. 后台调度器 (BackgroundScheduler)
*   **决策**：两条 `tauri::async_runtime::spawn` 协程——①每小时触发 `pet_engine::decay(&conn, 1.0)`；②每分钟检查本地时钟，命中 `23:00` 触发每日摘要（占位，实际蒸馏由 `distill` 模块负责）并随后睡眠 1 小时避免重复。调度器在 `lib.rs` 启动阶段注入 `AppHandle`，通过 `app.state::<Mutex<Connection>>` 取库连接。
*   **实现**：`/workspace/workmemory-app/src-tauri/src/core/scheduler.rs`，公开 `start_scheduler`。

### A7. 统一错误类型 (AppError) 与前端错误反馈
*   **决策**：新建 `core/error.rs` 定义 `AppError` 枚举（`DbError / IoError / NotFoundError / ValidationError / Internal`），`#[serde(tag="kind", content="message")]` 序列化便于前端按 `kind` 差异化处理。实现 `From<rusqlite::Error> / From<std::io::Error> / From<serde_json::Error>` 自动转换，并提供 `AppResult<T>` 别名。所有 Tauri 命令返回 `Result<T, AppError>` 替代裸 `Result<T, String>`（修复 BUG-013）。
*   **前端策略**：所有用户可见操作通过 `Toast`（`createPortal` 渲染、毛玻璃 + 左侧 4px 语义色边框、3 秒自动消失、`×` 手动关闭，类型 `success/error/info`）反馈成败；`ErrorBoundary`（React class 组件）捕获渲染期异常并展示降级 UI + 重试按钮，包裹整个 `MainLayout`。`ConfirmDialog` 负责破坏性操作（删除/归档）二次确认。
*   **实现**：`/workspace/workmemory-app/src-tauri/src/core/error.rs`、`/workspace/workmemory-app/src/components/Toast.tsx`、`/workspace/workmemory-app/src/components/ErrorBoundary.tsx`、`/workspace/workmemory-app/src/components/ConfirmDialog.tsx`。
