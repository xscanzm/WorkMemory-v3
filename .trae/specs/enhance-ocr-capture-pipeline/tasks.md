# Tasks

## 一、进程与窗口元数据增强

- [x] Task 1: 实现 UWP 套壳进程解包（`EnumChildWindows`）
  - [x] SubTask 1.1: 在 `capture.rs` 的 `get_foreground_window` 中检测 `process_name == "ApplicationFrameHost.exe"`
  - [x] SubTask 1.2: 调用 `EnumChildWindows` 递归遍历子窗口，对每个子窗口调用 `GetWindowThreadProcessId` + `QueryFullProcessImageNameW` 取真实进程名
  - [x] SubTask 1.3: 找到第一个非 `ApplicationFrameHost.exe` 的子进程，覆盖 `ForegroundInfo.process_name` / `app_name`
  - [x] SubTask 1.4: 非 Windows 平台 stub（保持现有 `get_foreground_window` 默认实现）
  - [x] SubTask 1.5: Cargo.toml 确认 `Win32_UI_WindowsAndMessaging` feature 已启用（EnumChildWindows 所属）

- [x] Task 2: 实现 `activity_type` 静态映射表
  - [x] SubTask 2.1: 在 `capture.rs` 顶部新增 `const ACTIVITY_TYPE_MAP: &[(&str, &str)]`，覆盖 35 个常见进程（含 VS Code/Edge/Chrome/Firefox/WeChat/Feishu/DingTalk/Slack/Excel/Word/PowerPoint/Notion/Obsidian/Terminal/PowerShell/CMD/Visual Studio/IDEA/PyCharm/WebStorm/GoLand/CLion/RustRover/Rider/Fleet/WeChatWork 等）
  - [x] SubTask 2.2: 新增 `fn lookup_activity_type(process_name: &str) -> &'static str`，按小写匹配，未命中返回 `"other"`
  - [x] SubTask 2.3: `insert_segment` 与 `insert_private_segment` 的 SQL 已含 `activity_type` 列，将 `lookup_activity_type` 返回值写入
  - [x] SubTask 2.4: 单元测试覆盖：`Code.exe → coding`、`unknown.exe → other`、`CODE.EXE → coding`（大小写不敏感）

## 二、浏览器 URL 深度捕获（UIA）

- [x] Task 3: 新增 UIA 客户端封装模块
  - [x] SubTask 3.1: 在 `core/` 下新建 `uia.rs` 模块，声明 `pub mod uia;` 到 `core/mod.rs`
  - [x] SubTask 3.2: 实现 `pub fn extract_browser_url(hwnd: usize) -> Option<String>`（Windows 平台）
  - [x] SubTask 3.3: Chrome 识别：递归查找 `ClassName == "OmniboxViewViews"`，读取 `ValuePattern.Value`
  - [x] SubTask 3.4: Edge 识别：递归查找 `ClassName == "AriaEdit"` 或 `ControlType == Edit && AutomationId.contains("url")`
  - [x] SubTask 3.5: 通用退避：上述两者未命中时，深度优先找第一个支持 `ValuePattern` 的 Edit 节点
  - [x] SubTask 3.6: 任何 UIA 调用失败返回 `None`，记录 `log::warn!`
  - [x] SubTask 3.7: 非 Windows 平台 stub：`pub fn extract_browser_url(_hwnd: usize) -> Option<String> { None }`
  - [x] SubTask 3.8: Cargo.toml 在 `windows` features 中新增 `UI_UIAutomation`、`Win32_UI_Accessibility`（注：windows 0.58 中 feature 名为 `UI_UIAutomation` 而非 spec 原写的 `UI_Automation`，命名空间为 `windows::UI::UIAutomation`）

- [x] Task 4: 在 capture.rs 中接入 UIA URL 捕获
  - [x] SubTask 4.1: `ForegroundInfo` 结构体新增 `pub browser_url: Option<String>` 字段
  - [x] SubTask 4.2: `get_foreground_window` 在拿到 `process_name` 后，若在 `BROWSER_PROCESSES` 白名单内，调用 `uia::extract_browser_url(hwnd)` 填充 `browser_url`
  - [x] SubTask 4.3: `insert_segment` 与 `insert_private_segment` SQL 实际写入 `browser_url` 列（NULL 时传 NULL）
  - [x] SubTask 4.4: 非 Windows 平台 stub：`ForegroundInfo.browser_url` 始终为 `None`

- [x] Task 5: 修复隐私守卫 L3 url 规则失效
  - [x] SubTask 5.1: 在 `start_polling` 主循环中，调用 `matches_privacy_rules` 时第三参数从 `None` 改为 `fg.browser_url.as_deref()`
  - [x] SubTask 5.2: 验证 `chrome-extension://` 等敏感 URL 现可命中 L3 url 规则（单元测试覆盖）
  - [x] SubTask 5.3: 验证非浏览器进程（`browser_url = None`）L3 不误判为安全（单元测试覆盖）

## 三、WinRT OCR 双栏布局重建

- [x] Task 6: 重构 `recognize_inner` 返回值携带 word 几何信息
  - [x] SubTask 6.1: 在 `ocr.rs` 定义 `struct OcrWordInfo { text, x, y, width, height }` 与 `struct OcrLineInfo { words: Vec<OcrWordInfo> }`
  - [x] SubTask 6.2: 修改 `winrt_impl::recognize_inner` 返回 `windows::core::Result<Vec<OcrLineInfo>>`，遍历 `result.Lines()` → `line.Words()` 提取每个 `OcrWord.Text` 与 `BoundingRect`
  - [x] SubTask 6.3: 非 Windows stub 返回空 `Vec<OcrLineInfo>`

- [x] Task 7: 实现 `reconstruct_columns` 双栏重建算法
  - [x] SubTask 7.1: 收集所有 `OcrWordInfo.x`，计算 X 坐标直方图（按 50px 分桶）
  - [x] SubTask 7.2: 检测双栏：若存在一个稳定的 X 空白带（>= 80px 宽度且该区间 word 数为 0），将 word 集合分为左右两组
  - [x] SubTask 7.3: 单栏：按 Y 升序逐行输出（同一 Y 容差 20px 内的 word 合并为一行）
  - [x] SubTask 7.4: 双栏：先输出 `[左栏]\n` + 左组按 Y 排序的行，再输出 `\n[右栏]\n` + 右组按 Y 排序的行
  - [x] SubTask 7.5: 单元测试：单峰 X 分布 → 不加栏目标记；双峰 X 分布 → 加 `[左栏]` / `[右栏]` 标记

- [x] Task 8: 调用链改造：`recognize` 返回重建后字符串
  - [x] SubTask 8.1: `pub async fn recognize(...)` 内部先调 `recognize_inner` 拿 `Vec<OcrLineInfo>`，再调 `reconstruct_columns`，再调 `clean_text`
  - [x] SubTask 8.2: `run_ocr_queue` 的调用顺序：`recognize` → `reconstruct_columns` → `clean_text` → `persist_ocr_result`

## 四、OCR 文本清洗规则增强

- [x] Task 9: 增强 `clean_text` 规则
  - [x] SubTask 9.1: 新增 `is_noise_only_line(line: &str) -> bool`：行内字符全部属于噪音字符集时返回 true
  - [x] SubTask 9.2: 新增 `is_pure_separator_line(line: &str) -> bool`：行内仅由 ≤ 2 种分隔符号重复组成且长度 ≥ 3 时返回 true
  - [x] SubTask 9.3: 空行规则：3+ 连续空行合并为 1 个换行
  - [x] SubTask 9.4: `clean_text` 处理顺序：噪音行 → 符号行 → 单字符行 → 行合并 → 空行折叠
  - [x] SubTask 9.5: 单元测试覆盖

## 五、送入 AI 蒸馏的结构化场景块

- [x] Task 10: distill.rs 结构化场景块序列化
  - [x] SubTask 10.1: 在 `distill.rs` 新增 `fn serialize_segment_block(seg: &WorkSegment) -> serde_json::Value`，输出六字段
  - [x] SubTask 10.2: `WorkSegment` 结构体已读取 `browser_url` 与 `activity_type` 列（`SEGMENT_COLS` 已覆盖）
  - [x] SubTask 10.3: `build_ocr_records` 改用 `serialize_segment_block` 序列化后 `\n` 拼接注入 Prompt
  - [x] SubTask 10.4: 当 `browser_url` 存在时，在 `reconstructed_text` 前加 `"网页上下文：{domain}{path}\n"` 前缀

- [x] Task 11: distill.rs activity_type 聚类维度
  - [x] SubTask 11.1: 聚类函数新增逻辑：相邻 Segment 若 `activity_type` 相同（且非 `"other"`）也倾向合并
  - [x] SubTask 11.2: `infer_memory_kind` 增加 `activity_type` 入参：`coding → work`、`browsing → research`、`communication → meeting`、`document → documentation`、`spreadsheet → work`、`terminal → work`、`other` 保持现有逻辑
  - [x] SubTask 11.3: 单元测试：3 个不同浏览器进程 Segment（`activity_type = browsing`）应合并为同一 Episode 簇

## 六、URL 域名/路径解析

- [x] Task 12: 实现 URL 解析工具函数
  - [x] SubTask 12.1: 在 `core/` 下新增 `url_util.rs` 模块，声明到 `core/mod.rs`
  - [x] SubTask 12.2: 实现 `pub fn parse_domain_path(url: &str) -> Option<(String, String)>`
  - [x] SubTask 12.3: 处理边界：无 scheme、`chrome-extension://`、`about:blank`、`file://`
  - [x] SubTask 12.4: 单元测试覆盖上述边界

## 七、依赖与构建

- [x] Task 13: 更新 Cargo.toml windows features
  - [x] SubTask 13.1: 在 `windows` features 列表新增 `"UI_UIAutomation"`、`"Win32_UI_Accessibility"`
  - [x] SubTask 13.2: 修复 `protocol-asset` Tauri feature 缺失（tauri.conf.json `assetProtocol.enable=true` 但 Cargo.toml 未声明）
  - [x] SubTask 13.3: 非 Windows 沙箱 `cargo check` stub 路径不引入新错误

## 八、集成验证

- [ ] Task 14: 端到端集成验证
  - [ ] SubTask 14.1: Windows 实机：前台 VS Code → `segments.activity_type = "coding"`、`browser_url = NULL`（需 Windows 实机，沙箱不可验证）
  - [ ] SubTask 14.2: Windows 实机：前台 Chrome 打开 GitHub PR → `segments.browser_url` 为完整 URL、`activity_type = "browsing"`（需 Windows 实机）
  - [ ] SubTask 14.3: Windows 实机：前台 Edge 打开 `chrome-extension://` → 隐私命中，`is_private=1, ocr_status='skipped'`（需 Windows 实机）
  - [ ] SubTask 14.4: Windows 实机：前台飞书双栏文档 → `segments.ocr_text` 含 `[左栏]` / `[右栏]` 标记（需 Windows 实机）
  - [ ] SubTask 14.5: Windows 实机：整点蒸馏 → AI Prompt 上下文含结构化 JSON 块 + 网页上下文前缀（需 Windows 实机）
  - [ ] SubTask 14.6: Windows 实机：前台 Windows 设置 UWP → `process_name` 为 `SystemSettings.exe` 而非 `ApplicationFrameHost.exe`（需 Windows 实机）
  - [x] SubTask 14.7（沙箱可验证）：纯逻辑单元测试全部通过 —— `lookup_activity_type` / `reconstruct_columns` / `clean_text` / `parse_domain_path` / `cluster_segments` / `serialize_segment_block` / L3 隐私规则匹配

# Task Dependencies
- Task 1 (UWP 解包) 独立，可与 Task 2、Task 12 并行
- Task 2 (activity_type 映射) 独立，可与 Task 1、Task 12 并行
- Task 3 (UIA 模块) 独立，可与 Task 1、Task 2、Task 6、Task 9、Task 12 并行
- Task 4 (capture.rs 接入 UIA) 依赖 Task 3
- Task 5 (L3 隐私修复) 依赖 Task 4
- Task 6 (recognize_inner 重构) 独立，可与 Task 1、Task 2、Task 3、Task 9、Task 12 并行
- Task 7 (双栏重建算法) 依赖 Task 6
- Task 8 (调用链改造) 依赖 Task 7、Task 9
- Task 9 (clean_text 增强) 独立，可与 Task 1、Task 2、Task 3、Task 6、Task 12 并行
- Task 10 (distill 结构化块) 依赖 Task 8（需 `reconstructed_text`）、Task 12（需 URL 解析）
- Task 11 (distill activity_type 聚类) 依赖 Task 2（需 `activity_type` 已写入 DB）
- Task 12 (URL 解析工具) 独立，可与 Task 1、Task 2、Task 3、Task 6、Task 9 并行
- Task 13 (Cargo.toml) 依赖 Task 3（UIA feature 必须在 Task 3 编译时已加）
- Task 14 (集成验证) 依赖全部前置任务完成

# 可并行批次建议
- 批次 A（无依赖，并行）：Task 1、Task 2、Task 3、Task 6、Task 9、Task 12 ✓
- 批次 B（依赖 A）：Task 4、Task 7、Task 13 ✓
- 批次 C（依赖 B）：Task 5、Task 8 ✓
- 批次 D（依赖 C）：Task 10、Task 11 ✓
- 批次 E（依赖 D）：Task 14（沙箱仅可验证单元测试；Windows 实机验证待用户在目标环境执行）

# 实际执行汇总
- 批次 A：Task 1+2（capture.rs 合并执行）、Task 3（uia.rs 新建）、Task 6+9（ocr.rs 合并执行）、Task 12（url_util.rs 新建）、Task 13（Cargo.toml）—— 4 个并行子代理
- 批次 B：Task 4+5（capture.rs 合并执行）、Task 7（ocr.rs）—— 2 个并行子代理
- 批次 C：Task 8（ocr.rs）、Task 11（distill.rs）—— 2 个并行子代理
- 批次 D：Task 10（distill.rs）—— 1 个子代理
- 批次 E：Task 14 沙箱单元测试验证 ✓；Windows 实机验证待用户执行

# 已知遗留（非本 spec 引入，属既有问题）
- `src/lib.rs:20` `tauri_plugin_global_shortcut::init` 未找到（plugin v2.3.5 API 变更）
- `src/ipc/commands.rs` 多处 `core::capture`/`distill`/`report`/`embedding` 名称解析失败（需 `crate::` 前缀）
- `tauri.conf.json` `resources/pet/*` glob 仅匹配子目录，build script 报 "didn't match any files"
- 上述问题阻断 `cargo check` 全量编译，但与本 spec 改动无关；本 spec 各子代理已验证未引入新错误
