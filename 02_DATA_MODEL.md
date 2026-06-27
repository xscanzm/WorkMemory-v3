# WorkMemory 02: 统一数据模型与 SQLite Schema (Unified Data Model)

> **文档定位**：定义系统所有内存模型、数据库持久化实体和 FTS5 全文索引。所有底层 Repository 逻辑和 IPC 数据传输结构必须无条件遵循此定义，确保前后端命名完全一致。

---

## 1. 核心概念映射

为了消除历史文档中的名词冲突，系统定义以下概念映射，前后端统一遵循此命名：

| 物理数据库表名 | 概念/类命名 | 前端数据类型 | 说明 |
|---|---|---|---|
| `segments` | `WorkSegment` | `WorkSegment` | 原始像素或应用捕获的物理片段，代表某一个具体的应用窗口活动。 |
| `clean_episodes` | `CleanEpisode` | `CleanEpisode` | 聚合后的逻辑事件。由 AI 或聚类算法将连续的、同主题的 segments 合并而成（如“推进退款字段确认”）。 |
| `memory_cells` | `MemoryCell` | `MemoryCell` | 蒸馏出的结构化事实，是 Episode 的灵魂，用于向量化和双链图谱。 |
| `embeddings` | `MemoryEmbedding` | N/A (仅后端使用) | 语义向量表，关联到特定的 `MemoryCell`。 |
| `wiki_pages` | `WikiPage` | `WikiPage` | 长期沉淀的双链知识页面（如 [[订单系统]]）。 |
| `reports` | `WorkReport` | `WorkReport` | 用户生成的日报、周报或项目进展材料。 |
| `privacy_rules` | `PrivacyRule` | `PrivacyRule` | 敏感词、应用黑名单或 URL 过滤规则。 |
| `settings` | `AppSetting` | `AppSetting` | 系统全局配置（Key-Value 格式）。 |

---

## 2. 数据库物理 Schema (DDL)

```sql
-- SQLite 3 物理 Schema 规范。WAL 模式、外键约束开启。
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 1. 原始片段表
CREATE TABLE IF NOT EXISTS segments (
  id                     TEXT PRIMARY KEY NOT NULL,
  date                   TEXT NOT NULL,                    -- YYYY-MM-DD
  start_time             TEXT NOT NULL,                    -- HH:MM:SS
  end_time               TEXT NOT NULL,                    -- HH:MM:SS
  duration_seconds       INTEGER NOT NULL DEFAULT 0,
  app_name               TEXT NOT NULL DEFAULT '',         -- e.g., "WeChat"
  process_name           TEXT NOT NULL DEFAULT '',         -- e.g., "WeChat.exe"
  window_title           TEXT NOT NULL DEFAULT '',         -- e.g., "产品讨论组"
  ocr_text               TEXT NOT NULL DEFAULT '',
  ocr_status             TEXT NOT NULL DEFAULT 'pending',  -- pending, done, failed, skipped
  image_hash             TEXT NOT NULL DEFAULT '',         -- pHash 值
  screenshot_path        TEXT NOT NULL DEFAULT '',         -- 本地相对/绝对路径
  is_important           INTEGER NOT NULL DEFAULT 0,       -- 0 or 1
  is_private             INTEGER NOT NULL DEFAULT 0,       -- 0 or 1
  is_deleted             INTEGER NOT NULL DEFAULT 0,       -- 软删除，0 or 1
  capture_source         TEXT NOT NULL DEFAULT 'auto',     -- auto or manual
  browser_url            TEXT,                             -- 浏览器 URL (若为浏览器)
  activity_type          TEXT,                             -- coding, browsing, communication, writing, reading, idle
  created_at             TEXT NOT NULL DEFAULT ''          -- ISO8601 UTC
);

CREATE INDEX IF NOT EXISTS idx_segments_date ON segments(date);
CREATE INDEX IF NOT EXISTS idx_segments_ocr_status ON segments(ocr_status);
CREATE INDEX IF NOT EXISTS idx_segments_date_active ON segments(date, is_deleted);

-- 2. 逻辑事件表 (Episode)
CREATE TABLE IF NOT EXISTS clean_episodes (
  id               TEXT PRIMARY KEY NOT NULL,
  date             TEXT NOT NULL,                    -- YYYY-MM-DD
  hour_bucket      TEXT NOT NULL DEFAULT '',         -- HH:00
  start_time       TEXT NOT NULL,                    -- HH:MM:SS
  end_time         TEXT NOT NULL,                    -- HH:MM:SS
  title            TEXT NOT NULL DEFAULT '',
  summary          TEXT NOT NULL DEFAULT '',
  memory_kind      TEXT NOT NULL DEFAULT 'work',     -- work, life, study, social, play, rest
  project          TEXT NOT NULL DEFAULT '',         -- 所属项目标签
  entities         TEXT NOT NULL DEFAULT '[]',       -- JSON string[]: 提取出的人物、需求、文档、链接
  topics           TEXT NOT NULL DEFAULT '[]',       -- JSON string[]: 主题标签
  materials        TEXT NOT NULL DEFAULT '[]',       -- JSON string[]: 使用的物料
  outputs          TEXT NOT NULL DEFAULT '[]',       -- JSON string[]: 产出
  todos            TEXT NOT NULL DEFAULT '[]',       -- JSON string[]: 发现的待办
  blockers         TEXT NOT NULL DEFAULT '[]',       -- JSON string[]: 遇到的阻塞点
  segment_ids      TEXT NOT NULL DEFAULT '[]',       -- JSON string[]: 关联的 segments 物理 ID
  evidence_refs    TEXT NOT NULL DEFAULT '[]',       -- JSON string[]: 证据线索
  source_quality   TEXT NOT NULL DEFAULT 'medium',   -- high, medium, low
  confidence       REAL NOT NULL DEFAULT 0.0,        -- 置信度 0.0 - 1.0
  wiki_eligible    INTEGER NOT NULL DEFAULT 0,       -- 是否适合保存为 Wiki，0 or 1
  wiki_status      TEXT NOT NULL DEFAULT 'none',     -- none, eligible, saved
  model_name       TEXT NOT NULL DEFAULT '',         -- 使用的蒸馏模型
  distill_version  TEXT NOT NULL DEFAULT '',         -- 蒸馏管道版本
  created_at       TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_clean_episodes_date ON clean_episodes(date);
CREATE INDEX IF NOT EXISTS idx_clean_episodes_hour ON clean_episodes(date, hour_bucket);

-- 3. 结构化记忆单元表
CREATE TABLE IF NOT EXISTS memory_cells (
  id                TEXT PRIMARY KEY NOT NULL,
  clean_episode_id  TEXT NOT NULL,
  episode_text      TEXT NOT NULL DEFAULT '',        -- 第三人称叙事，1-2 句精炼总结
  facts             TEXT NOT NULL DEFAULT '[]',       -- JSON string[]: 提取的关键事实
  foresight         TEXT NOT NULL DEFAULT '[]',       -- JSON: 预判待办
  created_at        TEXT NOT NULL,
  FOREIGN KEY (clean_episode_id) REFERENCES clean_episodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_cells_episode ON memory_cells(clean_episode_id);

-- 4. 语义向量表
CREATE TABLE IF NOT EXISTS embeddings (
  id              TEXT PRIMARY KEY NOT NULL,
  memory_cell_id  TEXT NOT NULL,
  embedding       BLOB NOT NULL,                    -- f32[] 序列化为 Little-Endian 字节数组
  model_version   TEXT NOT NULL,                    -- text-embedding-3-small
  created_at      TEXT NOT NULL,
  FOREIGN KEY (memory_cell_id) REFERENCES memory_cells(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_embeddings_cell ON embeddings(memory_cell_id);

-- 5. 蒸馏运行状态表 (幂等保证)
CREATE TABLE IF NOT EXISTS distill_runs (
  id             TEXT PRIMARY KEY NOT NULL,
  date           TEXT NOT NULL,
  hour_bucket    TEXT NOT NULL DEFAULT '',         -- HH:00
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending, running, done, failed, skip
  segment_count  INTEGER NOT NULL DEFAULT 0,
  error_message  TEXT NOT NULL DEFAULT '',
  model_name     TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT '',
  updated_at     TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_distill_runs_hour ON distill_runs(date, hour_bucket);

-- 6. 知识 Wiki 页面表
CREATE TABLE IF NOT EXISTS wiki_pages (
  id                TEXT PRIMARY KEY NOT NULL,
  title             TEXT NOT NULL,
  content           TEXT NOT NULL DEFAULT '',
  source_type       TEXT NOT NULL DEFAULT 'ai',     -- ai, manual
  source_episode_id TEXT,                           -- 关联的逻辑事件 ID
  status            TEXT NOT NULL DEFAULT 'draft',  -- draft, published, archived
  tags              TEXT NOT NULL DEFAULT '[]',     -- JSON string[]
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (source_episode_id) REFERENCES clean_episodes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_status ON wiki_pages(status);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_updated ON wiki_pages(updated_at);

-- 7. 工作报告表
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY NOT NULL,
  date         TEXT NOT NULL,                      -- YYYY-MM-DD
  report_type  TEXT NOT NULL DEFAULT 'daily',     -- daily, weekly, project
  template     TEXT NOT NULL DEFAULT 'enhanced',  -- enhanced, concise, okr, structured
  title        TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',          -- Markdown
  status       TEXT NOT NULL DEFAULT 'draft',     -- draft, published
  model_name   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date);

-- 8. 隐私过滤规则表
CREATE TABLE IF NOT EXISTS privacy_rules (
  id         TEXT PRIMARY KEY NOT NULL,
  rule_type  TEXT NOT NULL,                       -- app, url, keyword
  pattern    TEXT NOT NULL,                       -- WeChat, chrome-extension://, *银行*
  enabled    INTEGER NOT NULL DEFAULT 1,          -- 0 or 1
  created_at TEXT NOT NULL
);

-- 9. 单行 KV 系统设置表
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY NOT NULL,
  value      TEXT NOT NULL,                       -- JSON string
  updated_at TEXT NOT NULL
);
```

---

## 3. FTS5 全文搜索集成 (Full-Text Search)

SQLite 的 FTS5 虚拟表用于实现毫秒级的极速本地检索。系统必须建立以下虚拟表，并设置触发器同步数据：

```sql
-- 1. segments 全文索引
CREATE VIRTUAL TABLE IF NOT EXISTS fts_segments USING fts5(
  ocr_text, window_title,
  content='segments', content_rowid='rowid',
  tokenize='unicode61'
);

-- segments 触发器：数据变化时同步更新全文检索
CREATE TRIGGER IF NOT EXISTS trg_segments_ai AFTER INSERT ON segments BEGIN
  INSERT INTO fts_segments(rowid, ocr_text, window_title) VALUES (new.rowid, new.ocr_text, new.window_title);
END;

CREATE TRIGGER IF NOT EXISTS trg_segments_ad BEFORE DELETE ON segments BEGIN
  INSERT INTO fts_segments(fts_segments, rowid, ocr_text, window_title) VALUES('delete', old.rowid, old.ocr_text, old.window_title);
END;

CREATE TRIGGER IF NOT EXISTS trg_segments_au AFTER UPDATE ON segments BEGIN
  INSERT INTO fts_segments(fts_segments, rowid, ocr_text, window_title) VALUES('delete', old.rowid, old.ocr_text, old.window_title);
  INSERT INTO fts_segments(rowid, ocr_text, window_title) VALUES (new.rowid, new.ocr_text, new.window_title);
END;


-- 2. clean_episodes 全文索引
CREATE VIRTUAL TABLE IF NOT EXISTS fts_clean_episodes USING fts5(
  title, summary,
  content='clean_episodes', content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS trg_episodes_ai AFTER INSERT ON clean_episodes BEGIN
  INSERT INTO fts_clean_episodes(rowid, title, summary) VALUES (new.rowid, new.title, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS trg_episodes_ad BEFORE DELETE ON clean_episodes BEGIN
  INSERT INTO fts_clean_episodes(fts_clean_episodes, rowid, title, summary) VALUES('delete', old.rowid, old.title, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS trg_episodes_au AFTER UPDATE ON clean_episodes BEGIN
  INSERT INTO fts_clean_episodes(fts_clean_episodes, rowid, title, summary) VALUES('delete', old.rowid, old.title, old.summary);
  INSERT INTO fts_clean_episodes(rowid, title, summary) VALUES (new.rowid, new.title, new.summary);
END;


-- 3. wiki_pages 全文索引
CREATE VIRTUAL TABLE IF NOT EXISTS fts_wiki USING fts5(
  title, content,
  content='wiki_pages', content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS trg_wiki_ai AFTER INSERT ON wiki_pages BEGIN
  INSERT INTO fts_wiki(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS trg_wiki_ad BEFORE DELETE ON wiki_pages BEGIN
  INSERT INTO fts_wiki(fts_wiki, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS trg_wiki_au AFTER UPDATE ON wiki_pages BEGIN
  INSERT INTO fts_wiki(fts_wiki, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
  INSERT INTO fts_wiki(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;
```

---

## 4. 前端 TypeScript 声明

前端数据类型声明必须在 `src/types/index.ts` 中，核心结构如下：

```typescript
export interface WorkSegment {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  appName: string;
  processName: string;
  windowTitle: string;
  ocrText: string;
  ocrStatus: 'pending' | 'done' | 'failed' | 'skipped';
  imageHash: string;
  screenshotPath: string;
  isImportant: boolean;
  isPrivate: boolean;
  captureSource: 'auto' | 'manual';
  browserUrl?: string;
  activityType?: 'coding' | 'browsing' | 'communication' | 'writing' | 'reading' | 'idle';
}

export interface CleanEpisode {
  id: string;
  date: string;
  hourBucket: string;
  startTime: string;
  endTime: string;
  title: string;
  summary: string;
  memoryKind: 'work' | 'life' | 'study' | 'social' | 'play' | 'rest';
  project: string;
  entities: string[];
  topics: string[];
  materials: string[];
  outputs: string[];
  todos: string[];
  blockers: string[];
  segmentIds: string[];
  evidenceRefs: string[];
  sourceQuality: 'high' | 'medium' | 'low';
  confidence: number;
  wikiEligible: boolean;
  wikiStatus: 'none' | 'eligible' | 'saved';
}

export interface MemoryCell {
  id: string;
  cleanEpisodeId: string;
  episodeText: string;
  facts: string[];
  foresight: Array<{
    statement: string;
    validFrom: string;
    validTo: string;
    confidence: number;
  }>;
}

export interface WikiPage {
  id: string;
  title: string;
  content: string;
  sourceType: 'ai' | 'manual';
  sourceEpisodeId?: string;
  status: 'draft' | 'published' | 'archived';
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkReport {
  id: string;
  date: string;
  reportType: 'daily' | 'weekly' | 'project';
  template: 'enhanced' | 'concise' | 'okr' | 'structured';
  title: string;
  content: string;
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
}

export interface PrivacyRule {
  id: string;
  ruleType: 'app' | 'url' | 'keyword';
  pattern: string;
  enabled: boolean;
}

export interface AppSetting {
  saveScreenshots: boolean;
  retentionDays: number;
  openaiBaseUrl: string;
  openaiModel: string;
  embeddingEnabled: boolean;
  mascotOpacity: number;
  mascotActiveFrequency: 'high' | 'normal' | 'low' | 'off';
  onboardingCompleted: boolean;
}
```

---

## v3 新增表 (2026-06)

> 本节补全 WorkMemory-v3 任务/宠物/专注/分析四大业务域的 8 张物理表。**DDL 真源为单一文件** `/workspace/workmemory-app/src-tauri/src/db/migrations.rs::DDL_STRING`，由 `run(conn)` 在单事务内幂等执行（全部 `IF NOT EXISTS` / `INSERT OR IGNORE`）。下方 DDL 与该文件一字不差；若发生冲突以 `migrations.rs` 为准。

### 关系概览

```
tasks ──(task_id, optional)──► focus_sessions
pet_state (单行 id='default') ──► pet_interaction_logs (action 日志)
daily_stats (date 主键, 幂等 upsert)
achievements (id 主键 / 解锁后置 unlocked_at)
soundscape_packs (id 主键 / layers JSON)
user_preferences (key-value KV)
```

*   `tasks → focus_sessions`：`focus_sessions.task_id` 为**可选软引用**（允许自由计时无关联任务），未建物理外键以避免删除任务阻断历史会话查询。
*   `pet_state → pet_interaction_logs`：`pet_state` 为单行（`id='default'`，由 `INSERT OR IGNORE` 初始化默认值 cat/level1/xp0/属性80/`mood='happy'`），`pet_interaction_logs` 通过 `action` 字段记录每次交互（feed/play/rest/clean/task_completed/focus_completed）。
*   `daily_stats` 以 `date` 为业务主键（`YYYY-MM-DD`），由 `analytics_engine` 以 `INSERT ... ON CONFLICT(date) DO UPDATE` 幂等 upsert。
*   `achievements` 以业务 `code` 作为 `id` 主键，`unlocked=0/1` + `unlocked_at` 标记解锁状态。

### DDL（任务 / 宠物 / 专注层 8 张表 + 1 个 FTS5）

```sql
-- 10. 任务表
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'inbox',  -- inbox/todo/in_progress/completed/archived
  priority        TEXT NOT NULL DEFAULT 'none',   -- none/low/medium/high/urgent
  due_date        TEXT,                            -- ISO date or NULL
  mood_tag        TEXT,                            -- 情绪标签
  recurrence_rule TEXT,                            -- iCal RRULE or NULL
  is_pinned       INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  subtasks        TEXT NOT NULL DEFAULT '[]',      -- JSON array
  category        TEXT NOT NULL DEFAULT '',
  tags            TEXT NOT NULL DEFAULT '[]',      -- JSON array
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_pinned ON tasks(is_pinned);

-- 11. 任务全文索引 (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS fts_tasks USING fts5(
  title, description,
  content='tasks', content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS trg_tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO fts_tasks(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;
CREATE TRIGGER IF NOT EXISTS trg_tasks_ad BEFORE DELETE ON tasks BEGIN
  INSERT INTO fts_tasks(fts_tasks, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
END;
CREATE TRIGGER IF NOT EXISTS trg_tasks_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO fts_tasks(fts_tasks, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
  INSERT INTO fts_tasks(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;

-- 12. 宠物状态表 (单行, id='default')
CREATE TABLE IF NOT EXISTS pet_state (
  id            TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
  species       TEXT NOT NULL DEFAULT 'cat',
  level         INTEGER NOT NULL DEFAULT 1,
  xp            INTEGER NOT NULL DEFAULT 0,
  hunger        INTEGER NOT NULL DEFAULT 80,   -- 0-100
  energy        INTEGER NOT NULL DEFAULT 80,
  happiness     INTEGER NOT NULL DEFAULT 80,
  cleanliness   INTEGER NOT NULL DEFAULT 80,
  bond_level    INTEGER NOT NULL DEFAULT 0,
  mood          TEXT NOT NULL DEFAULT 'happy', -- ecstatic/happy/content/neutral/sad/angry/sleeping
  last_updated  TEXT NOT NULL
);

-- 13. 每日统计表
CREATE TABLE IF NOT EXISTS daily_stats (
  date              TEXT PRIMARY KEY NOT NULL,
  tasks_completed   INTEGER NOT NULL DEFAULT 0,
  total_focus_time  INTEGER NOT NULL DEFAULT 0,  -- seconds
  streak_count      INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- 14. 专注会话表
CREATE TABLE IF NOT EXISTS focus_sessions (
  id                  TEXT PRIMARY KEY NOT NULL,
  start_time          TEXT NOT NULL,
  end_time            TEXT,
  duration_seconds    INTEGER NOT NULL DEFAULT 0,
  type                TEXT NOT NULL DEFAULT 'pomodoro', -- pomodoro/free
  task_id             TEXT,
  interrupted         INTEGER NOT NULL DEFAULT 0,
  interruption_reason TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_start ON focus_sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_task ON focus_sessions(task_id);

-- 15. 用户偏好 KV 表
CREATE TABLE IF NOT EXISTS user_preferences (
  key         TEXT PRIMARY KEY NOT NULL,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 16. 成就表
CREATE TABLE IF NOT EXISTS achievements (
  id          TEXT PRIMARY KEY NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT '',
  unlocked    INTEGER NOT NULL DEFAULT 0,
  unlocked_at TEXT,
  created_at  TEXT NOT NULL
);

-- 17. 白噪音音景包表
CREATE TABLE IF NOT EXISTS soundscape_packs (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  layers      TEXT NOT NULL DEFAULT '[]',  -- JSON array of {name, file, volume}
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

-- 18. 宠物互动日志表
CREATE TABLE IF NOT EXISTS pet_interaction_logs (
  id          TEXT PRIMARY KEY NOT NULL,
  action      TEXT NOT NULL,  -- feed/play/rest/clean
  delta       TEXT NOT NULL DEFAULT '{}',  -- JSON of attribute deltas
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pet_interaction_logs_created ON pet_interaction_logs(created_at);
```

### 默认数据

`migrations.rs` 在 DDL 末尾以 `INSERT OR IGNORE` 写入两条种子数据：① `settings('app', ...)` 默认 `AppSetting`（含 `mascotId=1`）；② `pet_state('default', ...)` 默认宠物（cat/level1/xp0/属性80/`mood='happy'`）。另外注入 3 条隐私规则（chrome-extension / 银行关键字 / WeChat 应用）。

### 设计要点

1. **uuid v4 主键**：`tasks.id / focus_sessions.id / pet_interaction_logs.id` 均由后端 `uuid::Uuid::new_v4()` 生成（36 字符 `8-4-4-4-12`），禁止前端 `Date.now()` 拼接（修复 BUG-001）。
2. **状态守卫单点**：任务状态机 `inbox → todo → in_progress → completed → archived`（`archived` 终态）由 `task_engine::update_task` 内 `validate_transition` 强制，DDL 层不做约束以便回滚迁移。
3. **JSON 列降级**：`tasks.subtasks / tasks.tags / soundscape_packs.layers / pet_interaction_logs.delta` 均以 TEXT 存 JSON，读取时 `serde_json::from_str` 失败即降级为空容器，不阻塞查询。
4. **幂等 upsert**：`daily_stats` 全表仅一条业务路径写入（`analytics_engine::on_task_completed / on_focus_completed`），统一走 `INSERT ... ON CONFLICT(date) DO UPDATE` 保证多次调用不重复累加错误（focus_time 由调用方保证不重复触发）。
