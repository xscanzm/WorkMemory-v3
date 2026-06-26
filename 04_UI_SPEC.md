# WorkMemory 04: UI 设计规格与原生组件规范 (UI Spec & Design Tokens)

> **文档定位**：定义系统全局视觉、基础色板、字体、间距、圆角以及八大核心页面的高精度布局，以及桌面伙伴 Spritesheet 渲染规范。AI Coding Agent 在编写 CSS、构建 React 组件、微调样式时，必须以此作为唯一布局规范，严禁使用外部未定义风格。

---

## 1. 全局设计 Token (Design Tokens)

通过 CSS 自定义变量定义 in `src/styles/variables.css` 中。系统视觉基于 **毛玻璃质感 (Aero/Acrylic) + Linear 极简科技风格** 融合。

```css
:root {
  /* 1. 基础色板 (Neutral Palette) - 偏冷、安静色调 */
  --color-bg-base: #F4F6F9;          /* 全局底层背景 */
  --color-surface: #FFFFFF;          /* 顶层干净卡片 */
  --color-surface-subtle: #F9FAFB;   /* 浅灰色浅卡片 */
  --color-surface-glass: rgba(255, 255, 255, 0.75); /* 毛玻璃卡片 */
  --color-border: #E5E9F0;           /* 精细单色边框 */
  --color-border-hover: #D1D8E3;
  --color-text-main: #1E2330;        /* 正文字 */
  --color-text-muted: #6B7280;       /* 辅助置灰字 */
  --color-text-light: #9CA3AF;       /* 占位符/超轻字 */

  /* 2. 语义强调色 (Accent Palette) */
  --color-primary: #2563EB;          /* 经典深邃蓝 */
  --color-primary-soft: #EFF6FF;
  --color-success: #10B981;          /* 温暖松针绿 */
  --color-success-soft: #ECFDF5;
  --color-warning: #F59E0B;          /* 暖心琥珀黄 */
  --color-danger: #EF4444;           /* 克制警告红 */
  --color-private: #8B5CF6;          /* 隐私守护紫 */
  --color-private-soft: #F5F3FF;
  --color-memory: #0D9488;           /* 沉淀历史青 */

  /* 3. 精细圆角 (Border Radius) */
  --radius-sm: 4px;
  --radius-md: 8px;                  /* 标准卡片圆角 */
  --radius-lg: 12px;                 /* 弹窗/顶部组件大圆角 */
  --radius-round: 9999px;

  /* 4. 严谨间距 (Spacing Scale) */
  --space-2xs: 2px;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;

  /* 5. 优雅阴影与材质 (Shadows & Filter) */
  --shadow-subtle: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.02);
  --shadow-card: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.02);
  --shadow-overlay: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  --blur-acrylic: blur(20px);
}
```

---

## 2. 主窗口全局框架布局 (Main Layout Grid)

主窗口采用标准**三栏式桌面高效网格布局**，宽度 1280px，高度 720px。

```
┌────────────────────────────────────────────────────────────────────────┐
│ Top Bar: 状态指示 ｜ 💡 今日总结 ｜ 全局 FTS 检索 ｜ ⚙️ 快捷控制（暂停/隐私） │
├───────────────┬────────────────────────────────────────┬───────────────┤
│ Sidebar (72px)│ Main Workspace (860px)                 │ Context (348px)│
│               │                                        │               │
│  📅 今日 (P0)  │ ┌────────────────────────────────────┐ │ 📦 来源反查    │
│  🗓️ 日历 (P1)  │ │ 一句话总结卡 (SummaryBar)          │ │               │
│  🔍 搜索 (P1)  │ └────────────────────────────────────┘ │ 📑 OCR 原始块 │
│  💡 洞察 (P1)  │                                        │               │
│  📚 Wiki (P2)  │ ┌────────────────────────────────────┐ │ 📁 关联文件    │
│  🕸️ 图谱 (P2)  │ │ 时间线 Episode 卡片流 (MemoryCard) │ │               │
│  📄 报告 (P0)  │ │                                    │ │ 🛠️ 快捷归档    │
│  ⚙️ 设置 (P0)  │ └────────────────────────────────────┘ │               │
└───────────────┴────────────────────────────────────────┴───────────────┘
```

---

## 3. 核心页面高精度规范 (Hifi View Specifications)

### 3.1 页面 1: 今日 (TodayView) - P0 核心
*   **定位**：一天的核心记忆线，让碎片一目了然。
*   **顶部 SummaryBar**：
    *   **UI**：大圆角（`--radius-lg`）、毛玻璃背景卡片。
    *   **文字**：15px，加粗，主色调。展示今日主线提炼（如："*今日重点在于梳理订单退款接口，完成了字段枚举确认并起草了周报素材。*"）。
    *   **右侧按钮**：点击可直接进入内联编辑模式（Inline Markdown Input），允许用户手动修改，保存后展示"用户已改写"徽标，后端不再自动覆写。
*   **Episode Timeline**：
    *   **UI**：一条垂直的灰色虚线（`TimelineRail`）贯穿。每个 Episode 卡片（`MemoryCard`）贴靠其上。
    *   **MemoryCard 组件细节**：
        *   **左上角**：开始与结束时间戳（如 `10:00 - 11:20`），附带持续时长（`80min`）。
        *   **卡片标题**：15px 加粗，允许双击原地改写。
        *   **一句话摘要**：13px，`--color-text-muted`。
        *   **底栏 Chip 栏**：
            1.  应用类型徽标（App Icon + Name，例如：`📄 Edge`、`💻 VS Code`）。
            2.  项目标签（例如：`🏷️ 订单系统`）。
            3.  证据数（例如：`🔗 12 证据`）。
        *   **右上角交互区**：
            -  "重点关注"五角星切换（`is_important`）。
            -  "保存到 Wiki"一键归档按钮（P2）。
*   **空状态 (Empty State)**：
    *   **UI**：居中展示 Mascot `sleep` 动画帧（参见第 5 节），14px 灰字："*今天电脑还没有产生记忆。开始工作后，小记会在本地自动帮你整理工作线索。*"下方附带一个明显的恢复记录操作按钮。

### 3.2 页面 2: 报告中心 (ReportsView) - P0 核心
*   **定位**：日报、周报的一键生成与编辑中心。
*   **布局**：左侧为勾选事件列表（Episode Checklist），右侧为 Markdown 富文本实时编辑器。
*   **Episode Checklist**：
    *   展示今日所有 Episode，支持批量多选、一键反选。
    *   仅有勾选的 Episode 原始文本才会被打包送入 AI 生成日报。
*   **Markdown 编辑器**：
    *   预设 4 种模板选项：`高级叙述 (Enhanced)`、`极简 Bullet (Concise)`、`OKR 结构 (OKR)`、`标准分栏 (Structured)`。
    *   **顶栏操作条**：一键重新生成（Regenerate）、一键复制富文本（Copy Rich Text）、一键导出 Markdown 物理文件。

### 3.3 页面 3: 日历 (CalendarView) - P1 核心
*   **定位**：月历格记忆档案馆。
*   **UI**：标准 7×6 星期网格。
*   **单元格细节**：
    *   **顶部**：日期数字。
    *   **中部**：工作强度指示条（根据当天 `duration_seconds` 生成绿/青渐变微条）。
    *   **底部**：今日一句话总结缩写（最多一行，超出省略号）。
    *   **状态图标**：若已生成过日报，右上角显示灰色"✔"小徽章。
*   **右侧侧边栏**：点击任意网格，右侧 Context 面板静默刷新为当天的一句话 Summary、Episode 缩略列表和直接导出按钮。

### 3.4 页面 4: 全局检索 (SearchView) - P1 核心
*   **定位**：模糊搜索与全文精确查找。
*   **搜索框**：大圆角，支持 Command Center 式快捷键 `Ctrl+K` 弹出。
*   **结果呈现**：
    *   分栏展示：第一栏"最相关逻辑事件 (Episode Matches)"，展示高置信度卡片；第二栏"原始文字匹配 (OCR Snippets)"，展示匹配行的上下文片段（匹配字高亮展示，如 `...确认了==退款状态==字段...`）。
    *   每个结果卡片下方配有"命中原因"标签（如 `💡 OCR 匹配`、`🏷️ 标签匹配`）。

### 3.5 页面 5: Wiki 知识库 (WikiView) - P2 核心
*   **定位**：双链知识库编辑器。
*   **UI**：类似 Obsidian 风格，左侧为项目、人名、知识点目录树，中间为支持 `[[wikilink]]` 双链高亮的 Markdown 实时编辑面板，右侧为关联来源 (References) 与反向链接 (Backlinks)。
*   **Review Queue 悬浮条**：在顶部展示，红点提示"有 3 个由 AI 提炼的高价值 Episode 建议沉淀为 Wiki"，点击可一键接受并生成 Wiki 草稿。

---

## 4. UI 统一视觉反馈与状态规范 (Component States)

所有组件必须完整实现以下六种基础交互状态：

```
[Normal] ──► hover ──► [Hovered] ──► click ──► [Active/Selected]
                          │
                  (数据加载) ▼
                      [Loading] ──► 失败 ──► [Error]
```

1.  **加载状态 (Loading)**：局部微骨架屏（Skeleton Screen）淡入淡出，禁止使用全屏灰色遮罩阻断用户操作。
2.  **软删除状态 (Deleted/Archived)**：卡片降低透明度至 0.4，并提供一键"撤销（Undo）"撤回浮条，悬浮 8 秒后彻底入库保存。
3.  **隐私保护状态 (Private)**：
    *   卡片呈现柔和的紫色斜线条纹背景。
    *   标题强制替换为 `🔒 已保护隐私窗口 (WeChat)`，内容不可见。
    *   桌面伙伴切换至 `special` 动画（拉帘/闭眼状态，详见第 5 节）。

---

## 5. 桌面伙伴 Spritesheet 渲染规范 (Mascot Spritesheet Spec)

> **硬约束**：桌面伙伴动画资源**已全部就绪**，存放于项目目录 `pet/{1..9}/spritesheet.webp`。
> AI Coding Agent **禁止**使用 AI 生图工具重新生成资产，**必须**直接读取并渲染这些现有 `.webp` 文件。

### 5.1 可用伙伴资产清单

| ID | 目录 | 形象名 | 气质 |
|---|---|---|---|
| 1 | `pet/1/` | **Boba** | 奶茶杯，可爱日系 |
| 2 | `pet/2/` | **Doubao** | 豆包少女，温暖友好 |
| 3 | `pet/3/` | **Nyanko v2** | 猫咪，慵懒可爱 |
| 4 | `pet/4/` | **Bolt** | 机器人，简洁科技感 |
| 5 | `pet/5/` | **Doraemon** | 哆啦A梦，经典亲切 |
| 6 | `pet/6/` | **Mochi** | 猫咪，软萌治愈 |
| 7 | `pet/7/` | **Sabo** | 绅士，沉稳专业 |
| 8 | `pet/8/` | **EVE** | 机器人，未来感极简 |
| 9 | `pet/9/` | **Boxcat** | 盒子里的猫，俏皮 |

用户在 **设置 → 伙伴形象** 中选择，选择后写入 `settings.mascot_id`（1-9），前端读取对应目录的 `spritesheet.webp`。

**默认形象**：`mascot_id = 1`（Boba）。

### 5.2 Spritesheet 统一物理规格

所有 9 套伙伴共享**完全相同**的 Spritesheet 布局，无需针对单套做特殊处理：

```
单帧尺寸：  cellWidth = 192px，rowHeight = 208px
动画行数：  9 行（Row 0 ～ Row 8）
排列方式：  横向排列帧，每行帧数不同（见下表）
文件格式：  WebP（含透明通道，背景透明）
```

### 5.3 行状态映射表（全部 9 套伙伴一致）

| Row | 状态名 | 帧数 | 帧率 | 是否循环 | 对应系统状态 |
|---|---|---|---|---|---|
| 0 | `idle` | 6 | 8 fps | ✅ loop | `Recording` 正常记录中 |
| 1 | `walk` | 8 | 10 fps | ✅ loop | 拖拽移动过渡动画 |
| 2 | `run` | 8 | 12 fps | ✅ loop | 快速移动/贴边磁吸 |
| 3 | `sleep` | 4 | 4 fps | ✅ loop | `Idle` 无操作闲置 |
| 4 | `sit` | 5 | 6 fps | ✅ loop | `Paused` 已暂停 |
| 5 | `jump` | 8 | 12 fps | ❌ once | 日报就绪时一次性跳跃 |
| 6 | `fall` | 6 | 10 fps | ❌ once | 窗口拖放落地时过渡 |
| 7 | `drag` | 6 | 10 fps | ✅ loop | 用户按住拖拽伙伴中 |
| 8 | `special` | 6 | 8 fps | ✅ loop | `PrivacyMode` 隐私保护 |

### 5.4 前端 React 组件实现规范

组件文件路径：`src/components/mascot/MascotSprite.tsx`

#### 核心渲染逻辑（CSS background-position 步进）

```tsx
import React, { useEffect, useRef, useState } from 'react';

// Spritesheet 固定物理常量（勿改动）
const CELL_W = 192;
const CELL_H = 208;

const STATE_ROWS = {
  idle:    { row: 0, frames: 6,  fps: 8,  loop: true },
  walk:    { row: 1, frames: 8,  fps: 10, loop: true },
  run:     { row: 2, frames: 8,  fps: 12, loop: true },
  sleep:   { row: 3, frames: 4,  fps: 4,  loop: true },
  sit:     { row: 4, frames: 5,  fps: 6,  loop: true },
  jump:    { row: 5, frames: 8,  fps: 12, loop: false },
  fall:    { row: 6, frames: 6,  fps: 10, loop: false },
  drag:    { row: 7, frames: 6,  fps: 10, loop: true },
  special: { row: 8, frames: 6,  fps: 8,  loop: true },
} as const;

type MascotStateName = keyof typeof STATE_ROWS;

interface MascotSpriteProps {
  mascotId: number;          // 1-9，对应 pet/{id}/spritesheet.webp
  state: MascotStateName;    // 当前动画状态
  scale?: number;            // 缩放比例，默认 1.0
  onAnimationEnd?: () => void; // 非循环动画播完回调
}

export const MascotSprite: React.FC<MascotSpriteProps> = ({
  mascotId,
  state,
  scale = 1.0,
  onAnimationEnd,
}) => {
  const [frame, setFrame] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const config = STATE_ROWS[state];

  // 资源路径：Tauri asset protocol 读取本地 pet 目录
  const spriteSrc = `asset://localhost/pet/${mascotId}/spritesheet.webp`;

  useEffect(() => {
    setFrame(0);
    if (timerRef.current) clearInterval(timerRef.current);

    const interval = 1000 / config.fps;
    timerRef.current = setInterval(() => {
      setFrame(prev => {
        const next = prev + 1;
        if (next >= config.frames) {
          if (!config.loop) {
            clearInterval(timerRef.current!);
            onAnimationEnd?.();
            return config.frames - 1; // 停在末帧
          }
          return 0;
        }
        return next;
      });
    }, interval);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state, mascotId]);

  const bgX = -(frame * CELL_W);
  const bgY = -(config.row * CELL_H);

  return (
    <div
      style={{
        width: CELL_W * scale,
        height: CELL_H * scale,
        backgroundImage: `url(${spriteSrc})`,
        backgroundPosition: `${bgX * scale}px ${bgY * scale}px`,
        backgroundSize: `auto ${CELL_H * scale * 9}px`, // 9行高度
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
        cursor: 'grab',
        userSelect: 'none',
      }}
    />
  );
};
```

#### Tauri `tauri.conf.json` 资产权限配置

```json
{
  "tauri": {
    "security": {
      "assetProtocol": {
        "enable": true,
        "scope": ["$RESOURCE/pet/**"]
      }
    }
  }
}
```

> 注意：`pet/` 目录需放置在 Tauri `resources` 目录下，并在 `tauri.conf.json` 的 `bundle.resources` 字段中声明打包。

### 5.5 系统状态 → Mascot 动画状态映射

前端 Zustand store 监听 `recorder-state-changed` IPC 事件，自动切换 `mascotState`：

```typescript
// src/store/mascotStore.ts
import { useRecorderStore } from './recorderStore';

type RecorderState = 'recording' | 'idle' | 'paused' | 'privacy_mode' | 'error';

export function recorderStateToMascotState(rs: RecorderState): MascotStateName {
  switch (rs) {
    case 'recording':     return 'idle';      // Row 0: 轻微呼吸/握笔
    case 'idle':          return 'sleep';     // Row 3: 打瞌睡 Zzz
    case 'paused':        return 'sit';       // Row 4: 静止发呆/抱臂
    case 'privacy_mode':  return 'special';   // Row 8: 拉帘/闭眼
    case 'error':         return 'sit';       // Row 4: 降级静止
    default:              return 'idle';
  }
}
```

**特殊一次性动画触发规则（不依赖 RecorderState）**：

| 触发事件 | 播放动画 | 播完后恢复 |
|---|---|---|
| 日报生成完毕（`report-ready` 事件） | `jump`（Row 5） | 恢复 `recorderStateToMascotState` 对应状态 |
| 用户拖拽伙伴中（`mousedown` + 移动） | `drag`（Row 7） | 松手后播 `fall`（Row 6），落地恢复正常 |
| 拖拽松手落地 | `fall`（Row 6） | `fall` 播完后恢复正常状态 |

### 5.6 Settings 页伙伴选择 UI 规范

*   位置：设置页 → **伙伴 (Companion)** 分组。
*   展示：9 个形象缩略图卡片，每张播放 `idle` 动画（`scale=0.5`）。
*   当前选中：高亮边框 `2px solid var(--color-primary)`，圆角 `--radius-md`。
*   点击即时切换桌面伙伴，无需保存按钮（立即写入持久化配置）。
*   每张卡片下方标注形象名称（中文名）。

---

## 6. 补充说明

*   **禁止** AI Coding Agent 在实现过程中临时手写一套新的动画逻辑或替换为 GIF/APNG。所有动画必须通过 `MascotSprite` 组件 and `STATE_ROWS` 配置表统一驱动。
*   Spritesheet 图片不需要 CDN，全部本地读取，走 Tauri `asset://` 协议。
*   如未来新增伙伴，只需在 `pet/` 目录下新建子目录并放置遵循相同规格的 `spritesheet.webp`，无需修改渲染组件。
