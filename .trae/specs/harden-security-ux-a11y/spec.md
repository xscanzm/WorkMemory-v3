# 安全与质量加固 Spec（基于 analysis_results.md 审查对比）

## Why
`analysis_results.md` 对 WorkMemory-v3 项目的审查报告涵盖了 19 项 Bug/优化建议。经逐项对比当前沙箱工作区（工作记忆捕获应用，segments/clean_episodes 表 + MascotSprite/TodayView 组件），发现报告大部分内容描述的是另一个任务/宠物管理项目（tasks/pet_state/daily_stats 表），与当前代码库不匹配。但其中 **3 项跨切面质量问题确实适用于当前工作区**：CSP 安全策略被禁用、前端无错误反馈机制（ErrorBoundary/Toast）、无障碍支持缺失。本 Spec 负责修复这 3 项。

## 对比结论（analysis_results.md 逐项核验）

### 适用于当前工作区的项（本 Spec 范围）
| 报告编号 | 问题 | 当前状态 | 核验证据 |
|----------|------|----------|----------|
| BUG-010 / 优化 14 | CSP 安全策略被禁用 | `"csp": null` | tauri.conf.json:20 |
| BUG-013 / 优化 10 | 无 ErrorBoundary/Toast/Snackbar + Rust 错误全为 String | 0 匹配 ErrorBoundary/Toast/Snackbar；15+ 处 `Result<_, String>` | grep 全量扫描 |
| 优化 17 | 无障碍支持缺失（无 aria-label、无 prefers-reduced-motion） | 0 匹配 `aria-`/`role=`；0 匹配 `prefers-reduced-motion` | grep 全量扫描 |

### 不适用于当前工作区的项（已核验为 False 或 N/A）
| 报告编号 | 报告声称 | 核验结论 |
|----------|----------|----------|
| BUG-001~009 | tasks/pet_state/daily_stats 数据持久化断裂 | N/A：当前工作区无 tasks/pet_state/daily_stats 表，是 segments/clean_episodes 记忆捕获应用 |
| BUG-006 | Task/PetState 数据模型字段缺失 | N/A：数据模型完全不同 |
| BUG-007 | 宠物动画资源未被使用（用 emoji） | **False**：MascotSprite.tsx 已实现 spritesheet.webp 帧动画 |
| BUG-011 | src/src-tauri/ 含重复 Cargo.toml/lib.rs | **False**：src/src-tauri/ 仅含 api.ts/mock.ts（前端 Tauri API 封装） |
| BUG-012 | 宠物 XP 公式不一致 | N/A：当前宠物系统是 Mascot 状态机，非 XP 升级模型 |
| BUG-014 | Task ID 用 Date.now() | N/A：无 tasks 表 |
| 颜色系统偏差 | 应为 #0a0e27/#7c3aed，实际 #1a1a2e/#e94560 | **False**：variables.css 使用 #F4F6F9/#2563EB/#8B5CF6 浅色毛玻璃设计（遵循 04_UI_SPEC.md §1） |
| 字体偏差 | 应为 Inter + JetBrains Mono | **部分**：使用 PingFang SC/Microsoft YaHei（中文优先设计，有意为之） |
| 玻璃态效果缺失 | 无 backdrop-filter | **False**：index.css:60-61 已有 `backdrop-filter: var(--blur-acrylic)` |
| 优化 16 零测试 | 前后端均无测试 | **False**：有 repository_tests.rs、ocr.rs（14 测试）、capture.rs、distill.rs、url_util.rs（16 测试）、uia.rs 等丰富测试 |
| 缺失引擎 | FocusEngine/SoundscapeEngine/AIEngine 等缺失 | N/A：当前应用是工作记忆捕获，非任务/专注管理应用 |

## What Changes
- **CSP 加固**：在 `tauri.conf.json` 设置合理的 CSP 策略，允许 Tauri 内部协议、asset 协议（pet spritesheet）、OpenAI API 连接，禁止任意外部脚本/样式注入
- **前端错误反馈体系**：新增 `ErrorBoundary` 组件包裹主窗口路由；新增 `Toast` 通知组件（Zustand store + Portal 渲染）；改造现有 `catch` 块从 `console.error` 升级为 Toast 用户可见反馈
- **无障碍支持**：为图标按钮添加 `aria-label`；添加 `prefers-reduced-motion` 媒体查询降级动画；确保焦点可见样式

## Impact
- Affected code:
  - `src-tauri/tauri.conf.json`（CSP 配置）
  - `src/components/ErrorBoundary.tsx`（新建）
  - `src/components/Toast.tsx`（新建）
  - `src/store/toastStore.ts`（新建）
  - `src/App.tsx`（包裹 ErrorBoundary）
  - `src/styles/index.css`（prefers-reduced-motion + 焦点样式）
  - `src/components/Titlebar.tsx`、`Sidebar.tsx`、`TopBar.tsx`（aria-label）
  - 现有 catch 块（api.ts、TopBar.tsx、MascotWindow.tsx 等）接入 Toast

## ADDED Requirements

### Requirement: CSP 安全策略
系统 SHALL 在 `tauri.conf.json` 配置非空 CSP 策略，SHALL 允许 Tauri 内部协议（ipc/asset）、self 资源、OpenAI HTTPS 连接，SHALL 禁止任意外部脚本/样式/iframe 注入。

#### Scenario: CSP 生效后应用正常运作
- **WHEN** 应用启动并加载 pet spritesheet
- **THEN** `asset://localhost/pet/{id}/spritesheet.webp` 正常加载（img-src 允许 asset: 协议）
- **AND** 蒸馏/报告生成时 HTTPS 请求到 OpenAI API 不被阻断（connect-src 允许 https://api.openai.com）
- **AND** 浏览器 DevTools Console 无 CSP 违规报错

### Requirement: 前端错误反馈体系
系统 SHALL 提供 React ErrorBoundary 捕获渲染异常并展示友好降级 UI；SHALL 提供 Toast 通知组件在操作成功/失败时向用户可见反馈；SHALL 将现有 `console.error` catch 块升级为 Toast 反馈。

#### Scenario: 操作失败时用户可见反馈
- **WHEN** 用户触发手动捕获（Ghost Capture）而后端返回错误
- **THEN** Toast 组件在屏幕底部显示红色错误通知（含错误摘要），3 秒后自动消失
- **AND** Console 仍保留完整错误日志供调试

#### Scenario: 渲染异常降级
- **WHEN** 任意视图组件抛出未捕获渲染异常
- **THEN** ErrorBoundary 展示友好降级 UI（Mascot sleep 插图 + "出了点小问题" 文案 + 重试按钮）
- **AND** 不导致整个应用白屏崩溃

### Requirement: 无障碍支持基础
系统 SHALL 为所有图标按钮（无文字）添加 `aria-label`；SHALL 响应 `prefers-reduced-motion: reduce` 媒体查询降级或禁用动画；SHALL 确保键盘 Tab 导航时焦点可见。

#### Scenario: 减少动画偏好
- **WHEN** 用户系统开启"减少动画"辅助功能偏好
- **THEN** MascotSprite 帧动画降为静止首帧；CSS transition 动画时长降为 0ms
- **AND** 应用功能不受影响

#### Scenario: 屏幕阅读器可识别按钮
- **WHEN** 屏幕阅读器聚焦到 Titlebar 关闭按钮（仅含图标无文字）
- **THEN** 朗读 "关闭窗口"（aria-label 提供语义）

## MODIFIED Requirements

### Requirement: tauri.conf.json 安全配置
现有 `"csp": null` 修改为显式 CSP 策略字符串，覆盖 default-src / img-src / style-src / script-src / connect-src。
