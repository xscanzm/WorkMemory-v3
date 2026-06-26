# WorkMemory 08: AI 提示词、蒸馏 Prompt 与视觉探索库 (AI Prompts & Distill Templates)

> **文档定位**：定义系统内置的所有大模型 Prompt 模板（包括整点蒸馏、日报生成）及用于 UI 界面视觉探索的 Midjourney/DALL-E 3 生图提示词。AI Coding Agent 必须将本文档 Section 1-2 中的 Prompt 模板硬编码入 Rust 蒸馏核心与前端生成逻辑，确保大模型输出高质量、强约束的结构化数据。

> ⚠️ **关于桌面伙伴资产**：
> 桌面伙伴（Mascot）的全部动画资源**已经制作完毕**，存放于 `pet/{1..9}/spritesheet.webp`，共 9 套形象，每套 9 种动画状态。
> **AI Coding Agent 禁止**使用本文档 Section 3 的生图提示词重新生成伙伴资产；Section 3 仅作为将来新增自定义形象时的参考提示词存档。
> 伙伴渲染规范请严格遵循 `04_UI_SPEC.md` 第 5 节。

---

## 1. 后端：整点 AI 蒸馏 Prompt 模板 (Hour-bucket Distill Template)

这是整点（HH:00）触发的 `distill_manager` 调用。该 Prompt 采用极其严苛的 JSON Schema 强制约束（JSON Mode），避免大模型胡言乱语或输出非 JSON 字符。

```rust
pub fn build_distill_prompt(date: &str, hour_bucket: &str, ocr_records: &str) -> String {
    format!(
        r#"你是一个高精度的个人工作记忆整理专家。
下面是用户在 {date} {hour_bucket} 这个小时内，在电脑屏幕上被自动记录的原始 OCR 文本与窗口标题流。

【原始记录数据】
{ocr_records}

【处理任务】
请对上述碎片信息进行"智能降噪"、"去重"与"语义聚合"，将其聚合成 1-3 个有实际工作价值的 Episode（逻辑事件）。

【严格约束（核心红线）】
1. 必须完全过滤掉社交聊天摸鱼、系统弹窗、无意义的空白窗口和纯噪音。
2. 每一个 Episode 必须有理有据，其 evidence_refs 必须关联到产生该事件的物理 segment_id。
3. 必须输出严格 of JSON 格式，不包含任何 Markdown 代码块包裹（如 ```json），第一个字符必须是 {{，最后一个字符必须是 }}。

【输出 JSON Schema 约束】
{{
  "episodes": [
    {{
      "startTime": "HH:MM:SS",
      "endTime": "HH:MM:SS",
      "title": "简练、人类可理解的事件标题，例如：'调试订单退款接口'",
      "summary": "1-2句精炼的内容摘要，说明在这个事件中具体做了什么、得出了什么结论",
      "memoryKind": "work", // 选项: work, life, study, social, play, rest
      "project": "项目或模块名称，无则留空",
      "entities": ["提取出的人名、文档、系统名、链接、关键词"],
      "topics": ["主题标签，如：'Debug', '需求确认'"],
      "materials": ["使用的背景材料或参考文档名"],
      "outputs": ["产出物，如代码文件路径、文档草稿、确认的结论"],
      "todos": ["分析出来的、未来需要跟进的待办事项"],
      "blockers": ["遇到的阻塞点、未解决的问题"],
      "segmentIds": ["关联的 segments 物理 ID 数组"],
      "evidenceRefs": ["用于佐证该事件的关键 OCR 片段/句子 (3条以内)"],
      "sourceQuality": "high", // high, medium, low
      "confidence": 0.95, // 0.0 到 1.0 的置信度
      "wikiEligible": true, // 是否有复用价值、建议沉淀进 Wiki 知识库
      "memoryCell": {{
        "episodeText": "第三人称客观叙事总结，1-2句。例如：'用户在 VS Code 中调试了退款接口的 Go 代码，并确认了状态枚举值。'",
        "facts": ["提炼出的硬核事实 1", "事实 2"],
        "foresight": [
          {{
            "statement": "预判跟进事项，如：'明天需要同前端联调退款状态返回'",
            "validFrom": "YYYY-MM-DD",
            "validTo": "YYYY-MM-DD",
            "confidence": 0.9
          }}
        ]
      }}
    }}
  ]
}}
"#,
        date = date,
        hour_bucket = hour_bucket,
        ocr_records = ocr_records
    )
}
```

---

## 2. 后端：日报/周报 AI 生成 Prompt 模板 (Report Generation Template)

这是用户在前端 `ReportsView` 点击一键生成日报时，系统发送给大模型的 Prompt。支持 4 种模板格式。

```rust
pub fn build_report_prompt(template: &str, date: &str, episodes_json: &str) -> String {
    let format_instruction = match template {
        "concise" => "【极简 Bullet 模板】用最干净、无废话的 Bullet Points 罗列今日主要事项、持续时长、产出。不分章节。",
        "okr" => "【OKR 目标框架模板】按今日推进的'目标 (Objective)' -> '关键结果 (Key Results)'组织。将零散事件归入具体目标下。",
        "structured" => "【标准分栏模板】分三大板块罗列：1. 今日已完成 (Done)；2. 进行中与明日计划 (WIP & Plan)；3. 问题与阻塞点 (Blockers)。",
        _ => "【高级叙述模板】用优美、专业、富有商业洞察的文字，将琐碎事件串联成逻辑严密、结构清晰的今日手记。包含'核心进展'、'协作事实'、'待确认事项'三章。"
    };

    format!(
        r#"你是一个顶级商业文秘和日报提炼专家。
下面是用户在 {date} 这天，由 WorkMemory 自动捕获并整理出的聚合逻辑事件（Episodes）。

【逻辑事件数据】
{episodes_json}

【生成任务】
请将这些逻辑事件，重写提炼为一份排版优美、格式清晰、可直接汇报的 Markdown 格式工作报告。

【样式与格式约束】
1. 严格遵循以下模板要求：
{format_instruction}
2. 报告标题统一为：`# WorkMemory 今日工作复盘 ({date})`。
3. 文本中禁止出现任何大模型常用的机械性套话（如"今天用户非常忙碌"、"综上所述"等）。一律使用第一人称"我"或客观的职业化表达。
4. Markdown 文本必须排版精美，合理使用粗体、行内代码、引用块提升易读性。
5. 必须保持事实的百分之百准确性，严禁编造原始数据中没有的路径、文件名、项目或人物。
"#,
        date = date,
        episodes_json = episodes_json,
        format_instruction = format_instruction
    )
}
```

---

## 3. 桌面伙伴未来扩展：自定义形象生图提示词存档

> ⚠️ **本节仅供将来新增自定义伙伴形象时参考**。
> 当前 9 套现有形象（Boba / Doubao / Nyanko v2 / Bolt / Doraemon / Mochi / Sabo / EVE / Boxcat）
> 已有完整物理资产，**禁止使用以下提示词重新生成已有形象**。

若将来需要扩展第 10 套及以上的新形象，新形象的 Spritesheet 必须符合以下物理规格，否则无法被现有渲染器驱动：

```
单帧：192 × 208 px
行数：9 行（Row 0=idle / 1=walk / 2=run / 3=sleep / 4=sit / 5=jump / 6=fall / 7=drag / 8=special）
帧数：按各行规格（6/8/8/4/5/8/6/6/6）横向排列
背景：完全透明（alpha channel）
格式：WebP（推荐）或 PNG
```

### 3.1 全局视觉风格参考提示词 (Global Style Reference)

```
Concept sheet for a premium Windows desktop companion mascot.
Professional cognitive assistant style, not childish, not a cartoon villain.
3D clay-like matte render, soft neutral shadows, transparent background, isolated.
Clean geometry, highly aesthetic, minimalist, premium productivity product visual.
Must support 9-row animation spritesheet layout:
Row 0: idle breathing (6 frames),
Row 3: sleeping Zzz (4 frames),
Row 4: sitting still (5 frames),
Row 5: jumping celebrate (8 frames),
Row 7: being dragged (6 frames),
Row 8: privacy curtain/closed eyes (6 frames).
8k resolution, white studio background --ar 16:9 --style raw --v 6.0
```

### 3.2 状态帧参考提示词

*   **Row 0 `idle`（正在记录）**：
    ```
    [Character], standing gently, subtle breathing aura, attentive and calm,
    minimalist 3D clay render, transparent background, studio lighting --v 6.0
    ```

*   **Row 3 `sleep`（空闲打瞌睡）**：
    ```
    [Character], curled up slightly, sleeping peacefully with tiny "Zzz" floating near,
    cozy and low key, minimalist 3D clay render, transparent background --v 6.0
    ```

*   **Row 4 `sit`（暂停）**：
    ```
    [Character], sitting quietly with arms folded, calm and still,
    minimalist 3D clay render, transparent background --v 6.0
    ```

*   **Row 5 `jump`（日报就绪欢庆）**：
    ```
    [Character], jumping with joy, arms raised, celebratory pose,
    minimalist 3D clay render, transparent background --v 6.0
    ```

*   **Row 7 `drag`（被拖拽）**：
    ```
    [Character], being lifted and carried, slightly surprised expression,
    minimalist 3D clay render, transparent background --v 6.0
    ```

*   **Row 8 `special`（隐私保护）**：
    ```
    [Character], pulling a tiny soft-purple curtain over itself, or closing eyes gently
    with a mini padlock icon nearby, highly reassuring privacy feeling,
    minimalist 3D clay render, transparent background --v 6.0
    ```

---

## 4. 前端：主窗口 UI 视觉探索提示词 (MJ Prompts)

用于前端设计师或 AI 探索视觉灵感、固化 CSS tokens。

### 4.1 主窗口总览 (Main Window Explorer)
```
A premium Windows 11 desktop app UI screenshot of "WorkMemory", local-first personal work
memory system. Clean three-column layout, left slim icon-only sidebar in translucent acrylic,
main workspace showing elegant timeline with vertical grey dotted line and crisp memory episode
cards, right context panel with raw OCR text and file paths. Modern native desktop UI,
ultra-clean white and soft grey background, fine single-pixel borders, subtle drop shadows,
cyan and violet accents, highly professional Chinese UI labels, pixel-perfect,
realistic productivity tool screenshot --ar 16:10 --style raw
```

### 4.2 今日页 Episode 卡片流 (TodayView Card Stream)
```
Premium Windows desktop app "WorkMemory" TodayView, vertical memory timeline with
clean dotted rail line, episode cards with timestamps "10:00-11:20", bold titles,
muted summaries, app icon chips at bottom, star importance toggle, frosted glass
summary bar at top showing today's one-liner, soft acrylic sidebar, Chinese UI,
ultra clean layout --ar 16:10 --style raw
```

### 4.3 日历复看页 (CalendarView)
```
Premium Windows desktop productivity app CalendarView, 7x6 month grid with
intensity bars in each cell, one-line daily summaries truncated with ellipsis,
green/teal gradient work intensity indicators, small checkmark badges on reported days,
right panel showing selected day's episode list and export button, soft background,
Chinese UI labels, pixel-perfect --ar 16:10 --style raw
```

### 4.4 全局搜索页 (SearchView)
```
Premium Windows desktop app search interface, large rounded search bar at top,
dual-column results: left "Episode Matches" with confidence cards, right "OCR Snippets"
with highlighted matched text in context, hit reason tags like "OCR匹配" "标签匹配",
clean white background, subtle shadows, cyan accent highlights, Chinese UI --ar 16:10
```
