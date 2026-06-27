# Checklist

## 一、进程与窗口元数据增强
- [x] UWP 套壳解包：`process_name == "ApplicationFrameHost.exe"` 时通过 `EnumChildWindows` 递归找到真实子进程覆盖 `ForegroundInfo.process_name` / `app_name`（capture.rs:677-720）
- [x] UWP 解包逻辑有非 Windows stub，保证 `cargo check` 通过（capture.rs 非 Windows stub 分支）
- [x] `ACTIVITY_TYPE_MAP` 常量数组覆盖 35 个常见进程（capture.rs:38-74）
- [x] `lookup_activity_type` 函数大小写不敏感匹配，未命中返回 `"other"`（capture.rs:77-85）
- [x] `insert_segment` 与 `insert_private_segment` SQL 实际写入 `activity_type` 列（capture.rs:236, 270）
- [x] 单元测试覆盖 `Code.exe → coding`、`CODE.EXE → coding`、`unknown.exe → other`（capture.rs:926-943）

## 二、浏览器 URL 深度捕获
- [x] 新增 `core/uia.rs` 模块，声明到 `core/mod.rs`
- [x] `extract_browser_url(hwnd: usize) -> Option<String>` 函数实现，仅在浏览器白名单内进程调用
- [x] Chrome 识别：匹配 `ClassName == "OmniboxViewViews"`，读取 `ValuePattern.Value`（uia.rs:66-72）
- [x] Edge 识别：匹配 `ClassName == "AriaEdit"` 或 `ControlType == Edit && AutomationId.contains("url")`（uia.rs:75-90）
- [x] 通用退避：上述两者未命中时，深度优先找第一个支持 `ValuePattern` 的 Edit 节点（uia.rs:93-99）
- [x] UIA 调用失败返回 `None` + `log::warn!`，不阻断主流程（uia.rs:49-52, 59-62）
- [x] 非 Windows 平台 stub：返回 `None`（uia.rs:192-195）
- [x] `ForegroundInfo` 结构体新增 `browser_url: Option<String>` 字段（capture.rs:114）
- [x] `get_foreground_window` 对浏览器白名单进程调用 `uia::extract_browser_url` 填充 `browser_url`（capture.rs:745-747）
- [x] `insert_segment` / `insert_private_segment` SQL 实际写入 `browser_url` 列（NULL 时传 NULL）（capture.rs:238, 272）
- [x] 非 Windows 平台 `ForegroundInfo.browser_url` 始终为 `None`（capture.rs:875）
- [x] Cargo.toml `windows` features 新增 `UI_UIAutomation`、`Win32_UI_Accessibility`（Cargo.toml:47-48；注：windows 0.58 feature 名为 `UI_UIAutomation`）

## 三、隐私守卫 L3 修复
- [x] `start_polling` 主循环调用 `matches_privacy_rules` 第三参数从 `None` 改为 `fg.browser_url.as_deref()`（capture.rs:463）
- [x] 验证 `chrome-extension://` 等敏感 URL 现可命中 L3 url 规则（单元测试 `privacy_url_rule_matches_chrome_extension`）
- [x] 验证非浏览器进程（`browser_url = None`）L3 不误判为安全（单元测试 `privacy_url_rule_skipped_when_url_none`）
- [x] 隐私守卫仍在前置位置（截图前熔断），命中后不调用 UIA / 截图 / OCR（capture.rs:457-480 流程顺序保持）

## 四、WinRT OCR 双栏重建
- [x] `OcrWordInfo` 与 `OcrLineInfo` 结构体定义（含 `text` / `x` / `y` / `width` / `height`）（ocr.rs:28-41）
- [x] `recognize_inner` 返回 `windows::core::Result<Vec<OcrLineInfo>>`，遍历 `result.Lines()` → `line.Words()` 提取几何信息（ocr.rs:288-353）
- [x] 非 Windows stub 返回空 `Vec<OcrLineInfo>`（ocr.rs:371-374）
- [x] `reconstruct_columns(lines: &[OcrLineInfo]) -> String` 函数实现
- [x] X 坐标直方图按 50px 分桶
- [x] 双栏检测：存在 80px+ 宽度空白带且该区间 word 数为 0
- [x] 单栏：按 Y 升序逐行输出（Y 容差 20px 内合并为一行）
- [x] 双栏：输出 `[左栏]\n` + 左组按 Y 排序 + `\n[右栏]\n` + 右组按 Y 排序
- [x] 单元测试：单峰 X 分布 → 无栏目标记；双峰 X 分布 → 含 `[左栏]` / `[右栏]` 标记（5 个测试 standalone rustc 验证通过）
- [x] `recognize` 调用链改造：`recognize_inner` → `reconstruct_columns` → `clean_text` → `persist_ocr_result`（ocr.rs run_ocr_queue）

## 五、OCR 文本清洗规则增强
- [x] `is_noise_only_line` 函数：行内全部为噪音字符时返回 true（ocr.rs:221-231）
- [x] `is_pure_separator_line` 函数：行内仅由 ≤ 2 种符号重复组成且长度 ≥ 3 时返回 true（ocr.rs:234-248）
- [x] 空行规则：3+ 连续空行合并为 1 个换行（保留段落结构）（ocr.rs:193-215）
- [x] `clean_text` 处理顺序：噪音行 → 符号行 → 单字符行 → 行合并 → 空行折叠（ocr.rs:151-218）
- [x] 单元测试：`"□ □ □"` → 丢弃；`"---"` → 丢弃；`"=== === ==="` → 丢弃；`"确定"` → 保留；5 连续空行 → 1 换行（ocr.rs:380-453，14 个测试）

## 六、URL 域名/路径解析
- [x] 新增 `core/url_util.rs` 模块，声明到 `core/mod.rs`
- [x] `parse_domain_path(url: &str) -> Option<(String, String)>` 函数实现
- [x] 剥离 query（`?...`）与 fragment（`#...`）
- [x] 边界处理：无 scheme、`chrome-extension://`、`about:blank`、`file://`
- [x] 单元测试覆盖上述边界（16 个测试）

## 七、AI 蒸馏结构化场景块
- [x] `serialize_segment_block(seg: &WorkSegment) -> serde_json::Value` 函数实现，输出六字段（distill.rs:346-371）
- [x] `WorkSegment` 已读取 `browser_url` 与 `activity_type` 列（models.rs:29-30 + repository.rs:19 SEGMENT_COLS）
- [x] AI Prompt 拼接时每个 Segment 序列化后 `\n` 拼接注入（distill.rs:373-382 build_ocr_records）
- [x] `browser_url` 存在时在 `reconstructed_text` 前加 `"网页上下文：{domain}{path}\n"` 前缀（distill.rs:355-360）
- [x] `browser_url` 为 NULL 时不生成"网页上下文"前缀（distill.rs:361-363）
- [x] 单元测试覆盖上述两种路径（distill.rs:1309-1339）

## 八、distill.rs activity_type 聚类维度
- [x] 降级聚类函数：相邻 Segment `activity_type` 相同（且非 `"other"`）倾向合并（distill.rs:604-616）
- [x] `infer_memory_kind` 增加 `activity_type` 入参：coding→work、browsing→research、communication→meeting、document→documentation、spreadsheet→work、terminal→work、other 保持现有逻辑（distill.rs:798-820）
- [x] 单元测试：3 个不同浏览器进程 Segment（`activity_type = browsing`）合并为同一 Episode 簇（distill.rs:1217-1228）
- [x] 互补测试：`activity_type="other"` 不触发跨进程合并（distill.rs:1230+）

## 九、构建与平台兼容
- [x] Cargo.toml `windows` features 含 `UI_UIAutomation` 与 `Win32_UI_Accessibility`（Cargo.toml:47-48）
- [x] `tauri` features 补齐 `protocol-asset`（Cargo.toml:18，修复 tauri.conf.json assetProtocol.enable 不匹配）
- [x] `cargo check`（非 Windows 沙箱）通过 stub 路径不引入新错误（各子代理独立验证：capture.rs / uia.rs / ocr.rs / distill.rs / url_util.rs 均无新错误）
- [x] `cargo check`（Windows 目标）依赖解析 + features 存在且无冲突（UI_UIAutomation 为 windows 0.58 正确 feature 名）
- [ ] `cargo test` 全部单元测试通过 —— **部分阻断**：纯逻辑函数（lookup_activity_type / reconstruct_columns / clean_text / parse_domain_path）已通过 standalone rustc 验证；全 crate `cargo test` 被既有 lib.rs/commands.rs 编译错误阻断（非本 spec 引入）

## 十、端到端集成验证（Windows 实机）
- [ ] 前台 VS Code → `segments.activity_type = "coding"`、`browser_url = NULL`（需 Windows 实机）
- [ ] 前台 Chrome 打开 GitHub PR → `segments.browser_url` 为完整 URL、`activity_type = "browsing"`（需 Windows 实机）
- [ ] 前台 Edge 打开 `chrome-extension://` → 隐私命中，`is_private=1, ocr_status='skipped'`，不截图/OCR（需 Windows 实机）
- [ ] 前台飞书双栏文档 → `segments.ocr_text` 含 `[左栏]` / `[右栏]` 标记（需 Windows 实机）
- [ ] 整点蒸馏 → AI Prompt 上下文含结构化 JSON 块 + 网页上下文前缀（需 Windows 实机）
- [ ] 前台 Windows 设置 UWP → `process_name` 为 `SystemSettings.exe` 而非 `ApplicationFrameHost.exe`（需 Windows 实机）

## 十一、回归与不破坏既有功能
- [x] pHash 95% Merge 行为不变（capture.rs start_polling 主循环的 pHash 路径未被改动，PHASH_MERGE_SIMILARITY=0.95 保留）
- [x] 180s Idle 检测行为不变（仍基于 `GetLastInputInfo`，未引入 Hook，IDLE_THRESHOLD_SECS=180 保留）
- [x] 隐私 L1/L2 规则仍生效（L3 修复仅改第三参数，L1 app / L2 keyword 分支不变）
- [x] WinRT OCR zh-Hans-CN 优先 + 用户语言回退逻辑不变（ocr.rs recognize_inner 引擎选择逻辑保留）
- [x] 既有 `clean_text` 行合并规则（行尾无终止标点 + 行首非大写/非中文时拼接）保留（ends_with_terminal_punct / starts_with_upper_or_cjk 未改）
- [x] `segments` 表 schema 未变更（`browser_url`/`activity_type` 列已存在，migrations.rs 未改）
- [x] 旧数据（`browser_url`/`activity_type` 为 NULL）蒸馏时不报错，按缺失处理（serialize_segment_block 对 None 安全；infer_memory_kind 对 None 回退 process_name 逻辑；聚类对 None 不触发 same_activity 合并）

# 验证总结

## 沙箱内已验证（✓）
- 13 个实现任务（Task 1-13）全部完成，代码已落盘
- 纯逻辑单元测试通过 standalone rustc 验证：lookup_activity_type、reconstruct_columns、clean_text、is_noise_only_line、is_pure_separator_line、parse_domain_path、is_browser_process、L3 隐私规则匹配、serialize_segment_block、cluster_merges_same_activity_type_different_process
- 各子代理独立确认未引入新的编译错误
- protocol-asset 阻塞已修复
- windows 0.58 正确 feature 名（UI_UIAutomation）已确认

## 待 Windows 实机验证（□）
- Task 14 的 6 个端到端子任务均需 Windows 实机执行（沙箱为 Linux，无 Win32/WinRT/UIA 运行时）
- 全 crate `cargo test` 因既有 lib.rs/commands.rs 编译错误阻断（非本 spec 引入），需先修复既有问题才能在沙箱运行完整测试套件

## 既有问题（非本 spec 引入，需单独处理）
- `src/lib.rs:20` `tauri_plugin_global_shortcut::init` 未找到（plugin v2.3.5 API 变更，可能需改为 `Builder::default()`）
- `src/ipc/commands.rs` 多处 `core::capture`/`distill`/`report`/`embedding` 名称解析失败（需改为 `crate::core::xxx`）
- `tauri.conf.json` `resources/pet/*` glob 仅匹配子目录，build script 报错（需调整 glob 模式或添加占位文件）
