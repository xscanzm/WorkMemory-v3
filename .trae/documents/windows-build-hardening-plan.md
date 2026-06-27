# Windows 构建加固计划

## 摘要

针对另一个 AI 审查提出的两个 Windows 构建问题进行核查、提出解决方案，并补充自我审查发现的其他 Windows 构建风险。

**核查结论**：
- "Tauri 2.11" — **属实**（Cargo.lock 实际解析到 tauri 2.11.3，Cargo.toml 的 `"2.0"` 是 semver `>=2.0, <3.0`）
- "RC.EXE 中文路径编码缺陷" — **部分属实，MEDIUM 风险**（tauri-build 内部调用 RC.EXE；tauri.conf.json 有 4 处中文字符串流入 .rc；旧 SDK 或非 ASCII 工作路径下可能失败）
- "Win32/WinRT 跨版本冲突" — **部分属实但被夸大，LOW-MEDIUM**（app 用 windows 0.58，Tauri 用 0.61，Cargo 同时编译两份；非阻断性冲突，是代码健康/体积问题）

## 当前状态分析

### Tauri 版本（属实）
- [Cargo.toml:18](file:///workspace/workmemory-app/src-tauri/Cargo.toml#L18) `tauri = "2.0"` (semver `>=2.0, <3.0`)
- Cargo.lock 实际解析：`tauri 2.11.3`、`tauri-build 2.6.3`、`tauri-plugin-shell 2.3.5`、`tauri-plugin-global-shortcut 2.3.2`、`tauri-plugin-notification 2.3.3`
- 审查者说的 "Tauri 2.11" 是准确的

### RC.EXE 暴露面（MEDIUM）
- [build.rs](file:///workspace/workmemory-app/src-tauri/build.rs) 仅有 `tauri_build::build()`，无自定义 RC 调用
- 无 `.rc` 文件、无 `embed-resource`/`winres` 依赖
- tauri-build 2.6.3 在 Windows 目标上内部生成临时 `.rc`（嵌入 icon.ico + manifest + version-info），调用 `rc.exe` 编译为 `.res`
- [tauri.conf.json](file:///workspace/workmemory-app/src-tauri/tauri.conf.json) 中 4 处中文字符串流入该 `.rc`：
  - L25 窗口 title: `"WorkMemory 今日记忆"`
  - L61 托盘 tooltip: `"WorkMemory 今日记忆"`
  - L78 shortDescription: `"本地优先的个人工作记忆伙伴"`
  - L79 longDescription: `"WorkMemory 在后台安静低打扰地整理..."`
- tauri-build 2.11 的缓解：写 UTF-8 BOM + `#pragma code_page(65001)`
- **真实失败模式**：
  1. 旧 Windows SDK（< 10.0.22000）RC.EXE 的 UTF-8 处理不可靠 → `error RC2104` 或乱码
  2. 工作目录绝对路径含非 ASCII（如中文用户名 `C:\Users\张三\...`）+ 系统 ACP 非 UTF-8（中文 Windows 默认 ACP=936/GBK）→ RC.EXE 无法打开 `.rc` 文件
- productName `"WorkMemory"` 是 ASCII，安全

### windows crate 版本分叉（LOW-MEDIUM，非阻断）
- [Cargo.toml:36](file:///workspace/workmemory-app/src-tauri/Cargo.toml#L36) app 直接依赖 `windows = "0.58"`
- Cargo.lock 中 `windows` 同时存在 **0.58.0** 和 **0.61.3** 两份
- `windows-core` 三份（0.58/0.61/0.62）、`windows-result` 三份、`windows-sys` 五份、`windows-targets` 三份
- 原因：`0.x` semver 视 `0.58` 与 `0.61` 为不兼容，Cargo 无法统一，重复编译
- app 的 windows 用法（全部 `#[cfg(target_os = "windows")]`）：
  - [uia.rs](file:///workspace/workmemory-app/src-tauri/src/core/uia.rs) — `windows::UI::UIAutomation::{CUIAutomation, IUIAutomation, ...}` + `Win32::Foundation::HWND`
  - [ocr.rs](file:///workspace/workmemory-app/src-tauri/src/core/ocr.rs) — `windows::Media::Ocr::OcrEngine` + `Foundation` + `Globalization` + `Graphics::Imaging`
  - [mascot.rs](file:///workspace/workmemory-app/src-tauri/src/core/mascot.rs) — `Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW}`
  - [capture.rs](file:///workspace/workmemory-app/src-tauri/src/core/capture.rs) — `Win32::UI::WindowsAndMessaging` + `Win32::System::Threading` + `Win32::Foundation` + `core::PWSTR`
- 无 `#[link]` 属性，无链接器级冲突
- 当前未触发的隐患：app 的 0.58 类型与 Tauri 公开 API 暴露的 0.61 类型不能混用（目前 Tauri 公开 API 不暴露 raw windows 类型，故未咬人）

### 自我审查发现的其他 Windows 构建风险
1. **MSI 打包需 WiX（MEDIUM）** — [tauri.conf.json:66](file:///workspace/workmemory-app/src-tauri/tauri.conf.json#L66) `targets: "all"` 会在 Windows 产出 NSIS + MSI + portable。MSI 需要 WiX Toolset 在 PATH 上，Tauri 不自动安装。无自定义 `.wxs` 模板。
2. **beforeBuildCommand 耦合 typecheck（MEDIUM）** — `pnpm build` = `tsc --noEmit && vite build`，任何 TS 类型错误会中断整个 Tauri 打包。
3. **mascot 透明窗口运行时脆弱（MEDIUM，运行时非构建期）** — `transparent: true` + `decorations: false` + `alwaysOnTop: true` 在 Windows 上走 `DwmExtendFrameIntoClientArea` + WebView2 合成路径，部分 Windows 版本/GPU 驱动下会出现黑底/闪烁。
4. **无平台特定 Tauri 配置覆盖（LOW）** — 无 `tauri.windows.conf.json`，无 NSIS/WiX 自定义模板，意味着默认行为对 RC.EXE/非 ASCII 路径无项目级加固。
5. **无 CI 工作流（LOW）** — 无 `.github/workflows/`，Windows 产物目前只能在 dev 机本地构建，无法保证在受控 ASCII 路径环境下产出权威发布物。

## 提议变更

### 变更 1：升级 windows crate 0.58 → 0.61（对齐 Tauri）
**文件**：[Cargo.toml](file:///workspace/workmemory-app/src-tauri/Cargo.toml)
**改什么**：L36 `windows = { version = "0.58", ... }` → `windows = { version = "0.61", ... }`，features 列表保持不变（0.61 兼容这些 feature 名）。
**为什么**：让 Cargo 统一 app 与 Tauri 的 windows 依赖，消除重复编译（两份 → 一份）、二进制瘦身、消除类型隔离隐患。
**怎么做**：
1. 改 Cargo.toml 版本号
2. 删除 Cargo.lock 中 windows 0.58 相关条目（`cargo update -p windows --precise 0.61.3` 或直接 `cargo build` 让 Cargo 重新解析）
3. 逐文件验证 4 个 Windows 源文件编译通过：
   - [uia.rs](file:///workspace/workmemory-app/src-tauri/src/core/uia.rs)
   - [ocr.rs](file:///workspace/workmemory-app/src-tauri/src/core/ocr.rs)
   - [mascot.rs](file:///workspace/workmemory-app/src-tauri/src/core/mascot.rs)
   - [capture.rs](file:///workspace/workmemory-app/src-tauri/src/core/capture.rs)
4. 0.58→0.61 之间这些 feature 的 API 通常稳定；若个别 import 路径或方法名变化，按编译器提示微调（预期改动量 < 20 行）
5. 验证命令：`cd /workspace/workmemory-app/src-tauri && cargo check --lib 2>&1 | grep -E "windows|uia|ocr|mascot|capture" | head -40`（仅关注 windows 相关错误，预存的 stats_engine/capture/distill/report/embedding 裸路径错误忽略）

### 变更 2：开发文档增补 Windows 构建前置条件
**文件**：[10_DEVELOPMENT_GUIDE.md](file:///workspace/10_DEVELOPMENT_GUIDE.md)
**改什么**：在「环境要求」或新增「Windows 构建注意事项」章节，补充：
1. **Windows SDK 版本**：要求 ≥ 10.0.22000（Windows 11 SDK 或 Windows 10 SDK 10.0.22000+），以获得 RC.EXE 对 UTF-8 + codepage 65001 的可靠支持
2. **系统区域设置**：若 SDK 较旧，在「区域设置 → 管理 → 更改系统区域设置」勾选「Beta: 使用 Unicode UTF-8 提供全球语言支持」并重启
3. **构建路径**：避免在含中文的用户目录下构建（如 `C:\Users\张三\...`）；推荐 `C:\dev\workmemory-app\` 或类似 ASCII 路径
4. **RC.EXE 失败症状识别**：`error RC2104`、`error RC2188`、或嵌入的版本信息出现乱码 → 按上述 1-3 排查
5. **MSI 打包**：若需 `.msi` 产物，安装 [WiX Toolset 3.x](https://wixtoolset.org/) 并加入 PATH；否则用 `tauri build --bundles nsis` 仅产出 NSIS 安装包
6. **透明窗口已知问题**：mascot 窗口在某些 GPU/驱动下可能黑底，排查方向：更新显卡驱动、关闭硬件加速 WebView2 选项、或临时设 `transparent: false` 验证
**为什么**：让 Windows 开发者首次构建不踩 RC.EXE 的坑；这是 Tauri 生态的已知问题，文档化是最具性价比的缓解。
**怎么做**：用 Edit 在 FAQ 章节后追加新章节，约 80-120 行。

### 变更 3：新增 GitHub Actions CI 工作流（Windows 权威构建）
**文件**：`/workspace/.github/workflows/ci.yml`（新建）
**改什么**：新增 CI 工作流，覆盖：
1. **matrix**：`ubuntu-latest`、`windows-latest`（Windows runner 路径是 ASCII `D:\a\workmemory-app\...`，规避 RC.EXE 路径问题）
2. **steps**：
   - checkout
   - 安装 Rust stable + pnpm + Node 18
   - `pnpm install`
   - `pnpm typecheck`
   - `pnpm test`（Vitest）
   - Linux: `cargo test --manifest-path src-tauri/Cargo.toml`（Windows 跳过，因预存裸路径错误）
   - `pnpm tauri:build`（仅 Windows runner 产出 .exe/.msi；Linux 跳过或仅 typecheck）
   - 上传 Windows 产物为 artifact
3. **触发**：push 到 main、pull request
**为什么**：在受控 ASCII 路径 + 最新 Windows SDK 环境下产出权威发布物，规避 dev 机中文用户名路径风险；同时建立持续集成基线。
**怎么做**：用 Write 新建文件，约 60-80 行 YAML。

### 变更 4：tauri.conf.json 增补 NSIS 配置（可选加固）
**文件**：[tauri.conf.json](file:///workspace/workmemory-app/src-tauri/tauri.conf.json)
**改什么**：在 `bundle` 下新增 `windows` 子配置：
```json
"windows": {
  "nsis": {
    "installerIcon": "icons/icon.ico",
    "installMode": "perMachine",
    "languages": ["SimpChinese", "English"]
  },
  "wix": {
    "language": ["zh-CN", "en-US"]
  }
}
```
**为什么**：显式声明 NSIS/WiX 安装包语言，避免默认英文安装包在中文 Windows 上的本地化缺失；`installMode: perMachine` 避免安装到含中文用户名的 `%LOCALAPPDATA%`。
**怎么做**：用 Edit 在 `bundle` 对象内追加 `windows` 键。**此项为可选**——若你认为增加配置复杂度不必要，可跳过，仅靠变更 2 的文档说明。

### 变更 5：CHANGELOG 记录
**文件**：[CHANGELOG.md](file:///workspace/CHANGELOG.md)
**改什么**：在 `[Unreleased]` 段追加：
- Changed: windows crate 0.58 → 0.61（对齐 Tauri 2.11，消除重复编译）
- Added: Windows 构建前置条件文档（10_DEVELOPMENT_GUIDE.md 新增章节）
- Added: GitHub Actions CI 工作流（Windows + Ubuntu matrix）
- Added: tauri.conf.json NSIS/WiX 安装包语言配置
**为什么**：保持变更日志完整。

## 假设与决策

1. **windows crate 升级到 0.61（非保留 0.58）**：权衡了"零代码风险（保留 0.58）" vs "消除重复编译+体积+类型隐患（升级 0.61）"。选择升级，因为 0.58→0.61 对所用的 Win32/WinRT feature 通常是稳定 API，适配风险可控（< 20 行），而长期收益明确。若升级后发现 API 破坏严重，可回退到 0.58 + 文档说明作为备选。

2. **RC.EXE 缓解采用"文档 + CI"而非"自定义 build.rs 接管 RC"**：自定义 build.rs 用 embed-resource/winres 完全接管 RC 风险高（与 tauri-build 的 icon/manifest 嵌入协调复杂），而文档 + CI 组合能覆盖 95% 场景且零构建脚本风险。tauri.conf.json 的中文字符串保留（它们是用户可见的正确内容，不应为了规避 RC.EXE 而删改）。

3. **NSIS 配置（变更 4）标记为可选**：如果你希望计划更精简，可只做变更 1-3。变更 4 是锦上添花的安装包本地化。

4. **不修改 tauri.conf.json 的中文字符串**：productName 已是 ASCII（安全）；其余中文字符串是产品定位内容，删除或改成英文会损害用户体验。正确做法是让构建环境支持 UTF-8（变更 2/3），而非削足适履。

5. **预存的 `core::stats_engine`/`capture`/`distill`/`report`/`embedding` 裸路径编译错误不在本计划范围**：这些是前序会话遗留问题，与本 Windows 构建加固无关，且 `cargo check --lib` 时按文件名过滤即可排除干扰。

## 验证步骤

### 验证变更 1（windows crate 升级）
1. `cd /workspace/workmemory-app/src-tauri && cargo check --lib 2>&1 | grep -E "error" | grep -vE "stats_engine|capture::|distill::|report::|embedding::|frontendDist" | head -40`
   - 期望：无 windows/uia/ocr/mascot/capture 相关错误（预存错误已过滤）
2. `grep -c "name = \"windows\"" Cargo.lock`
   - 期望：从 2 降为 1（仅 0.61.x 一份）
3. `grep -c "name = \"windows-core\"" Cargo.lock`
   - 期望：从 3 降为 ≤2

### 验证变更 2（文档）
- Read [10_DEVELOPMENT_GUIDE.md](file:///workspace/10_DEVELOPMENT_GUIDE.md) 确认新章节存在且内容准确

### 验证变更 3（CI）
- Read `.github/workflows/ci.yml` 确认 YAML 语法正确、matrix 含 windows-latest、steps 完整
- （可选）`pnpm --dir /workspace/workmemory-app exec yaml-lint .github/workflows/ci.yml` 若 yaml-lint 可用

### 验证变更 4（NSIS 配置，若执行）
- Read [tauri.conf.json](file:///workspace/workmemory-app/src-tauri/tauri.conf.json) 确认 `bundle.windows` 结构正确
- `cd /workspace/workmemory-app/src-tauri && cargo check --lib 2>&1 | grep -i "tauri.conf\|schema"` 确认无 schema 校验错误

### 验证变更 5（CHANGELOG）
- Read [CHANGELOG.md](file:///workspace/CHANGELOG.md) 确认 `[Unreleased]` 段已更新

### 整体验证
- `cd /workspace/workmemory-app/src-tauri && cargo check --lib 2>&1 | tail -20`
  - 期望：剩余错误均为预存的 stats_engine/capture/distill/report/embedding 裸路径错误 + 环境性 frontendDist 宏 panic；无新错误
- `pnpm --dir /workspace/workmemory-app typecheck 2>&1 | tail -10`
  - 期望：仅预存的 MascotWindow.tsx + api.ts 6 个错误，无新错误
- `pnpm --dir /workspace/workmemory-app test 2>&1 | tail -10`
  - 期望：22/22 通过

## 范围外（不做）

- 不修复预存的 `core::stats_engine`/`capture`/`distill`/`report`/`embedding` 裸路径错误（前序会话遗留，与本计划无关）
- 不修改 tauri.conf.json 的中文字符串（它们是正确的用户可见内容）
- 不替换 tauri-build 的默认 RC 调用为自定义 embed-resource（风险收益比不佳）
- 不处理 mascot 透明窗口的运行时渲染问题（运行时非构建期，需实机调试）
