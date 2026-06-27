# Tasks

## 一、CSP 安全策略加固

- [ ] Task 1: 配置 tauri.conf.json CSP 策略
  - [ ] SubTask 1.1: 将 `"csp": null` 改为显式 CSP 字符串，需覆盖以下指令：
    - `default-src 'self'` — 基线策略
    - `img-src 'self' asset: https://asset.localhost data:` — 允许 pet spritesheet（asset 协议）+ data URI
    - `style-src 'self' 'unsafe-inline'` — React 内联样式 + CSS 变量需要 unsafe-inline
    - `script-src 'self'` — 禁止外部脚本注入
    - `connect-src 'self' https://api.openai.com ipc: http://ipc.localhost` — 允许 OpenAI API + Tauri IPC
  - [ ] SubTask 1.2: 验证 CSP 生效后应用各功能正常（pet 加载、蒸馏/报告 API 调用、IPC 通信）
  - [ ] SubTask 1.3: 验证 DevTools Console 无 CSP 违规报错

## 二、前端错误反馈体系

- [ ] Task 2: 新建 Toast 通知组件与 Store
  - [ ] SubTask 2.1: 新建 `src/store/toastStore.ts`（Zustand）：`toasts: ToastItem[]`、`showToast(message, type)`、`dismissToast(id)`；ToastItem 含 `{id, message, type: 'success'|'error'|'info', createdAt}`
  - [ ] SubTask 2.2: 新建 `src/components/Toast.tsx`：Portal 渲染到 document.body；固定定位屏幕底部居中；按 type 着色（success 绿/error 红/info 蓝）；3 秒自动消失；支持手动 × 关闭
  - [ ] SubTask 2.3: 在 `App.tsx` 的 MainLayout 中渲染 `<ToastContainer />`（不在 mascot 路由渲染，避免透明窗口出现 Toast）

- [ ] Task 3: 新建 ErrorBoundary 组件
  - [ ] SubTask 3.1: 新建 `src/components/ErrorBoundary.tsx`：class 组件实现 `componentDidCatch`；降级 UI 含 Mascot sleep 姿态文案 + "出了点小问题，点击重试" 按钮 + 重置 state 回调
  - [ ] SubTask 3.2: 在 `App.tsx` 用 `<ErrorBoundary>` 包裹 `<MainLayout />`（不包裹 MascotWindow，避免 mascot 窗口崩溃影响主窗口）

- [ ] Task 4: 改造现有 catch 块接入 Toast
  - [ ] SubTask 4.1: `src/src-tauri/api.ts` 的 `refreshTodayEpisodes` catch 块：新增 `toastStore.getState().showToast('刷新今日数据失败', 'error')`，保留 console.error
  - [ ] SubTask 4.2: `src/components/TopBar.tsx` 的 setRecorderState catch 块（2 处）：新增 Toast 错误反馈
  - [ ] SubTask 4.3: `src/components/MascotWindow.tsx` 的关键 catch 块（navigateMain / daily wrap / mascot drag start / snapToNearestCorner / openMainWindow）：新增 Toast 错误反馈
  - [ ] SubTask 4.4: 对成功操作（如 generateReport / saveToWiki / updateEpisodeTitleSummary）在调用方添加 success Toast 反馈（在 ReportsView / WikiView / MemoryCard 调用处）

## 三、无障碍支持基础

- [ ] Task 5: 添加 aria-label 与角色语义
  - [ ] SubTask 5.1: `src/components/Titlebar.tsx`：最小化/最大化/关闭按钮添加 `aria-label="最小化"` / `"最大化"` / `"关闭窗口"`
  - [ ] SubTask 5.2: `src/components/Sidebar.tsx`：导航图标按钮添加 `aria-label`（今日/日历/搜索/洞察/Wiki/图谱/报告/设置）
  - [ ] SubTask 5.3: `src/components/TopBar.tsx`：录制状态切换按钮 + Ghost Capture 按钮添加 `aria-label`
  - [ ] SubTask 5.4: `src/components/MascotWindow.tsx`：mascot 交互按钮（如有）添加 `aria-label`

- [ ] Task 6: 添加 prefers-reduced-motion 与焦点样式
  - [ ] SubTask 6.1: `src/styles/index.css` 新增 `@media (prefers-reduced-motion: reduce)` 块：将所有 `transition` / `animation` 时长降为 `0.01ms`，`background-position` 动画降为静态
  - [ ] SubTask 6.2: `src/styles/index.css` 新增全局焦点可见样式：`:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }`
  - [ ] SubTask 6.3: `src/components/mascot/MascotSprite.tsx`：监听 `prefers-reduced-motion` 媒体查询，若为 reduce 则停止 setInterval 帧步进，仅显示首帧

# Task Dependencies
- Task 1 (CSP) 独立，可与 Task 2-6 并行
- Task 2 (Toast Store + 组件) 独立，可与 Task 1、Task 5、Task 6 并行
- Task 3 (ErrorBoundary) 独立，可与 Task 1、Task 2、Task 5、Task 6 并行
- Task 4 (catch 接入 Toast) 依赖 Task 2（需 toastStore 存在）
- Task 5 (aria-label) 独立，可与 Task 1、Task 2、Task 3、Task 6 并行
- Task 6 (reduced-motion + 焦点) 独立，可与 Task 1、Task 2、Task 3、Task 5 并行

# 可并行批次建议
- 批次 A（无依赖，并行）：Task 1、Task 2、Task 3、Task 5、Task 6
- 批次 B（依赖 A）：Task 4（依赖 Task 2 的 toastStore）
