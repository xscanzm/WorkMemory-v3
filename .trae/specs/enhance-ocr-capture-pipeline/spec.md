# OCR 信息捕获策略全景增强 Spec

## Why
当前 `core/capture.rs` 与 `core/ocr.rs` 仅完成了 P0 基础闭环：`GetForegroundWindow` + `QueryFullProcessImageNameW` + `GetWindowTextW` + pHash 合并 + 180s Idle + 三级隐私守卫 + WinRT OCR 调用 + 文本清洗。但 `segments.browser_url` 与 `segments.activity_type` 两列**始终为空**，蒸馏上下文严重缺失；OCR 输出仍是"裸行拼接"，对飞书/Notion 等双栏布局会横向切割错行污染 LLM 语义；UWP 套壳（`ApplicationFrameHost.exe`）进程被误识别为同一应用。本 Spec 补齐用户在《OCR 信息捕获策略全景》中提出的 6 大策略，让 LLM 蒸馏能拿到结构化情境块，大幅降低幻觉率。

## 现状盘点（已实现，本 Spec 不重复实现）
- ✅ 1000ms 轮询前台窗口（[capture.rs:358](file:///workspace/workmemory-app/src-tauri/src/core/capture.rs#L358) `start_polling`）
- ✅ pHash 32×32 置灰缩放 + 汉明距离 + 95% 相似度 Merge（`PHASH_MERGE_SIMILARITY = 0.95`）
- ✅ 窗口/标题切换检测 → 立即触发 OCR；未切换走 pHash 路径
- ✅ 180s Idle 检测（基于 `GetLastInputInfo` 轮询，等价于 WH_MOUSE_LL + WH_KEYBOARD_LL 聚合输入；保留现有实现，不引入全局 Hook 以避免独立消息泵线程复杂度）
- ✅ 三级隐私守卫 `matches_privacy_rules` 已支持 `app` / `keyword` / `url` 三类规则（[capture.rs:298](file:///workspace/workmemory-app/src-tauri/src/core/capture.rs#L298)）
- ✅ 隐私命中写 `is_private=1, ocr_status='skipped'` 占位 Segment + 广播 `privacy-triggered`
- ✅ WinRT `Media.Ocr.OcrEngine` zh-Hans-CN 优先、回退用户语言（[ocr.rs:228-237](file:///workspace/workmemory-app/src-tauri/src/core/ocr.rs#L228-237)）
- ✅ 基础文本清洗：单字符行过滤、行尾无终止标点 + 行首非大写/非中文时拼接（[ocr.rs:120-157](file:///workspace/workmemory-app/src-tauri/src/core/ocr.rs#L120-157)）
- ✅ `segments` 表已有 `browser_url TEXT` / `activity_type TEXT` 两列（[migrations.rs:32-33](file:///workspace/workmemory-app/src-tauri/src/db/migrations.rs#L32-33)）

## What Changes
### 一、进程与窗口元数据增强
- **新增** UWP 套壳解包：当 `process_name == "ApplicationFrameHost.exe"` 时，通过 `EnumChildWindows` 递归找到真实子进程的 PID 与映像路径，覆盖 `ForegroundInfo.process_name` / `app_name`。
- **新增** `activity_type` 静态映射表（Rust `const` 数组，编译期常量）：`Code.exe → coding`、`msedge.exe → browsing`、`WeChat.exe → communication` 等；capture.rs 在构造 Segment 时按 `process_name` 小写匹配写入 `activity_type`。
- **新增** 无映射时 `activity_type` 默认值 `"other"`，避免空值。

### 二、浏览器 URL 深度捕获（零插件）
- **新增** Windows UI Automation (UIA) 客户端封装：基于 `IUIAutomationElement::FromHandle` 从 HWND 创建元素，深度优先遍历子树。
- **新增** Chrome 地址栏识别：匹配 `ClassName == "OmniboxViewViews"` 的 Edit 控件，读取 `ValuePattern.Value`。
- **新增** Edge 地址栏识别：匹配 `ClassName == "AriaEdit"` 或 `ControlType == Edit && AutomationId.contains("url")`。
- **新增** 通用退避：上述两者未命中时，深度优先找到第一个支持 `ValuePattern` 的 Edit 节点作为 URL 候选。
- **新增** 仅对浏览器进程（Edge/Chrome/Firefox 白名单）启用 UIA 调用，非浏览器跳过以节省 CPU。
- **新增** `ForegroundInfo.browser_url: Option<String>` 字段（仅在浏览器进程且成功读取时为 `Some`）。
- **新增** capture.rs 将 `browser_url` 写入 `segments.browser_url` 列（当前 SQL INSERT 已含该列但传 NULL）。
- **新增** Rust 端 URL 解析：从完整 URL 提取 `domain` + `path`（不含 query/fragment），作为 Prompt 上下文注入 distill.rs。
- **新增** 非 Windows 平台 stub：`extract_browser_url(hwnd) -> Option<String>` 返回 `None`，保证 `cargo check`。

### 三、pHash 帧去重心跳机制
- **保持现状**（已实现，无需变更）：1000ms 轮询、窗口/标题切换立即 OCR、pHash 95% Merge、180s Idle 停止轮询。
- **决策记录**：保留 `GetLastInputInfo` 轮询而非迁移到 `WH_MOUSE_LL + WH_KEYBOARD_LL` 全局 Hook。两者在"180s 无输入检测"语义上等价；前者无需独立消息泵线程，复杂度更低。

### 四、隐私守卫绝对前置
- **保持现状**：三级拦截（L1 app / L2 keyword / L3 url）OR 级联，任一命中即熔断写占位 Segment + 广播 `privacy-triggered`。
- **MODIFIED** 修复 L3 url 规则当前失效：capture.rs 现以 `matches_privacy_rules(conn, &process, &title, None)` 调用，L3 永远不命中。本 Spec 让其传入第二节的 `browser_url`（浏览器进程时），使 L3 实际生效。
- **保持顺序**：隐私守卫仍在前置位置（截图前熔断），命中后**绝不**调用 UIA / 截图 / OCR。

### 五、WinRT OCR 双栏布局重建
- **新增** `reconstruct_columns(lines: &[OcrLine]) -> String`：收集所有 `OcrWord.Rect.X`，按 X 坐标密度直方图判定单栏/双栏；双栏时按 X 阈值分组，左组按 Y 排序后输出，再输出右组，组间用 `[左栏]` / `[右栏]` 标记隔离语义。
- **MODIFIED** `recognize_inner` 返回值从纯 `String` 改为携带 word 级几何信息的中间结构（`Vec<OcrLine>` with `Vec<(text, x, y)>`），交由 `reconstruct_columns` 重建后再清洗。
- **MODIFIED** `clean_text` 增加规则：
  - 过滤 OCR 噪音字符：`□ ■ ● ˇ ￣ ◇ ◆ ★ ☆ ♪ ♫` 等行（仅含此类字符的整行丢弃）。
  - 过滤纯符号分隔行：仅由 `-` `=` `*` `_` `~` 等 ≤ 2 种符号重复组成的整行丢弃（如 `---` / `===`）。
  - 3+ 连续空行合并为 1 个换行（当前实现是丢弃全部空行，本 Spec 改为保留段落结构）。

### 六、送入 AI 蒸馏的结构化场景块
- **新增** `distill.rs` 在构建 AI Prompt 上下文时，按以下结构化格式序列化每个 Segment：
  ```json
  {
    "timestamp": "2026-06-27 10:15:30",
    "app_name": "Microsoft Edge",
    "window_title": "PR #421: Fix checkout state machine",
    "browser_url": "https://github.com/my-org/checkout-core/pull/421",
    "activity_type": "coding",
    "reconstructed_text": "[左栏]\n- Files changed (12)\n\n[右栏]\nReviewer: ..."
  }
  ```
- **MODIFIED** `distill.rs` 的 `infer_memory_kind` 与降级聚类逻辑当前只看 `process_name` + `window_title`；新增 `activity_type` 作为聚类维度之一（同 `activity_type` 的连续 Segment 倾向合并）。
- **新增** 当 `browser_url` 存在时，在 Prompt 中以"网页上下文：{domain}{path}"前缀注入，便于 LLM 识别具体项目/PR/文档。

## Impact
- Affected specs: 本 Spec 是 `workmemory-v3-build` 的增量增强，不替换原 Spec。
- Affected code:
  - [capture.rs](file:///workspace/workmemory-app/src-tauri/src/core/capture.rs)：UWP 解包、UIA URL 调用、`browser_url` 写入、L3 隐私规则接入、`activity_type` 静态映射写入
  - [ocr.rs](file:///workspace/workmemory-app/src-tauri/src/core/ocr.rs)：双栏重建算法、噪音字符过滤、符号行过滤、空行规则调整
  - [distill.rs](file:///workspace/workmemory-app/src-tauri/src/core/distill.rs)：结构化场景块序列化、`activity_type` 聚类维度、URL 域名注入
  - `Cargo.toml`：新增 `windows` features `UI_Automation`、`Win32_UI_Accessibility`
- 平台：所有新功能均为 `#[cfg(target_os = "windows")]`，非 Windows 提供 stub。
- 数据兼容：`segments` 表 schema 不变（`browser_url`/`activity_type` 列已存在）；旧数据这两列为 NULL，蒸馏时按缺失处理。

## ADDED Requirements

### Requirement: UWP 套壳进程解包
系统 SHALL 在 `process_name == "ApplicationFrameHost.exe"` 时通过 `EnumChildWindows` 递归查找真实子窗口的 PID，并 SHALL 用 `QueryFullProcessImageNameW` 获取真实进程映像名覆盖 `ForegroundInfo`。

#### Scenario: UWP 应用（如系统设置、计算器）被正确识别
- **WHEN** 用户前台为 Windows 设置 UWP 应用，`GetForegroundWindow` 返回的进程名为 `ApplicationFrameHost.exe`
- **THEN** capture.rs 通过 `EnumChildWindows` 找到真实子进程（如 `ApplicationFrameHost.exe` 下的 `SystemSettings.exe`），`ForegroundInfo.process_name` 写入真实进程名，`activity_type` 按真实进程名映射。

### Requirement: activity_type 静态映射
系统 SHALL 维护编译期常量映射表，将常见进程名映射到 `activity_type` 标签，SHALL 在构造 Segment 时写入 `segments.activity_type` 列，SHALL 对未匹配进程回退 `"other"`。

#### Scenario: VS Code 被标记为 coding
- **WHEN** 前台进程为 `Code.exe`
- **THEN** `segments.activity_type = "coding"`。

#### Scenario: 未映射进程回退
- **WHEN** 前台进程为某内部工具 `internal-tool.exe`，映射表无对应项
- **THEN** `segments.activity_type = "other"`，不报错。

### Requirement: 浏览器 URL 深度捕获（UIA）
系统 SHALL 对浏览器进程（Edge/Chrome/Firefox 白名单）通过 Windows UI Automation 读取地址栏文本，SHALL 写入 `segments.browser_url`，SHALL 对非浏览器进程跳过 UIA 调用，SHALL NEVER 安装浏览器插件。

#### Scenario: Chrome 地址栏读取
- **WHEN** 前台为 Chrome，HWND 下存在 `ClassName == "OmniboxViewViews"` 的 Edit 控件
- **THEN** capture.rs 通过 `ValuePattern.Value` 读取 URL，写入 `segments.browser_url`。

#### Scenario: Edge 地址栏读取
- **WHEN** 前台为 Edge，HWND 下存在 `ClassName == "AriaEdit"` 或 `AutomationId.contains("url")` 的 Edit 控件
- **THEN** 同上，写入 URL。

#### Scenario: 非浏览器进程跳过
- **WHEN** 前台为 VS Code（非浏览器白名单）
- **THEN** capture.rs 不调用 UIA，`segments.browser_url` 为 NULL。

#### Scenario: UIA 调用失败安全降级
- **WHEN** UIA 调用抛错或未找到地址栏控件
- **THEN** capture.rs 记录 warn 日志，`segments.browser_url` 为 NULL，不阻断截图与 OCR 主流程。

### Requirement: OCR 双栏几何重建
系统 SHALL 在 WinRT OCR 返回结果后，按 `OcrWord.Rect.X` 坐标分布判定单栏/双栏，双栏时 SHALL 按列分块输出并加 `[左栏]` / `[右栏]` 标记隔离语义。

#### Scenario: 飞书双栏文档正确分列
- **WHEN** OCR 结果的 word X 坐标呈双峰分布（如 [0-400] 与 [500-1000] 两个密集区，中间有稳定空白带）
- **THEN** 输出文本按"左栏全部 → 空行 → 右栏全部"顺序，左栏前缀 `[左栏]\n`，右栏前缀 `\n[右栏]\n`。

#### Scenario: 单栏文档保持原样
- **WHEN** OCR 结果的 word X 坐标呈单峰分布
- **THEN** 输出文本不加栏目标记，按原 Y 顺序逐行输出。

### Requirement: OCR 文本噪音过滤
系统 SHALL 过滤仅含 OCR 噪音字符（`□ ■ ● ˇ ￣ ◇ ◆ ★ ☆ ♪ ♫` 等）的整行，SHALL 过滤仅由 `- = * _ ~` 等不超过 2 种符号重复组成的纯分隔行（如 `---` / `===`）。

#### Scenario: 噪音字符行被丢弃
- **WHEN** OCR 原始输出包含 `□ □ □` 或 `● ● ●` 整行
- **THEN** 该行在 `clean_text` 后被丢弃，不出现在最终 `segments.ocr_text`。

#### Scenario: 符号分隔行被丢弃
- **WHEN** OCR 原始输出包含 `------------` 或 `============` 整行
- **THEN** 该行被丢弃，不污染 LLM 输入。

### Requirement: 结构化场景块注入蒸馏
系统 SHALL 在 `distill.rs` 构建 AI Prompt 上下文时，按 JSON 结构化格式序列化每个 Segment，SHALL 包含 `timestamp` / `app_name` / `window_title` / `browser_url`（可空）/ `activity_type` / `reconstructed_text` 六个字段。

#### Scenario: 浏览器 Segment 注入 URL 上下文
- **WHEN** 某 Segment 的 `browser_url = "https://github.com/my-org/checkout-core/pull/421"`，进入整点蒸馏
- **THEN** AI Prompt 上下文包含 `"browser_url": "https://github.com/my-org/checkout-core/pull/421"` 与 `"网页上下文：github.com/my-org/checkout-core/pull/421"` 前缀提示。

#### Scenario: 无 URL 的 Segment 不注入网页上下文
- **WHEN** 某 Segment 的 `browser_url` 为 NULL（如 VS Code 本地编辑）
- **THEN** 结构化块中 `browser_url` 字段为 `null`，不生成"网页上下文"前缀。

## MODIFIED Requirements

### Requirement: 隐私守卫 L3 URL 规则实际生效
原实现 `matches_privacy_rules(conn, &process, &title, None)` 中 L3 url 规则因第三参数恒为 `None` 而永不命中。本 Spec 修改为：当且仅当 capture.rs 已成功捕获 `browser_url` 时，将其作为第三参数传入；隐私守卫仍在前置位置（截图前熔断），命中后**绝不**调用 UIA / 截图 / OCR。

#### Scenario: chrome-extension:// URL 命中隐私
- **WHEN** 前台为 Chrome 且 UIA 读到地址栏为 `chrome-extension://abc...`
- **THEN** L3 url 规则命中，capture.rs 写入 `is_private=1, ocr_status='skipped'` 占位 Segment，广播 `privacy-triggered`，不截图、不 OCR。

#### Scenario: 浏览器隐私规则在 URL 未捕获时不误判
- **WHEN** 前台为 Chrome 但 UIA 读取失败，`browser_url` 为 NULL
- **THEN** L3 url 规则跳过（不命中），仅 L1/L2 规则生效；不因 URL 缺失而误判为安全。

### Requirement: clean_text 空行规则
原实现"丢弃全部空行"会破坏段落结构。本 Spec 修改为：3+ 连续空行合并为 1 个换行，保留段落分隔语义。

#### Scenario: 多空行合并为单换行
- **WHEN** OCR 原始输出含 5 个连续空行
- **THEN** `clean_text` 输出 1 个换行符，保留段落分隔。

### Requirement: distill.rs activity_type 聚类维度
原 `infer_memory_kind` 与降级聚类仅按 `process_name` 分组。本 Spec 修改为：连续 Segment 若 `activity_type` 相同（且非 `"other"`），倾向合并到同一 Episode 簇，提升聚类语义一致性。

#### Scenario: 浏览器切换多个标签页但 activity_type 一致
- **WHEN** 用户在 Edge 中切换 3 个 GitHub PR 标签页，3 个 Segment 的 `activity_type` 均为 `"browsing"`
- **THEN** 降级聚类倾向将这 3 个 Segment 合并为同一 Episode，标题由首个非空 `window_title` 生成。

## REMOVED Requirements
无删除项。本 Spec 为纯增量增强，不破坏既有功能。
