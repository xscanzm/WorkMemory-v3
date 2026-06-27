# 11 测试策略 (Testing Strategy)

> 本文档定义 WorkMemory-v3 的测试体系：测试金字塔、Rust 单元测试规范、Vitest 前端测试规范、Playwright E2E 规划、覆盖率目标、CI 集成与测试反模式。
> 配套操作命令见 `10_DEVELOPMENT_GUIDE.md` §4。本次全量实施的变更清单见 `CHANGELOG.md`。

---

## 目录

1. [测试金字塔](#1-测试金字塔)
2. [Rust 单元测试规范](#2-rust-单元测试规范)
3. [Vitest 前端测试规范](#3-vitest-前端测试规范)
4. [Playwright E2E 规范（计划中）](#4-playwright-e2e-规范计划中)
5. [覆盖率目标](#5-覆盖率目标)
6. [CI 集成](#6-ci-集成)
7. [测试反模式](#7-测试反模式)

---

## 1. 测试金字塔

WorkMemory-v3 采用经典测试金字塔，自底向上分为三层：

```
            ┌─────────────────────┐
            │   E2E (Playwright)  │   ← 关键用户流程（计划中，Task 21.3）
            │   少量、慢、高信心   │
            └─────────────────────┘
          ┌───────────────────────────┐
          │  集成测试 (Tauri 命令级)   │   ← Rust 命令 + DB 联动
          │  中等数量、中等速度        │
          └───────────────────────────┘
        ┌─────────────────────────────────┐
        │  单元测试 (Rust #[test] + Vitest)│   ← 纯函数 / 组件 / store
        │  大量、快、定位精准             │
        └─────────────────────────────────┘
```

| 层级 | 工具 | 位置 | 当前状态 |
|------|------|------|---------|
| 单元测试（Rust） | `cargo test` | `src-tauri/src/core/*.rs` 内联 `#[cfg(test)] mod tests` | ✅ 已建（34 个，5 引擎文件） |
| 单元测试（前端） | Vitest 3.x + React Testing Library | `src/**/__tests__/*.test.{ts,tsx}` | ✅ 已建（23 个，3 文件） |
| 集成测试 | Rust（DB + 命令） | `src-tauri/src/db/repository_tests.rs` + 引擎内 in-memory DB | ⚠️ 部分（引擎内联测试已含 in-memory DB 联动） |
| E2E | Playwright | `e2e/*.spec.ts` | ⏳ 计划中（Task 21.3，未实现） |

**原则**：能写单元测试就不写集成测试，能写集成测试就不写 E2E。E2E 仅覆盖最关键的端到端用户流程，作为最终信心保障。

---

## 2. Rust 单元测试规范

### 2.1 位置与组织

- 所有 Rust 单元测试**内联**在对应源文件底部，使用 `#[cfg(test)] mod tests { ... }` 隔离，不单独建 `tests/` 集成目录（除少数需要跨模块的场景）。
- 引擎模块测试位于 `src-tauri/src/core/<engine>.rs`，DB 层测试位于 `src-tauri/src/db/repository_tests.rs`。
- 测试不编译进 release 产物（`#[cfg(test)]` 保证零运行时开销）。

### 2.2 命名约定

- 测试函数名采用 `行为_条件` 或 `行为_条件_预期` 的 snake_case 描述，让失败信息自带语义。
- 好的命名：`calculate_streak_three_consecutive_days`、`on_task_completed_upserts_and_increments`、`productivity_score_caps_at_hundred`。
- 避免无意义命名：`test1`、`test_streak`、`it_works`。

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// 辅助：构造内存数据库（WAL 不适用内存库，用普通 in-memory）
    fn in_memory_db() -> Connection {
        Connection::open_in_memory().expect("无法打开内存数据库")
    }

    #[test]
    fn calculate_streak_empty_db_returns_zero() {
        let conn = in_memory_db();
        let streak = calculate_streak(&conn).unwrap();
        assert_eq!(streak, 0);
    }

    #[test]
    fn calculate_streak_three_consecutive_days() {
        // ... 插入 3 天 completed 任务
        let streak = calculate_streak(&conn).unwrap();
        assert_eq!(streak, 3);
    }
}
```

### 2.3 断言与覆盖要求

- 优先使用 `assert_eq!(actual, expected)`（失败信息更清晰），布尔判断用 `assert!`。
- **每个公开函数至少覆盖三类场景**：
  1. **正常路径（happy path）**：典型输入返回预期结果。
  2. **边界条件（edge cases）**：空输入、零值、最大值、空数据库等。
  3. **错误路径（error cases）**：非法输入返回 `AppError` 的对应变体（如 `NotFoundError`/`ValidationError`）。
- 涉及状态机的（如 Task 状态流转、Pet mood），覆盖所有合法转换 + 至少一个非法转换被拒绝。
- DB 相关测试使用 `Connection::open_in_memory()`，每个测试独立建表，互不污染。

### 2.4 当前覆盖现状

v3 已在以下引擎文件编写单元测试，共 **34 个**：

| 文件 | 测试数 | 覆盖要点 |
|------|--------|---------|
| `core/task_engine.rs` | 7 | CRUD + 单向状态机流转（inbox→todo→in_progress→completed→archived）+ archived 不可转换 + FTS5 搜索 + uuid v4 唯一性 |
| `core/pet_engine.rs` | 8 | XP 公式 `level*100+(level-1)*50` + 升级 + mood 映射 + 属性 clamp + 衍生计算 + 衰减 |
| `core/focus_engine.rs` | 3 | pomodoro/free 模式 + FocusSession 持久化 + 中断处理 |
| `core/analytics_engine.rs` | 11 | streak 计算（连续/中断/空库）+ weekly stats + productivity_score（封顶/部分/零）+ daily_stats upsert + on_task/on_focus 事件 |
| `core/soundscape_engine.rs` | 5 | 音频包加载 + 多层混合 + enable/disable 切换 |
| **合计** | **34** | |

> ⚠️ **执行说明**：受 `commands.rs` 裸模块路径问题影响（见 `10_DEVELOPMENT_GUIDE.md` §6 Q1），`cargo test` 当前整体编译失败。各引擎模块自身的测试代码已就绪，待该问题修复后即可运行。也可通过 `cargo test --manifest-path src-tauri/Cargo.toml <engine_name>` 单独验证（前提是整体能编译）。

### 2.5 目标

- `core/` 模块**行覆盖率 ≥ 80%**。
- 每个公开函数至少有 1 个测试；状态机/公式类逻辑 100% 覆盖分支。
- 新增引擎必须随实现同步提交单元测试，否则不予合入。

---

## 3. Vitest 前端测试规范

### 3.1 配置

- 配置文件：`workmemory-app/vitest.config.ts`。
  - `environment: 'jsdom'` — 模拟浏览器 DOM。
  - `globals: true` — `describe`/`it`/`expect` 全局可用，无需逐文件 import（仍可显式 import 以获得类型提示）。
  - `setupFiles: ['./src/test/setup.ts']` — 全局 setup。
  - `css: false` — 不处理 CSS（加速）。
  - `resolve.alias`：`@` → `./src`，与 `vite.config.ts` 一致。
- 依赖：`vitest@^3.2.6`、`@testing-library/react@^16.3.2`、`@testing-library/user-event@^14.6.1`、`@testing-library/jest-dom@^6.9.1`、`jsdom@^29.1.1`。

### 3.2 位置与命名

- 测试文件与被测代码**就近放置**，位于同目录的 `__tests__/` 子目录：`src/**/__tests__/*.test.{ts,tsx}`。
- 文件名：`<被测模块名>.test.ts(x)`，如 `toastStore.test.ts`、`SourceBadge.test.tsx`。
- 测试结构：
  ```ts
  describe('ComponentName', () => {
    it('does X when Y', () => { ... });
    it('renders fallback when prop is empty', () => { ... });
  });
  ```
- `describe` 块以**被测组件/store 名称**命名；`it` 描述**用户视角的行为**（"渲染 VS Code 并映射为 💻"），而非实现细节（"调用 mapIcon 函数"）。

### 3.3 Tauri 环境 Mock

前端通过 `src/src-tauri/api.ts` 封装调用 Tauri（见 `10_DEVELOPMENT_GUIDE.md` §6 Q2、Q4）。测试中**绝不在 IPC 层做真实调用**，统一通过 `src/test/setup.ts` 的全局 mock 处理：

```ts
// src/test/setup.ts
import '@testing-library/jest-dom';
import { vi } from 'vitest';

Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: { invoke: vi.fn() },
  writable: true,
});
```

- 该 mock 使 `isTauri()` 返回 `true`，`@tauri-apps/api/core` 的 `invoke` 走 mock 实现。
- **请勿删除该 setup**，否则所有依赖 Tauri API 的测试崩溃。
- 如需断言具体命令调用或返回值，在测试内用 `vi.mock('@/src-tauri/api', ...)` 或 `vi.mocked(...)` 覆盖，**不要**在 setup 中硬编码业务数据。

### 3.4 交互测试规范

- **优先使用 `user-event` 而非 `fireEvent`**：`userEvent.click()` 模拟真实浏览器事件序列（focus → pointer → click），更接近用户行为。
- 查询优先级：`getByRole` > `getByLabelText` > `getByText` > `getByTestId`。避免依赖实现细节（如 className、第 N 个子元素）。
- 异步用 `await screen.findBy...` 或 `waitFor`，避免 `act()` 包裹（除非 React 明确警告）。
- 断言用 `@testing-library/jest-dom` 扩展：`toBeInTheDocument()`、`toBeVisible()`、`toHaveAttribute()` 等。

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SourceBadge from '../SourceBadge';

describe('SourceBadge', () => {
  it('渲染 VS Code 并映射为 💻', () => {
    render(<SourceBadge appName="VS Code" />);
    expect(screen.getByText('💻')).toBeInTheDocument();
  });

  it('空 appName 显示已保护占位', () => {
    const { container } = render(<SourceBadge appName="" />);
    expect(screen.getByText('已保护')).toBeInTheDocument();
    const span = container.querySelector('span[title]');
    expect(span?.getAttribute('title')).toBe('已保护');
  });
});
```

### 3.5 当前覆盖现状

v3 已在以下文件编写前端测试，共 **23 个**：

| 文件 | 测试数 | 覆盖要点 |
|------|--------|---------|
| `src/store/__tests__/toastStore.test.ts` | 4 | showToast/dismissToast + 自动消失 + 类型着色 |
| `src/store/__tests__/focusStore.test.ts` | 11 | 计时器控制 + pomodoro/free 模式 + 中断 + 状态流转 |
| `src/components/__tests__/SourceBadge.test.tsx` | 8 | 应用名→emoji 映射 + 默认图标 + "已保护"占位 + 显式 icon 优先 |
| **合计** | **23** | |

### 3.6 目标

- `src/store/` 全部 store 的 **action 覆盖率 ≥ 70%**（每个 action 至少 1 个测试）。
- `src/components/` 所有组件的**渲染路径覆盖**（含降级/空态/错误态）≥ 70%。
- 新增 store action 或组件渲染分支，必须同步补测。

---

## 4. Playwright E2E 规范（计划中）

> 📌 **状态：计划中，尚未实现。** 对应 `tasks.md` SubTask 21.3（未完成）。本节为未来实施的规范预留，待 Task 21.3 启动时按此执行。

### 4.1 目标与范围

E2E 测试仅覆盖**最关键的端到端用户流程**，验证从 UI 操作 → Tauri 命令 → DB 持久化 → 状态回显的完整链路。不追求高覆盖率，追求关键路径的信心。

### 4.2 位置与命名

- 测试目录：`workmemory-app/e2e/`。
- 文件名：`<流程名>.spec.ts`，如 `task-crud.spec.ts`、`focus-session.spec.ts`、`pet-interaction.spec.ts`。
- 配置文件：`workmemory-app/playwright.config.ts`（待创建）。

### 4.3 关键流程用例

1. **任务全链路**：创建任务 → 列表显示 → 状态流转（inbox→todo→in_progress→completed）→ 删除（ConfirmDialog 确认）→ 列表移除 → 重启后状态持久。
2. **专注全链路**：进入 FocusView → 选择 pomodoro 模式 → 启动计时 → 完成会话 → 验证 FocusSession 落库 → 宠物 +20 XP/+10 energy → daily_stats 累计。
3. **宠物交互全链路**：进入 PetView → 喂食 → hunger 增加 → 持久化到 pet_state → mood 更新 → 衍生计算触发。
4. **streak 验证**：完成今日任务 → StreakCalendar 高亮今日 → 连续天数 +1。

### 4.4 运行方式

```bash
# 安装（首次）
pnpm add -D @playwright/test
pnpm exec playwright install

# 运行
pnpm exec playwright test

# 带 UI 面板
pnpm exec playwright test --ui
```

### 4.5 注意事项

- E2E 需要真实的 Tauri 运行时，**不能**在纯 `pnpm dev`（mock 模式）下跑，需通过 `pnpm tauri:dev` 启动完整应用。
- 每个 spec 前清理 `workmemory.db`（或使用独立测试 profile），避免数据污染。
- 超时与重试策略在 `playwright.config.ts` 中统一配置。

---

## 5. 覆盖率目标

| 范围 | 工具 | 目标 | 命令 |
|------|------|------|------|
| Rust `src-tauri/src/core/` | `cargo-tarpaulin` | 行覆盖率 ≥ 80% | `cargo tarpaulin --manifest-path src-tauri/Cargo.toml --packages workmemory-app --out Html` |
| 前端 `src/store/` | Vitest v8 coverage | 行/分支覆盖率 ≥ 70% | `pnpm test:coverage` |
| 前端 `src/components/` | Vitest v8 coverage | 行覆盖率 ≥ 70% | `pnpm test:coverage` |

### 5.1 Rust 覆盖率（cargo-tarpaulin）

```bash
# 安装
cargo install cargo-tarpaulin

# 运行（生成 HTML 报告到 tarpaulin-report.html）
cargo tarpaulin --manifest-path workmemory-app/src-tauri/Cargo.toml \
  --packages workmemory-app \
  --out Html \
  --output-dir coverage/rust
```

> 当前受 `commands.rs` 裸模块路径问题阻塞，tarpaulin 同样无法整体运行；待修复后纳入 CI。

### 5.2 前端覆盖率（Vitest v8）

`pnpm test:coverage` 使用 Vitest 内置 v8 coverage。建议在 `vitest.config.ts` 补充 `coverage` 配置（阈值）：

```ts
// vitest.config.ts（建议补充）
test: {
  environment: 'jsdom',
  globals: true,
  setupFiles: ['./src/test/setup.ts'],
  css: false,
  coverage: {
    provider: 'v8',
    reporter: ['text', 'html'],
    include: ['src/store/**', 'src/components/**'],
    thresholds: {
      lines: 70,
      branches: 70,
    },
  },
},
```

> 阈值配置为建议性，未强制写入当前 `vitest.config.ts`；待覆盖率达标的目录再启用 `thresholds` 硬卡。

---

## 6. CI 集成

> 📌 **状态：计划中。** SubTask 21.4 已完成 `package.json` 的测试脚本（`test`/`test:watch`/`test:ui`/`test:coverage`），但 GitHub Actions 工作流尚未创建。本节为规划方案。

### 6.1 计划工作流

拟新增 `.github/workflows/ci.yml`，在每次 push / PR 触发：

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  frontend:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: workmemory-app/pnpm-lock.yaml
      - name: Install deps
        run: pnpm install --frozen-lockfile
        working-directory: workmemory-app
      - name: Typecheck
        run: pnpm typecheck
        working-directory: workmemory-app
      - name: Test
        run: pnpm test
        working-directory: workmemory-app

  rust:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: Install Linux deps
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt update
          sudo apt install -y libwebkit2gtk-4.1-dev libssl-dev libxdo-dev \
            libayatana-appindicator3-dev librsvg2-dev
      - name: Cargo test
        run: cargo test --manifest-path workmemory-app/src-tauri/Cargo.toml
        # 注：受 commands.rs 裸模块路径问题阻塞，CI 暂允许失败，待修复后改为必须通过
        continue-on-error: true
      - name: Cargo clippy
        run: cargo clippy --manifest-path workmemory-app/src-tauri/Cargo.toml -- -D warnings
        continue-on-error: true
```

### 6.2 矩阵策略

- **OS 矩阵**：`ubuntu-latest` + `windows-latest`（macOS 因 runner 成本可选）。
- Linux 需安装 `libwebkit2gtk-4.1-dev` 等 Tauri 系统依赖。
- Rust `cargo test` 当前因裸模块路径问题允许失败（`continue-on-error: true`），待修复后移除该豁免并设为必须通过。

### 6.3 未来增强

- 接入 `cargo-tarpaulin` 上传 Rust 覆盖率到 Codecov / Coveralls。
- 前端覆盖率上传（`pnpm test:coverage` 产出 lcov）。
- Playwright E2E 纳入 nightly 作业（需 Tauri 运行时，常规 CI runner 较重）。

---

## 7. 测试反模式

以下做法应避免：

### 7.1 测试实现细节

❌ **反例**：断言组件内部状态、私有方法调用、className、子元素位置。
```ts
// 反例：依赖实现细节，重构即坏
expect(wrapper.state('isLoading')).toBe(true);
expect(container.children[0].children[1].textContent).toBe('标题');
```
✅ **正例**：从用户视角断言可见输出。
```ts
expect(await screen.findByText('标题')).toBeInTheDocument();
expect(screen.getByRole('button', { name: /保存/ })).toBeDisabled();
```

### 7.2 滥用 `act()`

❌ 在每个异步操作外手动包 `act()`，往往掩盖了真正的状态更新时机问题。
✅ 优先用 `await screen.findBy...` / `waitFor`，让 Testing Library 处理 act 边界。仅在 React 显式警告时才用 `act()`。

### 7.3 用 `fireEvent` 代替 `userEvent`

❌ `fireEvent.click(el)` 只触发单一合成事件，跳过 focus/blur 等，与真实用户行为不符。
✅ `await userEvent.click(el)`（`userEvent` 已在 `devDependencies` 中）。

### 7.4 直接测试 Tauri IPC

❌ 在测试中真实调用 `@tauri-apps/api/core` 的 `invoke` 并期望 Rust 后端响应（jsdom 无 Tauri 运行时，必然失败）。
✅ 在 `@tauri-apps/api` 封装层（即 `src/src-tauri/api.ts`）做 mock。`src/test/setup.ts` 已 mock `window.__TAURI_INTERNALS__`；需要具体返回值时用 `vi.mock('@/src-tauri/api', () => ({...}))` 替换业务 API 函数。**永远不要在单元测试中跨进程验证 IPC，那是集成/E2E 的职责。**

### 7.5 测试间状态共享

❌ 一个测试修改全局/store 状态后影响下一个测试。
✅ 每个测试独立 render / 重置 store（Zustand 可在 `beforeEach` 调用 `useStore.setState(initialState)`）；Rust 测试用独立 `open_in_memory()` 连接。

### 7.6 为覆盖率而写的无意义测试

❌ 仅为凑覆盖率写 `expect(true).toBe(true)` 或重复断言同一分支。
✅ 每个测试应验证一个明确的行为契约；覆盖率是结果而非目标。

### 7.7 E2E 滥用

❌ 用 E2E 验证纯函数计算（如 XP 公式），慢且脆弱。
✅ XP 公式用 Rust 单元测试覆盖；E2E 只验证"完成专注后宠物 XP 增加"这类端到端流程。

---

## 附录：测试命令速查

| 操作 | 命令 |
|------|------|
| 前端单次测试 | `pnpm test` |
| 前端监听测试 | `pnpm test:watch` |
| 前端 UI 面板 | `pnpm test:ui` |
| 前端覆盖率 | `pnpm test:coverage` |
| Rust 全部测试 | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Rust 单引擎测试 | `cargo test --manifest-path src-tauri/Cargo.toml pet_engine` |
| Rust 覆盖率 | `cargo tarpaulin --manifest-path src-tauri/Cargo.toml --out Html` |
| Playwright E2E（计划） | `pnpm exec playwright test` |

> 命令均在 `workmemory-app/` 目录下执行。Rust 测试当前受 `commands.rs` 裸模块路径问题阻塞，详见 `10_DEVELOPMENT_GUIDE.md` §6 Q1。
