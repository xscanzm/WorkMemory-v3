# 安全与质量加固 Spec（基于 analysis_results.md 审查对比）

## Why
`analysis_results.md` 对 WorkMemory-v3 项目的审查报告列出了 14 项 Bug 和 19 项优化建议。经逐项对比当前沙箱工作区（工作记忆捕获应用）的真实代码状态，发现报告**大部分内容描述的是另一个任务/宠物/专注管理项目**（tasks/pet_state/daily_stats 表、TaskForm/PetView 组件、番茄钟等），与当前代码库不匹配。但其中 **2 项 Bug 和 1 项优化建议确实适用于当前工作区**：CSP 安全策略被禁用、前端无错误反馈机制（ErrorBoundary/Toast）、无障碍支持中的 prefers-reduced-motion 与焦点可见样式缺失。

本 Spec 负责修复这 3 项，并明确说明哪些报告项经核验为 False 或 N/A（避免误改已正确实现的代码）。

## 对比结论（analysis_results.md 逐项核验）

### 适用于当前工作区（本 Spec 范围）

| 报告编号 | 问题 | 当前状态 | 核验证据 |
|----------|------|----------|----------|
| BUG-010 / 优化 14 | CSP 安全策略被禁用 | `"csp": null` | tauri.conf.json:20 |
| BUG-013 / 优化 10 | 无 ErrorBoundary/Toast/Snackbar；前端 catch 仅 console.error 静默吞错 | 0 匹配 ErrorBoundary/Toast/Snackbar；15+ 处 `console.error` 无用户反馈 | grep 全量扫描 TopBar/MascotWindow/api.ts/TodayView |
| 优化 17（部分） | 无障碍支持：`prefers-reduced-motion` 与焦点可见样式缺失 | aria-label 已有 30+ 处（Titlebar/Sidebar/TopBar/Calendar/Mascot 等）；但 0 匹配 `prefers-reduced-motion`；0 全局 `:focus-visible` 样式 | grep 全量扫描 |

### 核验为 False（已实现，无需改动）

| 报告编号 | 报告声称 | 核验结论 |
|----------|----------|----------|
| BUG-007 | 宠物动画用 emoji | **False**：MascotSprite.tsx 已实现 spritesheet.webp 帧动画 |
| BUG-011 | src/src-tauri/ 含重复 Cargo.toml/lib.rs | **False**：src/src-tauri/ 仅含 api.ts/mock.ts（前端 Tauri API 封装 + Mock 实现） |
| 颜色系统偏差 | 应为 #0a0e27/#7c3aed，实际 #1a1a2e/#e94560 | **False**：variables.css 使用 #F4F6F9/#2563EB/#8B5CF6 浅色毛玻璃设计（遵循 04_UI_SPEC.md §1） |
| 玻璃态效果缺失 | 无 backdrop-filter | **False**：index.css 已有 `backdrop-filter: var(--blur-acrylic)` |
| 优化 11 数据库优化 | 缺索引、未启用 WAL、无 FTS5 | **False**：connection.rs 已启用 WAL+foreign_keys+synchronous=NORMAL；migrations.rs 有 13 个索引 + 3 个 FTS5 虚拟表 |
| 优化 16 零测试 | 前后端均无测试 | **False**：repository_tests.rs、ocr.rs（14 测试）、capture.rs、distill.rs、url_util.rs（16 测试）、uia.rs 等丰富测试 |
| 优化 17（aria-label 部分） | 无 aria-label | **False**：30+ 处 aria-label 已覆盖 Titlebar/Sidebar/TopBar/Calendar/Mascot 等 |

### 核验为 N/A（描述的是另一个项目，不适用）

| 报告编号 | 报告内容 | N/A 原因 |
|----------|----------|----------|
| BUG-001~005 | 数据持久化断裂（tasks/pet_state/daily_stats） | 当前工作区是 segments/clean_episodes 记忆捕获应用，无 tasks/pet_state/daily_stats 表 |
| BUG-006 | Task/PetState 数据模型字段缺失 | 数据模型完全不同 |
| BUG-008 | 任务状态循环逻辑 | 无任务状态机 |
| BUG-009 | 删除任务无确认对话框 | 无任务删除功能 |
| BUG-012 | 宠物 XP 升级公式 | 当前宠物是 Mascot 状态机，非 XP 升级模型 |
| BUG-014 | Task ID 用 Date.now() | 当前用 uuid v4 |
| 优化 1-9 | 数据加载/持久化/UUID/确认框/动画/导航/仪表盘/番茄钟/设计系统 | 描述的功能模块不存在 |
| 优化 12-13 | 宠物状态衍生引擎/EventBus | 不在当前应用范围 |
| 优化 15 | 性能优化（虚拟滚动/Canvas/WebGL） | 当前数据量未达需要 |
| 优化 18-19 | i18n / 清理重复目录 | i18n 非紧急；无重复目录可清理 |
| 缺失引擎 | TaskEngine/FocusEngine/PetEngine/AnalyticsEngine/AIEngine/SoundscapeEngine/EventBus/BackgroundScheduler | 当前应用架构是 capture/distill/embedding/wiki/report，无对应关系 |

## What Changes
- **CSP 加固**（BUG-010 / 优化 14）：在 `tauri.conf.json` 设置合理的 CSP 策略，允许 Tauri 内部协议、asset 协议（pet spritesheet）、OpenAI API 连接，禁止任意外部脚本/样式注入
- **前端错误反馈体系**（BUG-013 / 优化 10）：新增 `ErrorBoundary` 组件包裹主窗口路由；新增 `Toast` 通知组件（Zustand store + Portal 渲染）；改造现有 15+ 处 `console.error` catch 块升级为 Toast 用户可见反馈
- **无障碍支持补齐**（优化 17 剩余部分）：新增 `prefers-reduced-motion` 媒体查询降级动画；新增全局 `:focus-visible` 焦点可见样式（aria-label 已存在 30+ 处，无需重复添加）

## Impact
- Affected code:
  - `src-tauri/tauri.conf.json`（CSP 配置）
  - `src/components/ErrorBoundary.tsx`（新建）
  - `src/components/Toast.tsx`（新建）
  - `src/store/toastStore.ts`（新建）
  - `src/App.tsx`（包裹 ErrorBoundary + 渲染 ToastContainer）
  - `src/styles/index.css`（prefers-reduced-motion + :focus-visible）
  - `src/components/TopBar.tsx`、`MascotWindow.tsx`、`views/TodayView.tsx`、`src/src-tauri/api.ts`（catch 块接入 Toast）

## ADDED Requirements

### Requirement: CSP 安全策略
系统 SHALL 在 `tauri.conf.json` 配置非空 CSP 策略，SHALL 允许 Tauri 内部协议（ipc/asset）、self 资源、OpenAI HTTPS 连接，SHALL 禁止任意外部脚本/样式/iframe 注入。

#### Scenario: CSP 生效后应用正常运作
- **WHEN** 应用启动并加载 pet spritesheet
- **THEN** `asset://localhost/pet/{id}/spritesheet.webp` 正常加载（img-src 允许 asset: 协议）
- **AND** 蒸馏/报告生成时 HTTPS 请求到 OpenAI API 不被阻断（connect-src 允许 https://api.openai.com）
- **AND** 浏览器 DevTools Console 无 CSP 违规报错

### Requirement: 前端错误反馈体系
系统 SHALL 提供 React ErrorBoundary 捕获渲染异常并展示友好降级 UI；SHALL 提供 Toast 通知组件在操作失败时向用户可见反馈；SHALL 将现有 `console.error` 静默吞错的 catch 块升级为 Toast 反馈。

#### Scenario: 操作失败时用户可见反馈
- **WHEN** 用户触发手动捕获（Ghost Capture）而后端返回错误
- **THEN** Toast 组件在屏幕底部显示红色错误通知（含错误摘要），3 秒后自动消失
- **AND** Console 仍保留完整错误日志供调试

#### Scenario: 渲染异常降级
- **WHEN** 任意视图组件抛出未捕获渲染异常
- **THEN** ErrorBoundary 展示友好降级 UI（Mascot sleep 姿态文案 + "出了点小问题" + 重试按钮）
- **AND** 不导致整个应用白屏崩溃

### Requirement: 无障碍支持补齐
系统 SHALL 响应 `prefers-reduced-motion: reduce` 媒体查询降级或禁用动画；SHALL 确保键盘 Tab 导航时焦点可见。

#### Scenario: 减少动画偏好
- **WHEN** 用户系统开启"减少动画"辅助功能偏好
- **THEN** CSS transition/animation 时长降为 0.01ms
- **AND** 应用功能不受影响

#### Scenario: 键盘焦点可见
- **WHEN** 用户使用 Tab 键在按钮/链接间导航
- **THEN** 当前焦点元素显示 2px 主色 outline + 2px offset
- **AND** 鼠标点击时不显示该 outline（仅键盘聚焦时显示）

## MODIFIED Requirements

### Requirement: tauri.conf.json 安全配置
现有 `"csp": null` 修改为显式 CSP 策略字符串，覆盖 default-src / img-src / style-src / script-src / connect-src。

### Requirement: 现有 catch 块错误反馈
`TopBar.tsx`、`MascotWindow.tsx`、`TodayView.tsx`、`api.ts` 中所有 `console.error` catch 块 SHALL 在保留 console 日志的同时调用 `toastStore.showToast(message, 'error')` 向用户可见反馈。
