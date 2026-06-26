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
