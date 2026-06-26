# WorkMemory 09: 产品验收标准与可测试用例账本 (Product Acceptance Ledger)

> **文档定位**：定义系统所有模块的功能与体验验收标准、测试边界，并提供可由 QA 或 AI Testing Agent 直接执行的“可测试用例账本”。任何代码或功能合并至 Production 分支前，必须通过本账本内所有 P0 用例测试。

---

## 1. 核心体验指标 (Core UX Metrics)

为确保“颜值优先、交互顺滑、打扰极低”，开发完成后必须测量并满足以下性能与体验红线：

| 核心指标 | 验收标准 (Acceptance Criteria) | 测量手段 | 优先级 |
|---|---|---|---|
| **后台轮询开销** | 5s 一次的 Window Watcher 轮询及 Capture 行为，CPU 瞬时占用 **< 2%**。 | Windows 任务管理器 / Process Explorer | P0 |
| **WinRT OCR 延迟** | 单张 1080p 窗口截图，本地 OCR 识别到清洗存入 segments 时间 **< 150ms**。 | 后端 console 性能日志 | P0 |
| **Mascot 内存占用** | Mascot 窗口单独运行，内存占用 **< 20MB**。 | 任务管理器 | P1 |
| **打字流式响应** | 报告生成时，Markdown 富文本渲染流式打字输出延迟（First Token Latency） **< 1 秒**。 | 报告视图性能打点 | P0 |
| **全局检索响应时间** | 100,000 条 OCR 记录下，FTS5 匹配检索出 top-20 结果响应时间 **< 30ms**。 | SQLite Query Profiler | P1 |
| **无边框吸附平滑度** | Mascot 窗口边缘拖拽及松开吸附磁贴，必须保持 **60fps**，无卡顿闪烁。 | 渲染帧率监控 | P1 |

---

## 2. 核心功能验收测试用例 (Core Functional Test Cases)

### 2.1 P0：屏幕捕获与隐私守卫测试 (Capture & Privacy Guard)
*   **用例 1: 隐私黑名单拦截验证**
    *   **前置条件**：系统正处于 `Recording` 状态，`privacy_rules` 默认规则生效（如包含 `chrome-extension://`）。
    *   **动作**：
        1.  用户打开 Chrome 浏览器并进入任意密码扩展界面（其 URL 包含 `chrome-extension://`）。
        2.  观察 Mascot 表现。
    *   **预期输出**：
        -  Mascot 自动“拉帘/闭眼”，托盘变为紫色锁定图标。
        -  数据库中 `segments` 新增一行，`is_private = 1`, `ocr_status = 'skipped'`, `screenshot_path = ''`。
        -  主窗口 Timeline 对应节点显示 `🔒 已保护隐私窗口`，不包含任何截图与 OCR 文本。

*   **用例 2: 静止/空闲防抖机制**
    *   **前置条件**：系统处于 `Recording` 状态。
    *   **动作**：
        1.  用户离开电脑，保持键盘、鼠标 3分钟 无任何操作。
    *   **预期输出**：
        -  Tauri 后端发布 `AppEvent::IdleDetected`。
        -  系统状态切换为 `Idle`，Mascot 闭眼进入睡眠打呼动画（Zzz）。
        -  在此期间，系统**完全停止**轮询截图，不增加任何新的 `segments`。
        -  一旦用户晃动鼠标，系统立即无感恢复 `Recording`，Mascot 醒来。

---

### 2.2 P0：小时级蒸馏与降级测试 (Hour-Bucket Distillation)
*   **用例 3: 蒸馏幂等与防漏执行**
    *   **前置条件**：时间到达 `15:00`，上一小时 `14:00 - 15:00` 包含有效 segments。
    *   **动作**：
        1.  等待 `distill_manager` 后台任务触发。
        2.  观察 `distill_runs` 与 `clean_episodes` 表。
    *   **预期输出**：
        -  `distill_runs` 表插入一行：`hour_bucket = '14:00'`, `status = 'running'`。
        -  执行成功后，`status` 变为 `'done'`。
        -  `clean_episodes` 写入蒸馏聚合后的 1-3 条 Episode。
        -  若此时用户重启应用，系统在启动时扫描 `distill_runs`。因 `14:00` 已为 `'done'`，**绝对不准重复执行**该小时段的蒸馏大模型请求。

*   **用例 4: 无 AI 降级模式验证**
    *   **前置条件**：清空 settings 中的 `openai_api_key`，或拔掉网线使其处于离线状态。
    *   **动作**：
        1.  等待或手动触发蒸馏任务。
    *   **预期输出**：
        -  系统静默降级为“本地聚类算法”，**绝不抛出 API 错误弹窗**。
        -  `clean_episodes` 按照“App邻近度物理聚类”生成合并条目。
        -  进入 ReportsView 点击生成日报，系统免请求 LLM，瞬间根据降级 Bullet 模板，拼接并高精度排版导出今日工作线索流。

---

### 2.3 P0：日报富文本一键复制测试 (Daily Report UX)
*   **用例 5: 飞书/钉钉样式兼容性复制**
    *   **前置条件**：ReportsView 已成功生成一份包含一级标题、二级标题、加粗、无序列表、行内代码的工作报告。
    *   **动作**：
        1.  点击“复制富文本 (Copy Rich Text)”按钮。
        2.  打开飞书文档、或钉钉聊天输入框，按 `Ctrl+V` 进行粘贴。
    *   **预期输出**：
        -  剪贴板同时写入 `text/html` 和 `text/plain` 双格式负载。
        -  在飞书/钉钉中粘贴后，**必须完美保持**标题字号级差、加粗效果、Bullet 点符号、行内代码背景框样式，无任何乱码、样式溢出或 lost Formatting。

---

### 2.4 P1：FTS5 全文极速检索测试 (Full-Text Search)
*   **用例 6: OCR 关键词毫秒高亮反查**
    *   **前置条件**：数据库已录入包含文本 `"确认了退款异常枚举"` 的 segment。
    *   **动作**：
        1.  在主界面顶部搜索框输入 `"退款异常"` 并回车。
    *   **预期输出**：
        -  搜索结果瞬间展示。
        -  “原始文字匹配 (OCR Snippets)”栏精准展示该行，且“退款异常”四个字被高亮包裹：`...确认了==退款异常==枚举...`（高亮样式为浅黄色背景，`border-radius: 2px`）。
        -  双击此结果，右侧 Context 面板直接反查出其所属的原始 Segment 详情、截图缩略图。

---

### 2.5 P2：Wiki 智能双链沉淀测试 (Wiki & Double-Link)
*   **用例 7: [[wikilink]] 动态跳转与 Review Queue 验证**
    *   **前置条件**：AI 提炼出一个 `wiki_eligible = 1` 且 `wiki_status = 'eligible'` 的 Episode。
    *   **动作**：
        1.  进入 WikiView。
        2.  点击顶部 Review Queue 的建议条目，点击“一键接受”。
        3.  在新打开的 Wiki 编辑器中，手写 `[[退款接口说明]]`。
    *   **预期输出**：
        -  点击接受后，系统自动将 Episode 沉淀至 `wiki_pages`，状态置为 `draft`，并清空 Review Queue 中的红点提示。
        -  在编辑器中，手写的双括号内文字 `退款接口说明` 必须自动变为主色调（蓝色）加粗字体。
        -  若 `退款接口说明` 页面不存在，点击该链接自动创建以此为标题的新 Wiki 页面；若已存在，直接实现内页无缝跳转。
