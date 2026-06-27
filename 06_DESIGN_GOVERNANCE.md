# WorkMemory 06: 设计治理、颜值优先与体验债务规范 (Design Governance)

> **文档定位**：项目级硬约束。WorkMemory 明确将“好看、有质感”视为第一生产力，视觉与交互质量不为任何功能仓促上线让路。开发与 AI Coding Agent 在交付任意功能时，必须对照本规范进行视觉和体验自检。

---

## 1. 核心视觉决策：好看作为第一生产力

由于 WorkMemory 是一款 **24 小时桌面常驻** 工具，用户的长期信任首先来源于界面的“体面感”与“分寸感”。
*   如果界面粗糙、布局凌乱、类似监控后台，用户会产生强烈的隐私焦虑并快速卸载。
*   好看、精致、带有一点点温暖细节的 UI 能够大幅降低学习成本，提升用户复看、整理与沉淀记忆的意愿。

因此，所有页面、弹窗、气泡、桌面伙伴状态，默认遵守以下设计优先级：
1.  **安全可控**（本地存储、显性隐私指示）
2.  **视觉好看**（精致、克制、毛玻璃、精细边框）
3.  **交互顺滑**（流畅动效、无明显卡顿、局部加载）
4.  **功能完整**（严格的分期交付）

任何功能如果“能用但不好看”，默认不算完成，不得合入主分支。

---

## 2. “四个必须做”与“四个绝不准”

### 2.1 自定义无边框窗口 (Custom Titlebar)
*   **必须做**：
    *   必须使用 Tauri 的 `decorations: false` 隐藏系统默认窗口标题栏。
    *   在前端自研双层 Header：左侧为无缝拖拽区（`-webkit-app-region: drag`，按钮区排除 drag 属性），右侧为精致的原生 Windows 11 风格控制按钮（最小化、最大化、关闭）。
    *   窗口必须带有一像素的内描边（`border: 1px solid var(--color-border)`）与轻柔的投影（`box-shadow: var(--shadow-card)`），确保在暗色/杂乱桌面上依然清晰、高级。
*   **绝不准**：
    *   绝对不准直接暴露系统默认网页滚动条。必须使用 `@radix-ui/react-scroll-area` 封装自定义超细、半透明、自动隐藏的滚动条。
    *   绝对不准在窗口拖拽时产生闪烁或白色背景暴露（必须设置 HTML/Body 背景色与 `--color-bg-base` 一致）。

### 2.2 统一设计系统与 Token 治理
*   **必须做**：
    *   所有字号、颜色、圆角、间距必须严格调用 `04_UI_SPEC.md` 中定义的 CSS 变量。
    *   中英文混排时，中文字体与英文字体必须使用 Native Fluent 风格排版，行高统一为 `1.5` 至 `1.6`。
*   **绝不准**：
    *   绝对不准在页面/组件样式中临时手写 Hardcode 颜色代码（如 `#111` 或 `rgb(0,0,0)`）。
    *   不同组件的卡片圆角绝对不准割裂。统一使用 `--radius-md (8px)`，大型 Modal 统一使用 `--radius-lg (12px)`。

### 2.3 Fluent 材质感与克制动效
*   **必须做**：
    *   对侧边栏（Sidebar）和悬浮弹窗（Popover/Tooltip）启用毛玻璃类：`backdrop-filter: var(--blur-acrylic)`，并使用 `--color-surface-glass` 调配 75% 半透明白背景，营造轻盈的材质感。
    *   必须为以下微交互设计精致动效（使用原生 CSS Transition，配合 `cubic-bezier(0.16, 1, 0.3, 1)` 缓动曲线，时间控制在 150-250ms 内）：
        *   Mascot 形象切换状态（Fade 渐变）。
        *   Episode 卡片展开/折叠（Height 展开且 `overflow: hidden`）。
        *   一句话总结卡切换编辑状态（Scale 弹性微动效）。
*   **绝不准**：
    *   绝对不准使用过大、过慢、高频闪烁、晃眼的动效。
    *   动效绝对不准阻塞用户的连续操作。所有动效在低端 CPU 上必须能够跑满 60fps。

---

## 3. 体验债务 (UX Debt) 零容忍定义

开发与 AI Coding Agent 交付的代码中，如果包含以下任何一项，将被视为**体验债务 Bug**，其修复优先级等同于崩溃性 P0 Bug：

1.  **文本溢出与截断**：长窗口标题或长 OCR 文本在卡片、按钮或列表项中粗糙截断、重叠，或产生难看的横向滚动条。
2.  **空状态不尴尬**：没有任何一条数据时，页面呈现一片惨白或只有一句话“暂无数据”。空状态必须提供温暖的插图、合理的引导文案与明显的下一步动作。
3.  **Loading 像临时拼凑**：使用粗糙的 `Loading...` 纯文本，或者页面大范围白屏。必须使用局部精细的骨架屏（Skeleton Wave）或 Mascot 扫描小动画。
4.  **无状态反馈**：按钮点击后没有任何 `Active` 缩进反馈，或者网络请求发送时按钮没有禁用（Disabled）且不展示 Spinner。
5.  **生成结果无法复制**：AI 生成的日报、周报或 Wiki 页面，无法一键复制为富文本（带格式）或 Markdown，必须让用户手动选区。
6.  **隐私边界模糊**：命中隐私保护时，没有明显的视觉锁和紫色保护条，导致用户产生“是否依然在被监控”的安全焦虑。

---

## 4. 视觉验收“3秒法则” (The 3-Second Rule)

任何主页面或新功能进入预发布验收阶段，必须能通过以下“3秒截图检查”：
1.  **打开页面前3秒**：
    *   一眼就能看出当前页面的核心任务（如：今日总结、报告生成、设置）。
    *   一眼就能看清当前的系统捕获状态（正在记录 / 隐私保护 / 暂停）。
2.  **截出一张好看的产品图**：
    *   随便对今日页、日历页、报告页或 Wiki 页截一张图，都必须具有极致的单色主义美感和极高像素精细度（Pixel-Perfect），能直接用于 App Store 或官网宣发。

---

## v3 设计系统与质量规范 (2026-06)

> 本节补全 WorkMemory-v3 的设计系统升级、i18n 架构、无障碍 WCAG 2.1 AA 合规与统一错误处理策略。所有规范均已落地为可编译/可渲染代码，源真见 `/workspace/workmemory-app/src/styles/`、`/workspace/workmemory-app/src/i18n/`、`/workspace/workmemory-app/src-tauri/src/core/error.rs`。

### 1. 设计系统升级（Inter + JetBrains Mono + Spring + Glassmorphism）

*   **字体**：`variables.css` 定义 `--font-sans: "Inter", "PingFang SC", "Microsoft YaHei", ...`、`--font-mono: "JetBrains Mono", "SF Mono", "Cascadia Code", ...`。`index.css` 对 `code/pre/.mono` 应用等宽字体。**离线优先**：不引入 Google Fonts `@import`（被 CSP `style-src 'self' 'unsafe-inline'` / `font-src 'self' data:` 禁止），优先用系统已安装版本，未安装回退到 PingFang SC / SF Mono；如需打包 woff2 放入 `public/fonts/`。
*   **Spring 弹性动画**：`--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`（弹性出场）、`--ease-spring-soft: cubic-bezier(0.25, 0.46, 0.45, 0.94)`（柔和弹性）、`--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`。时长档位 `--duration-instant: 80ms` / `--duration-fast: 150ms` / `--duration-base: 200ms` / `--duration-normal: 250ms` / `--duration-slow: 250ms` / `--duration-spring: 320ms` / `--duration-bounce: 400ms`。`index.css` 提供 `.animate-spring` / `.animate-spring-in` / `.spring-in` / `.bounce-in` / `.animate-slide-up` / `.animate-fade-in` 工具类。
*   **Glassmorphism 毛玻璃**：`--blur-acrylic: blur(20px)`、`--blur-glass-strong: blur(40px) saturate(180%)`、`--blur-glass-subtle: blur(8px)`。`index.css` 提供 `.glass-panel` / `.glass-panel-strong` / `.glass-panel-subtle` / `.glass` 工具类，配合 `--color-surface-glass: rgba(255,255,255,0.75)`。Sidebar、Popover、Tooltip、Toast、Modal 遮罩均强制启用毛玻璃。
*   **强调色补齐**：在原蓝紫基调上新增 `--color-accent: #8B5CF6`（与 privacy 系列协调）、`--color-secondary: #06B6D4`（青色二级）、`--color-on-primary: #FFFFFF`、Canvas / 滚动条 / 高亮 mark 等专用 token，禁止在组件内 Hardcode 颜色。

### 2. i18n 架构（轻量 React Context + localStorage，禁用 i18next）

*   **方案**：`/workspace/workmemory-app/src/i18n/index.tsx` 使用 `createContext` + `useState` + `useCallback`，**零外部依赖**（不引入 `i18next` / `react-i18next`）。`I18nProvider` 包裹根组件，`useI18n()` 暴露 `{ locale, t, setLocale }`。
*   **语言包**：`zh-CN.ts` / `en-US.ts` 导出 `TranslationMap`（`Record<string, string>`），`LOCALE_MAP` 注册两种 `Locale`。
*   **持久化**：写入 `localStorage['workmemory.locale']`，启动时读取并校验在 `LOCALE_MAP` 内，默认 `zh-CN`。
*   **占位符插值**：`t(key, params)` 支持 `{name}` 占位符，用 `RegExp` 全局替换；查找失败回退到 key 本身（不抛错）。
*   **切换入口**：`SettingsView` 语言分区调用 `setLocale`，即时生效无需刷新。

### 3. 无障碍 WCAG 2.1 AA 合规

*   **prefers-reduced-motion**：`index.css` `@media (prefers-reduced-motion: reduce)` 对 `*` 强制 `animation-duration: 0.01ms !important`、`animation-iteration-count: 1 !important`、`transition-duration: 0.01ms !important`、`scroll-behavior: auto !important`，尊重用户系统级动效偏好。
*   **:focus-visible**：全局 `:focus-visible` 提供 `outline: 2px solid var(--color-primary)` + `outline-offset: 2px` + `border-radius: var(--radius-sm)`；圆角元素额外 `box-shadow: 0 0 0 2px bg-base, 0 0 0 4px primary` 保证 outline 不被裁剪；鼠标点击（`:focus:not(:focus-visible)`）不显示 outline，仅键盘 Tab 导航时显示。
*   **aria-label 覆盖**：纯图标按钮必须带 `aria-label`（如 `FAB` 的 `aria-label="新建任务"`、Sidebar `<nav aria-label="主导航">`）；图标导航项经 Radix Tooltip 提供文本。新增组件交付时同步核查 aria-label。
*   **触摸目标 ≥ 44×44px**：Sidebar 导航项 48×48px、FAB / TaskCard 操作按钮均满足 WCAG 2.1 AA 最小触摸目标要求。

### 4. 错误处理策略（AppError → Toast 反馈）

*   **后端**：`core/error.rs` 定义 `AppError` 枚举（`DbError / IoError / NotFoundError / ValidationError / Internal`），`#[serde(tag="kind", content="message")]` 序列化为 `{kind, message}`。所有 Tauri 命令返回 `Result<T, AppError>`（替代裸 `Result<T, String>`，修复 BUG-013）。实现 `From<rusqlite::Error> / From<std::io::Error> / From<serde_json::Error>` 自动转换，并提供 `internal() / validation() / not_found()` 构造助手与 `AppResult<T>` 别名。
*   **前端策略**：
    1.  **所有用户可见操作**通过 `Toast`（`createPortal` 渲染、毛玻璃 + 左侧 4px 语义色边框、3 秒自动消失、`×` 手动关闭，类型 `success / error / info`）反馈成败。原 15+ 处 `console.error` catch 块已改造接入 `toastStore`。
    2.  **渲染期异常**由 `ErrorBoundary`（React class 组件）捕获，展示降级 UI + 重试按钮，包裹整个 `MainLayout`，避免白屏。
    3.  **破坏性操作**（删除任务 / 归档）走 `ConfirmDialog` 二次确认，`danger=true` 时确认按钮变红。
*   **错误分级映射**：前端按 `AppError.kind` 差异化处理——`NotFoundError` 显示空态、`ValidationError` 高亮字段并 toast、`DbError / IoError / Internal` 走通用 error toast。
