# WorkMemory 03: 核心架构与 IPC 通信契约 (Core Architecture & IPC)

> **文档定位**：定义系统前后端模块布局、核心处理管线（截图、OCR、蒸馏）及前后端 IPC 通信协议。开发人员与 AI Coding Agent 必须严格按照此契约设计接口与目录结构。

---

## 1. 物理工程目录布局 (Project Layout)

Tauri 2.x 标准双层结构工程布局：

```
workmemory-app/
├── Src-tauri/                 # Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs            # 应用入口与 Tauri 初始化
│       ├── core/              # 核心服务层（单例与逻辑核心）
│       │   ├── capture.rs     # 窗口监听、隐私守卫、截图调度
│       │   ├── ocr.rs         # WinRT OCR 引擎封装、队列
│       │   ├── distill.rs     # 小时蒸馏引擎、非 AI 聚类降噪
│       │   ├── embedding.rs   # 语义向量生成、本地余弦检索
│       │   └── mascot.rs      # 桌面伙伴窗口状态控制器
│       ├── db/                # 存储层
│       │   ├── connection.rs  # SQLite 链接初始化、WAL 模式、备份
│       │   ├── migrations.rs  # 数据库迁移系统
│       │   └── repository.rs  # 统一存储库封装（Segments, Episodes 等）
│       ├── ipc/               # IPC 接口注册层（tauri::command）
│       │   ├── commands.rs    # 前端调用的 Rust 指令
│       │   └── events.rs      # 后端向前端广播的事件
│       └── models.rs          # 共享 Rust 数据结构 (对应 DB schemas)
│
├── src/                       # React 前端
│   ├── index.html
│   ├── main.tsx
│   ├── src-tauri/             # 自动生成的 Tauri JS API
│   ├── types/
│   │   └── index.ts           # 前端统一 TypeScript 接口定义
│   ├── styles/
│   │   ├── variables.css      # 全局 CSS 变量（色彩、间距、圆角、字号）
│   │   └── index.css          # 基础 Reset 与全局毛玻璃类定义
│   ├── store/
│   │   └── useAppStore.ts     # Zustand 统一全局状态机
│   ├── components/            # 跨页面通用原子组件
│   │   ├── MascotWindow.tsx   # 透明 Mascot 独立渲染组件
│   │   ├── TimelineRail.tsx   # 时间穿梭/片段流线组件
│   │   ├── MemoryCard.tsx     # 记忆事件卡片
│   │   └── SourceBadge.tsx    # 数据来源小徽章
│   ├── views/                 # 八大主页面入口
│   │   ├── TodayView.tsx
│   │   ├── CalendarView.tsx
│   │   ├── SearchView.tsx
│   │   ├── InsightsView.tsx
│   │   ├── WikiView.tsx
│   │   ├── GraphView.tsx
│   │   ├── ReportsView.tsx
│   │   └── SettingsView.tsx
│   └── App.tsx                # 路由配置 (HashRouter)与初始化
```

---

## 2. 核心数据管线逻辑 (Data Pipelines)

### 2.1 P0：屏幕捕获与 OCR 识别管线 (Capture & OCR)

```
 [1000ms 轮询检测]
 Foreground Window 
       │
       ▼
 检查是否命中隐私规则? ────(Yes)────► 截图判定: Skip / Create PrivacyPlaceholder
       │(No)
       ▼
 检查窗口标题/进程是否变化? ────(No)──► 静止 180s? ──► 进入 Idle 状态，暂停截图
       │(Yes, 且稳定 3s)
       ▼
  [CaptureAction]
 1. Create: 创建新 Segment (截图 + pHash)
 2. Merge: 与上一 Segment 的 pHash 相似度 > 95% -> 合并、增加时长
       │
       ▼ (异步入队)
  [OCR 后台队列] ──► 限制并发数: 2
       │
       ▼
 Windows WinRT Media.Ocr 识别 ──► 成功 ──► Cleaner 清洗文本 ──► 写入数据库 segments
```

### 2.2 P0：整点数据蒸馏管线 (Hourly Distillation)

```
        每到整点 (HH:00) 触发
                 │
                 ▼
 检查 distill_runs 表中该小时是否已蒸馏? ──(Yes, 状态为 done)──► 跳过 (幂等)
                 │(No)
                 ▼
     读取上一小时所有有效 segments
                 │
    ┌────────────┴────────────┐
    ▼ (已配置 OpenAI Key)      ▼ (未配置 API Key / 离线)
[AI 蒸馏管道]             [No-AI 聚类管道]
 1. 组装 OCR 文本与时间线     1. 基于 App 邻近度与时间间隔聚类
 2. 调用 Chat Completion     2. 提取窗口标题关键词组装 Title
 3. 强约束 JSON 返回          3. 生成统计性 Summary (无语义提炼)
    └────────────┬────────────┘
                 ▼
 批量原子写入 clean_episodes & memory_cells
                 │ (若有 Key 且开启 Embedding)
                 ▼
 异步调用 text-embedding-3-small ──► 写入 embeddings 表 ──► 结束
```

---

## 3. IPC 通信协议与契约 (IPC Contract)

### 3.1 Rust 后端对外提供的 #[tauri::command]

所有指令必须在前端通过 `@tauri-apps/api/core` 调用。AI Coding Agent 必须保证函数名和入参完全对应：

#### 3.1.1 捕获控制指令 (Capture Control)
```rust
#[tauri::command]
async fn get_recorder_state() -> Result<String, String>;
// 返回: "Recording", "Paused", "PrivacyMode", "Idle"

#[tauri::command]
async fn set_recorder_state(state: String) -> Result<(), String>;
// 入参 state: "Recording", "Paused", "PrivacyMode"

#[tauri::command]
async fn trigger_manual_capture() -> Result<String, String>;
// 触发一次 Ghost Capture，返回截取的 OcrText 纯文本
```

#### 3.1.2 记忆查询指令 (Query Memories)
```rust
#[tauri::command]
async fn get_today_summary(date: String) -> Result<String, String>;
// 获取指定日期的一句话总结

#[tauri::command]
async fn get_episodes_by_date(date: String) -> Result<Vec<CleanEpisode>, String>;
// 获取某一天的聚合 Episode 列表

#[tauri::command]
async fn update_episode_title_summary(id: String, title: String, summary: String) -> Result<(), String>;
// 用户手动编辑 Episode
```

#### 3.1.3 全文与语义检索 (Search)
```rust
#[tauri::command]
async fn search_memories(query: String, date_range: Option<(String, String)>) -> Result<Vec<SearchResult>, String>;
// 返回包含 FTS5 全文匹配 snippet 与向量语义匹配度（若可用）的混合结果
```

#### 3.1.4 报告与 Wiki (Report & Wiki)
```rust
#[tauri::command]
async fn generate_report(date: String, template_type: String) -> Result<WorkReport, String>;
// 生成并保存报告

#[tauri::command]
async fn save_to_wiki(episode_id: String, title: String, content: String, tags: Vec<String>) -> Result<WikiPage, String>;
// 将 Episode 保存为 Wiki 页面
```

---

### 3.2 后端主动广播的 AppEvent (Backend-to-Frontend Events)

使用 `tauri::Emitter` 向所有前端 Webview 广播的事件（前端通过 `listen()` 监听）：

| 事件名称 | 负载结构 (Payload) | 触发时机 | 预期前端响应 |
|---|---|---|---|
| `recorder-state-changed` | `{"state": "Recording" \| "Paused" \| "PrivacyMode" \| "Idle"}` | 后端状态机发生流转时。 | 全局 UI 状态同步，Mascot 窗口动作切换。 |
| `segment-captured` | `{"id": "...", "app_name": "...", "window_title": "..."}` | 每次生成新的 segment 时。 | 今日页原始 Timeline 实时追加节点。 |
| `privacy-triggered` | `{"app_name": "..."}` | 命中隐私黑名单规则时。 | 桌面伙伴展示“拉帘”动画并浮现气泡。 |
| `distill-completed` | `{"date": "...", "hour_bucket": "..."}` | 整点蒸馏完成入库时。 | 今日页静默刷新 Episode 卡片流，更新今日一句话。 |
| `focus-remind` | `{"minutes": 45}` | 用户深度专注持续 45 分钟无打断。 | 桌面伙伴展示“递茶”或休息气泡。 |

---

### 3.3 共享数据交换结构 (Rust SearchResult DTO)

```rust
#[derive(serde::Serialize, serde::Deserialize)]
pub struct SearchResult {
    pub source_id: String,
    pub source_type: String,     // "segment", "episode", "wiki"
    pub date: String,
    pub time_range: String,
    pub primary_text: String,    // 标题或窗口名
    pub snippet: String,         // FTS5 highlight() 提取的片段
    pub score: f32,              // 向量相关度或 FTS5 Rank
    pub match_reason: String,    // "OCR命中", "语义命中", "Wiki关联"
}
```

---

## v3 新增引擎模块 (2026-06)

> 本节补全 `/workspace/workmemory-app/src-tauri/src/core/` 下 8 个新增引擎模块的职责、公开 API 与依赖关系。所有模块均为无状态函数集合（除 `EventBus` 与 `Scheduler` 持有句柄），以 `&Connection` 入参调用，便于在 Tauri `State<Mutex<Connection>>` 中复用。详细决策见 `01_ARCHITECTURAL_DECISIONS.md` §v3。

### 模块清单

| 文件 | 职责 | 公开 API | 依赖 |
|---|---|---|---|
| `error.rs` | 统一错误类型 `AppError`（Db/Io/NotFound/Validation/Internal）+ `From` 转换 + `AppResult<T>` | `AppError::{internal,validation,not_found}`、`AppResult` | `rusqlite`、`serde_json` |
| `task_engine.rs` | 任务 CRUD + 单向状态机守卫 + FTS5 搜索 | `save_task / get_all_tasks / get_task / update_task / delete_task / search_tasks / validate_transition` | `error`、`models::Task`、`uuid`、`chrono` |
| `pet_engine.rs` | 宠物状态 + XP 升级 + 衍生计算 + 时间衰减 | `save_pet_state / get_pet_state / feed / play / rest / clean / on_task_completed / on_focus_completed / decay / apply_xp / xp_needed_for_next_level / infer_mood` | `error`、`models::PetState` |
| `focus_engine.rs` | 番茄钟/自由计时会话生命周期 + 事件发布 | `start_focus_session / complete_focus_session / interrupt_focus_session / get_focus_session / get_today_focus_sessions` | `error`、`event_bus`、`pet_engine`、`models::FocusSession` |
| `analytics_engine.rs` | 派生统计：连续天数 / 周报 / 生产力评分 + daily_stats 幂等 upsert | `calculate_streak / get_weekly_stats / on_task_completed / on_focus_completed / productivity_score / get_daily_stats` | `error`、`models::DailyStats` |
| `soundscape_engine.rs` | 白噪音音景包加载 + 启用切换 | `get_soundscape_packs / get_all_soundscape_packs / toggle_soundscape_pack` | `error`、`models::SoundscapePack` |
| `event_bus.rs` | 模块间 `tokio::broadcast` 解耦（容量 256，全局 OnceLock 单例） | `EventBus::new/publish/subscribe`、`global_event_bus()`、`AppEvent` | `tokio::sync::broadcast` |
| `scheduler.rs` | 后台定时任务（每小时宠物衰减 / 每日 23:00 摘要） | `start_scheduler` | `tauri::Manager`、`pet_engine`、`chrono` |

### 调用链（事件驱动）

`focus_engine::complete_focus_session` 是 v3 的核心编排点：完成会话时同步触发宠物 XP 增长 + 发布 `FocusCompleted` 事件供 `AnalyticsEngine` 累加专注时长。任务完成侧（`task_engine`→`pet_engine`→`analytics_engine`）由前端 Tauri 命令显式串联。

```
┌───────────────────────── TaskCompleted 链 ─────────────────────────┐
│ 前端 update_task(status=completed)                                  │
│        │ (Tauri command)                                            │
│        ▼                                                            │
│ task_engine::update_task  ── 校验 validate_transition(inbox→completed)│
│        │                                                            │
│        ├─(前端命令链显式调用)──► pet_engine::on_task_completed      │
│        │                              │                              │
│        │                              ├─ apply_xp(+10) ─► level up? │
│        │                              ├─ hunger += 5 (clamp 0..100) │
│        │                              ├─ infer_mood(...)            │
│        │                              ├─ UPDATE pet_state           │
│        │                              └─ INSERT pet_interaction_logs│
│        │                                  (action='task_completed')  │
│        │                                                            │
│        └─(前端命令链显式调用)──► analytics_engine::on_task_completed│
│                                       │                             │
│                                       ├─ calculate_streak (含今日)  │
│                                       └─ upsert daily_stats         │
│                                           (tasks_completed +1)      │
└─────────────────────────────────────────────────────────────────────┘


┌──────────────────────── FocusCompleted 链 ──────────────────────────┐
│ focus_engine::complete_focus_session(session_id, actual_duration)   │
│        │                                                            │
│        ├─ UPDATE focus_sessions SET end_time, duration_seconds      │
│        │                                                            │
│        ├─ global_event_bus().publish(FocusCompleted{focus_seconds}) │
│        │        │                                                   │
│        │        └─► (订阅者 best-effort) analytics_engine           │
│        │             ::on_focus_completed(focus_seconds)            │
│        │                  └─ upsert daily_stats (total_focus_time+) │
│        │                                                            │
│        └─ pet_engine::on_focus_completed(&conn)  ← 同步直接调用     │
│                  ├─ apply_xp(+20) ─► level up?                      │
│                  ├─ energy += 10 (clamp 0..100)                     │
│                  ├─ infer_mood(...)                                 │
│                  ├─ UPDATE pet_state                                │
│                  └─ INSERT pet_interaction_logs                     │
│                      (action='focus_completed')                     │
└─────────────────────────────────────────────────────────────────────┘


┌─────────────── BackgroundScheduler 周期任务 ────────────────────────┐
│ start_scheduler(app) 注入两条 tokio 协程：                          │
│   ① 每小时  → pet_engine::decay(&conn, 1.0)                         │
│               └─ hunger ×0.95 / energy ×0.97 / 重算 mood           │
│   ② 每分钟  → 检测本地时钟 == "23:00" → run_daily_summary           │
│               └─ 触发后睡眠 1 小时避免重复                          │
└─────────────────────────────────────────────────────────────────────┘
```

### 设计约束

1. **无状态函数 + 共享连接**：引擎函数均以 `&Connection` 入参，不持有自身状态；连接由 `app.state::<std::sync::Mutex<rusqlite::Connection>>` 单例托管，调度器与命令层各自取锁。
2. **事件 best-effort**：`publish` 忽略无订阅者错误；`pet_engine::on_focus_completed` 在 `complete_focus_session` 内同步调用且 best-effort 忽略未初始化错误，保证专注完成主流程不被宠物侧异常阻断。
3. **scheduler TODO**：当前 `scheduler.rs` 尚未订阅 EventBus 事件，`daily_stats` 仅在显式 Tauri 命令调用 `on_task_completed / on_focus_completed` 时更新（见 `scheduler.rs` 顶部 TODO 注释，留待 Task 14/15 后续接入）。
