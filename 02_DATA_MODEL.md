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
