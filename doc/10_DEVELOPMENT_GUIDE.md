# 10 开发指南 (Development Guide)

> 本文档面向 WorkMemory-v3 的所有贡献者，覆盖环境要求、项目结构、构建与测试命令、调试技巧、常见问题与贡献流程。
> 设计文档位于仓库根目录（`00_PRODUCT_VISION.md` ~ `09_PRODUCT_ACCEPTANCE_LEDGER.md`），本文档为补充的开发者操作手册。
> 实施背景详见 `analysis_results.md`（14 Bug + 19 优化 + 13 缺失组件 + 8 缺失引擎）。

---

## 目录

1. [环境要求](#1-环境要求)
2. [项目结构](#2-项目结构)
3. [构建命令](#3-构建命令)
4. [测试命令](#4-测试命令)
5. [调试技巧](#5-调试技巧)
6. [常见问题 (FAQ)](#6-常见问题-faq)
7. [贡献流程](#7-贡献流程)

---

## 1. 环境要求

### 1.1 必备工具链

| 工具 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | ≥ 18 | 推荐 18 LTS 或 20 LTS，前端构建与 Vitest 依赖 |
| pnpm | ≥ 9 | 包管理器（仓库附带 `pnpm-lock.yaml`，**不要**使用 npm/yarn） |
| Rust | stable 1.77+ | `Cargo.toml` 中 `rust-version = "1.77"`，edition 2021 |
| Tauri CLI | 2.x | 已作为 `devDependency`（`@tauri-apps/cli ^2.0.0`）随 `pnpm install` 安装，通过 `pnpm tauri` 调用 |

> 校验安装：
> ```bash
> node -v        # v18.x 或更高
> pnpm -v        # 9.x 或更高
> rustc --version    # rustc 1.77.0 或更高
> cargo --version
> ```

### 1.2 系统依赖

Tauri 2.x 桌面应用在不同操作系统需要不同的原生依赖。

**Linux (Ubuntu/Debian)**：
```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

> 注意：Tauri 2.x 使用 `libwebkit2gtk-4.1`（而非 1.x 的 4.0）。若发行版仅提供 4.0，请升级或使用 4.1 可用的发行版。

**macOS**：安装 Xcode Command Line Tools 与稳定版 Rust 即可（WebKit 由系统提供）。
```bash
xcode-select --install
```

**Windows**：安装 [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 与 [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)（Win11 默认自带）。Rust 的 `windows` crate（`Cargo.toml` `[target.'cfg(target_os = "windows")']`）用于 WinRT OCR 与窗口控制。

### 1.3 可选工具

- `sqlite3` CLI：手动检查 `workmemory.db`（见 [§5 调试技巧](#5-调试技巧)）。
- `cargo-tarpaulin`：Rust 覆盖率统计（见 `11_TESTING_STRATEGY.md`）。
- Playwright（计划中）：E2E 测试，详见 `11_TESTING_STRATEGY.md` §4。

---

## 2. 项目结构

WorkMemory-v3 采用**双布局**结构：Tauri 应用代码集中在 `workmemory-app/`，设计文档与精灵图资源放在仓库根目录。

```
/workspace/
├── 00_PRODUCT_VISION.md            # 设计文档（00-09，根目录）
├── 01_ARCHITECTURAL_DECISIONS.md
├── ...
├── 09_PRODUCT_ACCEPTANCE_LEDGER.md
├── 10_DEVELOPMENT_GUIDE.md         # 本文档
├── 11_TESTING_STRATEGY.md
├── CHANGELOG.md
├── analysis_results.md             # 驱动本次全量实施的审计报告
├── pet/                            # 宠物精灵图资源（9 套）
│   ├── 1/
│   │   ├── pet.json                # 帧定义（行列数、各状态帧范围）
│   │   └── spritesheet.webp        # 精灵图
│   └── ... (2 ~ 9)
└── workmemory-app/                 # ★ Tauri 应用根目录
    ├── package.json                # 前端脚本与依赖（pnpm）
    ├── pnpm-lock.yaml
    ├── vitest.config.ts            # Vitest 配置（jsdom + setup）
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html
    ├── src/                        # ★ 前端源码（React 18 + TS）
    │   ├── App.tsx
    │   ├── main.tsx
    │   ├── components/             # UI 组件（FAB/TaskCard/Toast/PetSpriteDisplay ... 共 20+）
    │   ├── views/                  # 页面视图（HomeView/TasksView/FocusView/PetView/SettingsView ...）
    │   ├── store/                  # Zustand store（taskStore/petStore/focusStore/toastStore ...）
    │   ├── i18n/                   # 国际化（zh-CN / en-US + index.tsx）
    │   ├── hooks/
    │   ├── styles/                 # variables.css + index.css
    │   ├── types/index.ts          # 前端共享类型
    │   ├── test/setup.ts           # ★ Vitest 全局 setup（mock __TAURI_INTERNALS__）
    │   └── src-tauri/              # ★★ 前端 Tauri API 封装层（非后端骨架！）
    │       ├── api.ts              #   @tauri-apps/api 统一封装 + isTauri() 运行时判断
    │       └── mock.ts             #   Web/dev 环境下的 Mock 挡板
    └── src-tauri/                  # ★ Rust 后端
        ├── Cargo.toml              # crate: workmemory-app v3.0.0
        ├── tauri.conf.json         # Tauri 配置（窗口/CSP/资源/托盘）
        ├── build.rs
        ├── icons/
        ├── resources/pet/          # 打包进应用的占位资源
        └── src/
            ├── lib.rs              # 应用入口（注册命令、初始化 DB、启动调度器）
            ├── main.rs
            ├── models.rs           # Rust 类型定义（Task/PetState/FocusSession/DailyStats ...）
            ├── core/               # ★ 8 个引擎模块
            │   ├── task_engine.rs
            │   ├── pet_engine.rs
            │   ├── focus_engine.rs
            │   ├── analytics_engine.rs
            │   ├── soundscape_engine.rs
            │   ├── event_bus.rs
            │   ├── scheduler.rs
            │   ├── error.rs        # AppError 枚举
            │   └── ... (capture/distill/report/ocr 等已有模块)
            ├── db/                 # SQLite 持久化
            │   ├── connection.rs   # WAL + 外键初始化
            │   ├── migrations.rs   # 8 张表 DDL + FTS5
            │   ├── repository.rs   # CRUD
            │   └── mod.rs
            └── ipc/                # Tauri 命令与事件
                ├── commands.rs     # #[tauri::command] 处理器
                ├── events.rs
                └── mod.rs
```

### 2.1 三个 "src-tauri" 概念辨析（重要）

仓库中存在**三个**容易混淆的路径，务必区分：

| 路径 | 性质 | 内容 |
|------|------|------|
| `workmemory-app/src-tauri/` | **Rust 后端** | `Cargo.toml`、`src/lib.rs`、`tauri.conf.json`，真正的 Tauri 后端代码 |
| `workmemory-app/src/src-tauri/` | **前端 Tauri API 封装层** | 仅 `api.ts` + `mock.ts`，前端调用 Tauri 的统一入口与 Mock |
| `workmemory-app/src/` | **前端源码根** | React/TS 应用代码 |

> ⚠️ `workmemory-app/src/src-tauri/` **不是**重复的后端骨架，详见 [§6 FAQ Q2](#q2-srcsrc-tauri-看起来像重复的后端骨架该删掉吗)。这是 v3 最常见的误读之一。

### 2.2 资源加载约定

- **设计文档**：根目录 `*.md`，编号 00-11 + CHANGELOG。
- **宠物精灵图**：`/workspace/pet/{1..9}/spritesheet.webp`（开发期原始资源）。打包时由 `tauri.conf.json` 的 `bundle.resources` 与 `assetProtocol.scope` 控制（`$RESOURCE/pet/**`），运行时通过 `asset://localhost/pet/{id}/spritesheet.webp` 访问。
- **数据库**：运行时创建于系统 `app_data_dir` 下，文件名 `workmemory.db`（见 `lib.rs`）。

---

## 3. 构建命令

所有前端命令在 `workmemory-app/` 目录下执行；Rust 命令使用 `--manifest-path` 指向 `src-tauri/Cargo.toml`，或先 `cd src-tauri`。

### 3.1 安装依赖

```bash
cd workmemory-app
pnpm install
```

> 首次安装会一并拉取 `@tauri-apps/cli`，可用 `pnpm tauri` 调用 Tauri CLI。Rust 依赖由 `cargo` 在首次构建时自动拉取。

### 3.2 开发模式

```bash
# 仅前端（Vite dev server，端口 1420，使用 mock.ts 挡板，无 Rust 后端）
pnpm dev

# 完整 Tauri 应用（启动 Rust 后端 + 前端，自动调用 pnpm dev 作为 beforeDevCommand）
pnpm tauri:dev
# 等价于：pnpm tauri dev
```

`tauri.conf.json` 中 `beforeDevCommand = "pnpm dev"`、`devUrl = "http://localhost:1420"`，因此 `pnpm tauri:dev` 会自动拉起前端 dev server。

### 3.3 生产构建

```bash
# 前端类型检查 + Vite 构建（输出到 workmemory-app/dist）
pnpm build

# 完整生产打包（前端构建 + Rust release 编译 + 平台安装包）
pnpm tauri:build
```

### 3.4 类型检查

```bash
pnpm typecheck      # tsc --noEmit
```

### 3.5 Rust 编译检查

```bash
# 从 workmemory-app/ 目录执行（无需 cd）：
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# 或进入 src-tauri 后执行：
cd src-tauri
cargo check
cargo clippy
```

> ⚠️ **已知问题**：当前 `cargo build` / `cargo test` 因 `commands.rs` 中的裸模块路径（`core::stats_engine` 等）会编译失败，详见 [§6 FAQ Q1](#q1-cargo-build-报错-corestats_engine-not-found)。`cargo check` 同样受此影响。新增命令请使用 `use crate::core::xxx;` 导入。

### 3.6 常用命令速查表

| 场景 | 命令 |
|------|------|
| 安装依赖 | `pnpm install` |
| 前端开发 | `pnpm dev` |
| 全栈开发 | `pnpm tauri:dev` |
| 前端构建 | `pnpm build` |
| 生产打包 | `pnpm tauri:build` |
| 类型检查 | `pnpm typecheck` |
| Rust 检查 | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Rust Lint | `cargo clippy --manifest-path src-tauri/Cargo.toml` |
| 前端测试 | `pnpm test` |
| Rust 测试 | `cargo test --manifest-path src-tauri/Cargo.toml`（当前受 Q1 阻塞） |

---

## 4. 测试命令

测试体系详见 `11_TESTING_STRATEGY.md`，此处仅列出命令。

### 4.1 前端测试（Vitest 3.x）

```bash
pnpm test            # 单次运行（vitest run）
pnpm test:watch      # 监听模式（vitest）
pnpm test:ui         # 浏览器 UI 面板（vitest --ui）
pnpm test:coverage   # 覆盖率报告（v8 coverage）
```

配置文件：`workmemory-app/vitest.config.ts`（jsdom 环境、globals、setup 文件 `src/test/setup.ts`、`@` → `src` 别名）。

### 4.2 Rust 单元测试

```bash
cargo test --manifest-path src-tauri/Cargo.toml
# 或
cd src-tauri && cargo test

# 只跑某个引擎：
cargo test --manifest-path src-tauri/Cargo.toml pet_engine
```

Rust 测试以 `#[cfg(test)] mod tests` 形式内联在各 `core/*.rs` 文件底部，无需单独的测试目录。

> 受 [§6 Q1](#q1-cargo-build-报错-corestats_engine-not-found) 影响，`cargo test` 当前整体编译失败。各引擎模块（`task_engine`/`pet_engine`/`focus_engine`/`analytics_engine`/`soundscape_engine`）本身的单元测试已编写完毕（共 34 个），待裸模块路径问题修复后即可整体执行。

---

## 5. 调试技巧

### 5.1 前端 DevTools

`pnpm tauri:dev` 启动后，应用窗口内按 `F12`（或右键 → Inspect Element）打开 WebView DevTools：

- **Console**：查看 `console.error`/`console.warn`、CSP 违规报告。
- **Network**：观察 `asset://` 资源加载、`@tauri-apps/api` 调用。
- **React DevTools**：建议安装浏览器扩展以检查组件树与 Zustand store。
- **Application → Local Storage**：查看 i18n 语言偏好等持久化键。

> 生产构建（`pnpm tauri:build`）默认关闭 DevTools。开发期 `tauri:dev` 默认开启。

### 5.2 Rust 日志

应用使用 `env_logger`（见 `lib.rs`），通过环境变量控制日志级别：

```bash
# Linux/macOS
RUST_LOG=debug pnpm tauri:dev

# Windows (PowerShell)
$env:RUST_LOG="debug"; pnpm tauri:dev
```

日志级别遵循 `RUST_LOG=workmemory_app_lib=debug` 精细控制，默认 `info`。日志输出到启动 `tauri:dev` 的终端。

### 5.3 数据库检查

`workmemory.db` 位于系统 `app_data_dir`：

| 平台 | 路径 |
|------|------|
| Linux | `~/.local/share/com.workmemory.app/workmemory.db` |
| macOS | `~/Library/Application Support/com.workmemory.app/workmemory.db` |
| Windows | `%APPDATA%\com.workmemory.app\workmemory.db` |

用 `sqlite3` CLI 检查：

```bash
sqlite3 ~/.local/share/com.workmemory.app/workmemory.db

# 常用查询：
.tables                                    # 列出 8 张表
.schema tasks                              # 查看 tasks 表结构
SELECT id, title, status FROM tasks LIMIT 20;
SELECT * FROM pet_state;
SELECT * FROM daily_stats ORDER BY date DESC LIMIT 7;
SELECT * FROM focus_sessions ORDER BY start_time DESC LIMIT 10;
```

> 数据库使用 WAL 模式（`db/connection.rs`），同目录下会有 `workmemory.db-wal`、`workmemory.db-shm`。查询前可先 `.exit` 退出应用以避免锁竞争。

### 5.4 CSP 违规诊断

`tauri.conf.json` 配置了显式 CSP（BUG-010 修复）。若某资源被阻断，DevTools Console 会打印 `Refused to load ... because it violates the following Content Security Policy directive`。当前策略：

```
default-src 'self';
img-src 'self' asset: https://asset.localhost data:;
style-src 'self' 'unsafe-inline';
script-src 'self';
connect-src 'self' https://api.openai.com ipc: http://ipc.localhost;
font-src 'self' data:;
frame-src 'none';
object-src 'none';
```

排查思路：
1. 确认资源来源是否在白名单内（如 `asset:` 用于精灵图，`https://api.openai.com` 用于 OpenAI 调用）。
2. 精灵图必须通过 `asset://localhost/pet/{id}/spritesheet.webp` 加载，不应使用 `file://` 或外部 URL。
3. 修改 CSP 后需重启 `tauri:dev` 生效。

### 5.5 前端 Mock 模式

`pnpm dev`（纯前端，无 Tauri）时，`src/src-tauri/api.ts` 的 `isTauri()` 返回 `false`，所有 `invoke` 调用自动降级到 `mock.ts` 的挡板数据。这允许在没有 Rust 后端的情况下独立调试 UI。Mock 数据集中在 `src/src-tauri/mock.ts`，按命令名分派。

### 5.6 Tauri 事件监听调试

`src/src-tauri/api.ts` 的 `initListeners()` 注册了 `recorder-state-changed`、`segment-captured`、`distill-completed`、`privacy-triggered`、`report-ready` 等事件。在 DevTools Console 可手动触发排查：

```js
// 检查是否处于 Tauri 环境
window.__TAURI_INTERNALS__
```

---

## 6. 常见问题 (FAQ)

### Q1: `cargo build` 报错 `core::stats_engine` not found？

**A**：这是一个已知的预存问题。`src-tauri/src/ipc/commands.rs` 中部分命令使用了**裸模块路径**（bare module path）调用引擎，例如：

```rust
// commands.rs 中的问题写法（会被解析为外部 core crate）
core::stats_engine::get_daily_stats(&conn, &date)
core::capture::get_recorder_state(&app)
core::distill::get_today_summary(&app, &date).await
core::report::generate_report(&app, &date, &template_type).await
core::embedding::vector_search(&app, &query).await?
```

由于 Rust 的 `core` 是标准库外部 crate 名，`core::stats_engine` 会被编译器解析为外部 `core` crate 的子模块（不存在），而非本 crate 的 `crate::core::stats_engine`，导致 `error[E0433]: failed to resolve: could not find stats_engine in core`。

**受影响的模块**：`stats_engine`、`capture`、`distill`、`report`、`embedding`。

**对照**：文件顶部已经为**新引擎**正确导入了 `crate::core::xxx`：

```rust
// commands.rs 顶部已有的正确导入（task_engine / pet_engine / focus_engine 等可用）
use crate::core::analytics_engine;
use crate::core::focus_engine;
use crate::core::pet_engine;
use crate::core::soundscape_engine;
use crate::core::task_engine;
```

因此 `analytics_engine::calculate_streak(&conn)` 这类调用可正常编译，而 `core::stats_engine::get_daily_stats` 会失败。

**临时修复 / 新增命令的写法**：在 `commands.rs` 顶部补充对应导入，并将裸路径改为带前缀的调用：

```rust
// 在文件顶部追加：
use crate::core::stats_engine;
use crate::core::capture;
use crate::core::distill;
use crate::core::report;
use crate::core::embedding;

// 调用处改为：
stats_engine::get_daily_stats(&conn, &date)
capture::get_recorder_state(&app)
// ...以此类推
```

> 该问题在 `analysis_results.md` 中未被单独列为 Bug（属于预存编译问题），但在 `cargo build` / `cargo test` / `cargo check` 时会整体阻断编译。各引擎模块自身的单元测试已编写完成，待此问题修复后即可整体运行。**新增 Tauri 命令时一律使用 `use crate::core::xxx;` 导入，禁止裸 `core::xxx` 写法。**

### Q2: `src/src-tauri/` 看起来像重复的后端骨架，该删掉吗？

**A**：**不要删除**。`workmemory-app/src/src-tauri/` 是**前端 Tauri API 封装层**，不是重复的 Rust 后端骨架。

该目录仅包含两个 TypeScript 文件：

- **`api.ts`** — 统一 IPC 封装。通过 `isTauri()` 运行时判断环境：
  - Tauri 桌面环境 → 调用 `@tauri-apps/api/core` 的 `invoke` 与 `@tauri-apps/api/event` 的 `listen`，与 Rust 后端通信；
  - Web/dev 环境 → 降级到 `mock.ts` 的 Mock 挡板。
  - 业务层（store / 组件）只需 `import { api } from '@/src-tauri/api'`，无需感知运行环境。
- **`mock.ts`** — 开发期 Mock 挡板。按命令名（snake_case，与 `lib.rs` 注册的 Tauri command 一致）返回可用 mock 数据，让前端可以脱离 Rust 后端独立调试 UI。

> 📌 **关于 BUG-011**：`analysis_results.md` 中的 BUG-011 曾将 `src/src-tauri/` 标记为"重复的 Tauri 骨架代码目录（含独立 Cargo.toml/lib.rs/tauri.conf.json），建议删除"。经核实，该目录实际只含 `api.ts` 与 `mock.ts`，是 v3 设计中**有意为之的前端封装模式**（参见 `07_ROADMAP.md` §5）。本 Spec（`implement-v3-design-compliance`）已确认保留并在此说明其用途，**不删除**。这是设计模式，不是 Bug。

### Q3: 开发期宠物精灵图加载不出来？

**A**：精灵图原始资源位于 `/workspace/pet/{1..9}/spritesheet.webp`（共 9 套，每套含 `pet.json` 帧定义）。

加载约定（见 `src/components/PetSpriteDisplay.tsx`）：

- **Tauri 环境**：`asset://localhost/pet/{id}/spritesheet.webp`（受 `tauri.conf.json` 的 `assetProtocol.scope: ["$RESOURCE/pet/**"]` 与 `bundle.resources: ["resources/pet/*"]` 控制）。
- **非 Tauri 环境（`pnpm dev`）**：尝试 `/pet/{id}/spritesheet.webp`，dev server 下通常不存在。

**`PetSpriteDisplay` 内置 emoji 降级**：组件在挂载时用 `new Image()` 探测精灵图可加载性；探测失败或非 Tauri 环境时，自动按 `mood` 渲染对应 emoji（`🤩/😊/😐/😢/😠/😴`），避免出现空白方框。因此开发期看到 emoji 是**预期行为**，并非 Bug。

要让 dev 期也显示精灵图，可将 `pet/{id}/spritesheet.webp` 复制到 `workmemory-app/public/pet/{id}/` 下（目前 `public/pet/` 仅含 `README.md`）。

### Q4: 测试报错找不到 `__TAURI_INTERNALS__`？

**A**：`src/test/setup.ts` 中已全局 mock 了 `window.__TAURI_INTERNALS__`：

```ts
// src/test/setup.ts
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: { invoke: vi.fn() },
  writable: true,
});
```

Vitest 配置（`vitest.config.ts`）通过 `setupFiles: ['./src/test/setup.ts']` 在每个测试前注入该 mock，使 `isTauri()` 在 jsdom 环境下返回 `true`，`api.ts` 的 `invoke` 走真实 `@tauri-apps/api/core` 路径（其内部读取 `__TAURI_INTERNALS__`）。

**请勿删除该 mock**，否则所有依赖 `@tauri-apps/api` 的组件/store 测试会因 `__TAURI_INTERNALS__ is undefined` 而失败。如需断言具体命令调用，在测试内覆盖 `vi.mocked(...)`。

### Q5: 修改了 Rust 代码但 `tauri:dev` 没生效？

**A**：`tauri:dev` 会监听 Rust 源码变更并自动重新编译重启。若未触发：
1. 确认修改的是 `src-tauri/src/` 下的文件（非 `target/`）。
2. 检查终端是否有编译错误（如 Q1 的裸模块路径问题会阻断重编译）。
3. 手动重启：`Ctrl+C` 后重新 `pnpm tauri:dev`。

---

## 7. 贡献流程

### 7.1 分支策略

- `main`：稳定分支，始终保持可构建状态。
- 功能分支命名：`feat/<简短描述>`、`fix/<bug 编号>`、`docs/<主题>`。
- 示例：`feat/task-drag-sort`、`fix/bug-012-xp-formula`、`docs/dev-guide`。

### 7.2 提交信息规范（中文 Conventional Commits）

采用 Conventional Commits 风格，正文可中英混排（标题用中文，代码标识符保留英文）：

```
<type>(<scope>): <简短描述>

<可选正文，说明动机/影响>
```

`type` 取值：

| type | 用途 |
|------|------|
| `feat` | 新功能（对应某个 SubTask） |
| `fix` | Bug 修复（建议带 BUG-XXX 编号） |
| `refactor` | 重构（无行为变化） |
| `test` | 新增/修改测试 |
| `docs` | 文档变更 |
| `style` | 格式/样式（不改逻辑） |
| `chore` | 构建/工具/依赖 |
| `perf` | 性能优化 |

示例：

```
feat(task): 实现 TaskEngine 单向状态机 + FTS5 搜索 (Task 3)

- 新增 core/task_engine.rs，后端生成 uuid v4
- 注册 save_task/get_all_tasks/search_tasks 等命令
- 覆盖状态机流转 + UUID 唯一性单测（7 个）
```

```
fix(pet): 修正 XP 升级公式为 level*100+(level-1)*50 (BUG-012)
```

### 7.3 提交前检查清单

推送前请确保本地通过：

```bash
cd workmemory-app
pnpm typecheck              # TS 类型检查必须通过
pnpm test                   # 前端测试必须通过
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
# cargo test 受 Q1 裸模块路径问题阻塞；新增引擎单测请确保其所在模块可独立编译
```

> 新增/修改 `core/*.rs` 引擎时，务必同步补充 `#[cfg(test)] mod tests` 单元测试（目标 ≥80% 行覆盖，见 `11_TESTING_STRATEGY.md`）。
> 新增/修改前端组件或 store 时，务必同步补充 `src/**/__tests__/*.test.{ts,tsx}` 测试。

### 7.4 关联设计文档

- 任何架构层面的变更应同步更新 `01_ARCHITECTURAL_DECISIONS.md` / `03_CORE_ARCHITECTURE.md`。
- 数据模型变更同步更新 `02_DATA_MODEL.md`。
- UI/交互变更同步更新 `04_UI_SPEC.md` / `05_INTERACTION.md`。
- 用户可见的行为变更在 `CHANGELOG.md` 的 `Unreleased` 或对应版本段落追加条目。

---

## 附录：相关文档索引

| 文档 | 用途 |
|------|------|
| `00_PRODUCT_VISION.md` | 产品愿景 |
| `01_ARCHITECTURAL_DECISIONS.md` | 架构决策（含依赖锁定） |
| `02_DATA_MODEL.md` | 数据模型（8 张表 DDL） |
| `03_CORE_ARCHITECTURE.md` | 核心架构（8 引擎模块） |
| `04_UI_SPEC.md` | UI 规格（5-Tab 导航 + 13 组件） |
| `05_INTERACTION.md` | 交互状态机 |
| `06_DESIGN_GOVERNANCE.md` | 设计治理（设计系统/i18n/a11y） |
| `07_ROADMAP.md` | 路线图（含前端 IPC 封装约定 §5） |
| `08_AI_PROMPTS.md` | AI 提示词 |
| `09_PRODUCT_ACCEPTANCE_LEDGER.md` | 验收账本 |
| `10_DEVELOPMENT_GUIDE.md` | 本文档 |
| `11_TESTING_STRATEGY.md` | 测试策略 |
| `CHANGELOG.md` | 变更日志 |
| `analysis_results.md` | 审计报告（驱动 v3 全量实施） |
