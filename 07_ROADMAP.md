# WorkMemory 07: AI 并行开发路线图与依赖树说明 (AI-Native Parallel Development Spec)

> **文档定位**：专为 AI Coding Agent 设计的并行开发与架构依赖树指南。由于本项目使用 AI 进行高度并行化开发，本路线图**无条件摒弃了任何传统人工开发的“线性排期、人均工时、人月时间线或天数/周数估算”**。转而采用**“解耦模块树 -> 依赖关系网 -> 并行执行流”**的 AI 研发规格，通过功能集成网（Checkpoints）和 Mock 挡板机制，指导多个 AI 智能体实例完全并行、无冲突地生成前端组件、状态机、Rust 后端及 SQLite 服务。

---

## 1. 并行开发架构：高度解耦设计 (Decoupled Module Map)

为了实现多个 AI 智能体实例的高效并行开发，WorkMemory 被拆分为四个完全解耦的垂直层。任何一个 AI Agent 都可以独立认领某一个层中的子模块进行编写，只要它们共同遵守 `02_DATA_MODEL.md`（Schema 契约）和 `03_CORE_ARCHITECTURE.md`（IPC 契约）。

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      前端 UI 表现层 (Views & Components)               │
 │ [可并行 A] TodayView ｜ [可并行 B] ReportsView ｜ [可并行 C] SettingsView   │
 │ [可并行 D] CalendarView ｜ [可并行 E] SearchView ｜ [可并行 F] WikiView       │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      前端数据与状态管理层 (Zustand Store)               │
 │ [可并行 G] useAppStore (统一管理 RecorderState, Episodes, ActiveView)  │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      IPC 契约桥梁层 (Tauri commands)                    │
 │ [可并行 H] 注册 Tauri 命令入口 ── 映射至 Rust 核心 API                    │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      Rust 后端独立服务层 (Core Engines)                 │
 │ [可并行 I] Window Watcher ｜ [可并行 J] WinRT OCR ｜ [可并行 K] SQLite Repo │
 │ [可并行 L] Distill Manager ｜ [可并行 M] Mascot Window Controller       │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 并行开发依赖树与执行流 (Parallel Dependency Tree)

AI 在并行开发时，必须遵循**“无依赖先跑，有依赖等接口桩（Mock）”**的原则。以下是 WorkMemory 完整的并行依赖拓扑：

### 2.1 依赖级别定义 (Dependency Levels)
*   **L0（根地基，最先生成）**：不依赖任何其他模块，定义全局数据结构、数据库 Schema、CSS 变量。
*   **L1（基础服务层，可完全并行）**：依赖 L0，包含 Rust 底层存储库、系统 API 调用、前端静态 UI 还原。
*   **L2（粘合与核心逻辑层，并行开发）**：依赖 L1，包含 AI 蒸馏管道、IPC 命令绑定、前端 Zustand 状态联动。
*   **L3（高级组合层，最后组装）**：依赖 L2，包含 Wiki 编辑器、语义检索、关系图谱画布。

### 2.2 拓扑执行图 (Topology Graph)

```
[L0: 根基] ──────► 数据库 DDL (02_DATA_MODEL) & 前端 CSS Tokens (04_UI_SPEC)
                      │
                      ├──────────────────────────┐
                      ▼ (L1: 基础服务并行线)       ▼ (L1: 前端静态 UI 并行线)
               ┌──────────────┐           ┌───────────────────────┐
               │ Rust DB Repo │           │ 静态页面骨架还原       │
               │ (SQLite Repo)│           │ (Today/Settings/Mascot)│
               └──────┬───────┘           └──────────┬────────────┘
                      │                              │
                      ▼ (L2: 异步与粘合并行线)        ▼ (L2: 前端交互与状态机)
               ┌──────────────┐           ┌───────────────────────┐
               │ WinRT OCR    │           │ Zustand Store         │
               │ 小时蒸馏引擎  │◄─────────►│ (useAppStore.ts)      │
               │ (Distill.rs) │  (IPC)    │ 页面控制与交互对接     │
               └──────┬───────┘           └──────────┬────────────┘
                      │                              │
                      ▼ (L3: 高级特性并行线)          ▼ (L3: 高级 UI 联调)
               ┌──────────────┐           ┌───────────────────────┐
               │ 向量语义检索  │           │ Wiki 编辑器 & 图谱画布 │
               │ Wiki 关系计算 │           │ 双链高亮、节点交互      │
               └──────────────┘           └───────────────────────┘
```

---

## 3. 并行阶段划分与集成校验网 (Integration Checkpoints)

我们将开发目标划分为三个功能集成网（Checkpoints），每个阶段的重点在于**接口的集成校验与核心数据流打通**，彻底排除任何时间排期的概念。

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │                 Checkpoint 1: 极简日报闭环功能集成                       │
  │  - 模块合并: window_watcher + WinRT OCR + distill_manager + SQLite Repo│
  │  - 前端合并: TodayView Timeline + ReportsView checklist                │
  │  - 校验目标: 零操作自动捕获电脑状态，下班后可一键复制 Markdown 日报         │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │                 Checkpoint 2: 历史反查与时间审计功能集成                  │
  │  - 模块合并: SQLite FTS5 全文索引 + CalendarView + SearchView           │
  │  - 前端合并: InsightsView 时间审计看板 + Mascot 2.0 气泡频控算法          │
  │  - 校验目标: 精确搜索历史 OCR、点击日历反查任意一天、深度工作分析机制       │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │                 Checkpoint 3: 认知资产双链与图谱集成                     │
  │  - 模块合并: OpenAI Embeddings + WikiView 双链 + GraphView 记忆图谱画布  │
  │  - 校验目标: 模糊意图检索，Wiki 自动沉淀建议，双链网状节点穿梭           │
  └────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Checkpoint 1：极简日报闭环集成 (Today & Daily Report Loop)
*   **目标**：验证“后台静默捕获 -> WinRT OCR -> 降噪蒸馏 -> 日报富文本一键复制”的完整本地数据流。
*   **并行开发子任务**：
    1.  **后端 A 组**：编写 `window_watcher` 与客户端无边框窗口截图，获取 hwnd 与 bounds。
    2.  **后端 B 组**：编写 `windows_ocr_engine`（WinRT）与并发双通道 `ocr_queue`。
    3.  **后端 C 组**：完成 `segments`, `clean_episodes` 的 SQLite CRUD 存储库（`db` 模块）。
    4.  **后端 D 组**：编写整点 `distill_manager`：支持大模型 JSON Mode 解析与无 AI 本地物理聚类降级算法。
    5.  **前端 A 组**：编写 `TodayView` 的 Timeline、`SummaryBar`（一句话总结卡）及 `MemoryCard` 交互。
    6.  **前端 B 组**：编写 `ReportsView` 的勾选 Checklist 逻辑与 Markdown 实时编辑器（带一键富文本复制）。
    7.  **Mascot 组**：实现透明、置顶、防夺焦、可拖拽的独立 Mascot 窗口 1.0（支持 Recording/Paused/PrivacyMode 状态切换）。
*   **集成验证流程**：
    *   首先通过前端 Mock 数据完成 UI 走线验证。
    *   在主进程注册 `get_episodes_by_date` 和 `generate_report` 等 IPC Commands，打通前后端数据流。
    *   运行 `09_PRODUCT_ACCEPTANCE_LEDGER.md` 中的用例 1、2、3、4、5 进行端到端跑通测试。

### 3.2 Checkpoint 2：历史反查与时间审计集成 (History Archiving & Time Audit Loop)
*   **目标**：验证“日历归档 -> 极速 FTS5 全文搜索 -> 专注时间审计”的数据串联。
*   **并行开发子任务**：
    1.  **存储组**：开启 SQLite FTS5 虚拟表 `fts_segments` 及触发器，编写带有 highlight snippet 的全文检索查询。
    2.  **前端 A 组**：开发 `CalendarView` 月历网格，单元格绑定工作强度绿条，右侧刷入选中日期 Context 故事面板。
    3.  **前端 B 组**：开发 `SearchView` 检索面板：完成 FTS5 高亮匹配字渲染及来源分类。
    4.  **智能分析组**：编写 Insights 算法与 InsightsView 页面，统计时间占用并生成异常波动、未完成线索等 Insight 提示卡片。
    5.  **Mascot 2.0 组**：实现低频微动作，根据专注时长（如持续 45 分钟无打断）轻弹“端茶/站立休息”气泡。
*   **集成验证流程**：
    *   检索性能测试：在 10,000 条以上 Segment 记录下，FTS5 全文检索响应时间保持在 30ms 以内。
    *   运行 `09_PRODUCT_ACCEPTANCE_LEDGER.md` 中的用例 6 进行验证。

### 3.3 Checkpoint 3：认知资产双链与图谱集成 (Knowledge Asset & Graph Loop)
*   **目标**：验证“高价值记忆一键沉淀 Wiki -> 双链高亮跳转 -> 记忆关系网图谱渲染”。
*   **并行开发子任务**：
    1.  **编辑器组**：自研轻量级双链 Markdown 编辑器，完美渲染 `[[wikilink]]` 双链。
    2.  **向量算法组**：对接 OpenAI Embeddings 客户端，小时蒸馏后异步向量化 memory_cells 事实，实现余弦相似度本地内存召回。
    3.  **图谱画布组**：在 `GraphView` 页面，利用前端轻量图力导向图引擎绘制人、事、项目、时间节点，并实现双击节点穿梭回 Episode。
    4.  **智能推荐组**：在 Wiki 顶部实现 Review Queue，自动推送 AI 判定 `wiki_eligible = 1` 的高价值记忆沉淀草稿。
*   **集成验证流程**：
    *   模糊语义检索测试：搜索“昨天那个蓝色背景的 PPT”，系统应能通过向量相似度计算，精准召回该 Segment 的 memory_cell 事实。
    *   运行 `09_PRODUCT_ACCEPTANCE_LEDGER.md` 中的用例 7 进行验证。

---

## 4. 独立任务包分配指南 (AI Task Packages)

你可以将以下精心设计的任务卡（Task Packages）**直接发给不同的 AI 实例/窗口进行并行编码**。

### 📦 任务卡 101：Rust SQLite 存储层 (L1 级)
*   **目标**：完成本地数据库初始化、迁移及全部 Repositories。
*   **输入上下文**：`02_DATA_MODEL.md`（完整 DDL）。
*   **并行要求**：
    1.  建立 `connection.rs`，配置 WAL 模式、开启外键。
    2.  编写 `segments`, `clean_episodes`, `wiki_pages`, `reports` 的 CRUD 函数。
    3.  建立 FTS5 全文索引虚拟表与三个 `AFTER INSERT/UPDATE` 触发器。
*   **输出产物**：`/src-tauri/src/db/` 下的完整存储库代码。**不依赖任何前端或系统 API。**

### 📦 任务卡 102：Windows 原生 WinRT OCR 模块 (L1 级)
*   **目标**：封装 Windows OCR API，建立异步消费队列。
*   **输入上下文**：`01_ARCHITECTURAL_DECISIONS.md`（WinRT 决策）、`03_CORE_ARCHITECTURE.md`（OCR 队列设计）。
*   **并行要求**：
    1.  调用 `windows::Media::Ocr::OcrEngine` 获取系统 OCR 实例。
    2.  编写 `SoftwareBitmap` 转换逻辑。
    3.  建立 `ocr_queue`（Semaphore 控制并发数为 2）。
    4.  实现 `ocr_text_cleaner` 清洗噪音。
*   **输出产物**：`/src-tauri/src/core/ocr.rs`。**不依赖主窗口，仅需要图片文件输入。**

### 📦 任务卡 103：前端全局 UI Token 与 Reset (L0 级)
*   **目标**：还原基础色板、毛玻璃材质与自定义 Titlebar。
*   **输入上下文**：`04_UI_SPEC.md`（CSS Token 与布局）、`06_DESIGN_GOVERNANCE.md`（无边框窗口约束）。
*   **并行要求**：
    1.  编写 `src/styles/variables.css`，定义所有 CSS 变量。
    2.  实现自定义无边框 Titlebar React 组件，处理 `-webkit-app-region: drag`。
    3.  使用 Radix ScrollArea 编写半透明、自动隐藏的自定义滚动条。
*   **输出产物**：前端全局样式表与基础 Frame 布局组件。**可立即用 Mock 数据预览。**

### 📦 任务卡 104：Mascot 透明常驻窗口 (L1/L2 级)
*   **目标**：开发透明、吸附停靠、无焦点夺取的桌面伙伴。
*   **输入上下文**：`03_CORE_ARCHITECTURE.md`（Mascot 窗口 JSON 配置）、`05_INTERACTION.md`（状态机与气泡算法）。
*   **并行要求**：
    1.  在 `tauri.conf.json` 中配置 label 为 `"mascot"` 的透明无边框窗口。
    2.  前端编写独立路由 `index.html#/mascot` 指向 `MascotWindow.tsx`。
    3.  实现鼠标拖拽与贴边平滑磁吸动画。
    4.  监听 `recorder-state-changed` 和 `privacy-triggered` 事件，无缝切换微动作。
*   **输出产物**：可独立启动、停靠于桌面右下角的 Mascot 闭环。

### 📦 任务卡 105：小时蒸馏与 AI 报告生成器 (L2 级)
*   **目标**：编写 OpenAI 兼容客户端，实现整点降噪蒸馏与日报 Markdown 提炼。
*   **输入上下文**：`03_CORE_ARCHITECTURE.md`（蒸馏管线）、`08_AI_PROMPTS.md`（完整 Prompt 模板）。
*   **并行要求**：
    1.  编写 API 兼容客户端，支持 HTTP 流式传输（SSE）与超时重试。
    2.  实现 `distill_manager`：整点触发，若未配置 Key，优雅降级为本地聚类降噪（物理合并）。
    3.  编写 `report_generator`，按 4 种模板拼接 Episode 进 LLM 或降级模板。
*   **输出产物**：`/src-tauri/src/core/distill.rs` 和 `report.rs`。

---

## 5. AI 并行联调与 Stub 挡板策略 (AI Mock Strategy)

为确保 AI 智能体在并行编写前端 UI 页面（如 TodayView、ReportsView）时，不会因 Rust 后端尚未编译通过而停滞，所有 IPC 调用必须设计**前端 Mock 挡板**：

```typescript
// src/src-tauri/mock.ts
// 当前端运行于 Vite 纯 Web 浏览器（非 Tauri Shell）环境时，自动启用挡板数据
export const invokeMock = async (command: string, args?: any): Promise<any> => {
  switch (command) {
    case "get_recorder_state":
      return "Recording";
    case "get_today_summary":
      return "今日重点在于确认订单系统退款状态枚举值，完成了与前端的接口联调。";
    case "get_episodes_by_date":
      return [
        {
          id: "ep_01",
          date: args.date,
          startTime: "10:00:00",
          endTime: "11:20:00",
          title: "推进订单退款字段确认",
          summary: "阅读了退款字段文档，并确认了退款状态枚举值。",
          memoryKind: "work",
          project: "订单系统",
          apps: ["📄 Edge", "💻 VS Code"]
        }
      ];
    default:
      throw new Error(`Unknown command: ${command}`);
  }
};
```

通过此 Mock 策略，负责前端 UI 的 AI 可以**完全脱离 Rust 后端编译环境，在纯 Web 端完成 100% 页面开发与颜值细化**；而负责 Rust 后端的 AI 可以通过单元测试完成 `Media::Ocr` 和 SQLite DDL 的 100% 稳定性校验。最终在 Tauri 环境下一键合流，实现效率最大化。
