// 数据库迁移系统：在单个事务中执行完整 DDL
// 严格遵循 02_DATA_MODEL.md §2 (9 张物理表 + 索引) 与 §3 (3 个 FTS5 虚拟表 + 9 个触发器)
//
// 注意：PRAGMA(journal_mode/foreign_keys/synchronous) 不在此处设置——
// 它们无法在事务内生效，统一由 connection::init 在打开连接时（autocommit 状态）应用。

use rusqlite::Connection;

/// 完整 DDL：表结构 + 索引 + FTS5 虚拟表 + 触发器 + 默认数据。
/// 表名、字段名、类型、默认值、触发器名与 02_DATA_MODEL.md §2 §3 一字不差。
const DDL_STRING: &str = r#"
-- ============================================================
-- 1. 原始片段表
-- ============================================================
CREATE TABLE IF NOT EXISTS segments (
  id                     TEXT PRIMARY KEY NOT NULL,
  date                   TEXT NOT NULL,
  start_time             TEXT NOT NULL,
  end_time               TEXT NOT NULL,
  duration_seconds       INTEGER NOT NULL DEFAULT 0,
  app_name               TEXT NOT NULL DEFAULT '',
  process_name           TEXT NOT NULL DEFAULT '',
  window_title           TEXT NOT NULL DEFAULT '',
  ocr_text               TEXT NOT NULL DEFAULT '',
  ocr_status             TEXT NOT NULL DEFAULT 'pending',
  image_hash             TEXT NOT NULL DEFAULT '',
  screenshot_path        TEXT NOT NULL DEFAULT '',
  is_important           INTEGER NOT NULL DEFAULT 0,
  is_private             INTEGER NOT NULL DEFAULT 0,
  is_deleted             INTEGER NOT NULL DEFAULT 0,
  capture_source         TEXT NOT NULL DEFAULT 'auto',
  browser_url            TEXT,
  activity_type          TEXT,
  created_at             TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_segments_date ON segments(date);
CREATE INDEX IF NOT EXISTS idx_segments_ocr_status ON segments(ocr_status);
CREATE INDEX IF NOT EXISTS idx_segments_date_active ON segments(date, is_deleted);

-- ============================================================
-- 2. 逻辑事件表 (Episode)
-- ============================================================
CREATE TABLE IF NOT EXISTS clean_episodes (
  id               TEXT PRIMARY KEY NOT NULL,
  date             TEXT NOT NULL,
  hour_bucket      TEXT NOT NULL DEFAULT '',
  start_time       TEXT NOT NULL,
  end_time         TEXT NOT NULL,
  title            TEXT NOT NULL DEFAULT '',
  summary          TEXT NOT NULL DEFAULT '',
  memory_kind      TEXT NOT NULL DEFAULT 'work',
  project          TEXT NOT NULL DEFAULT '',
  entities         TEXT NOT NULL DEFAULT '[]',
  topics           TEXT NOT NULL DEFAULT '[]',
  materials        TEXT NOT NULL DEFAULT '[]',
  outputs          TEXT NOT NULL DEFAULT '[]',
  todos            TEXT NOT NULL DEFAULT '[]',
  blockers         TEXT NOT NULL DEFAULT '[]',
  segment_ids      TEXT NOT NULL DEFAULT '[]',
  evidence_refs    TEXT NOT NULL DEFAULT '[]',
  source_quality   TEXT NOT NULL DEFAULT 'medium',
  confidence       REAL NOT NULL DEFAULT 0.0,
  wiki_eligible    INTEGER NOT NULL DEFAULT 0,
  wiki_status      TEXT NOT NULL DEFAULT 'none',
  model_name       TEXT NOT NULL DEFAULT '',
  distill_version  TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_clean_episodes_date ON clean_episodes(date);
CREATE INDEX IF NOT EXISTS idx_clean_episodes_hour ON clean_episodes(date, hour_bucket);

-- ============================================================
-- 3. 结构化记忆单元表
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_cells (
  id                TEXT PRIMARY KEY NOT NULL,
  clean_episode_id  TEXT NOT NULL,
  episode_text      TEXT NOT NULL DEFAULT '',
  facts             TEXT NOT NULL DEFAULT '[]',
  foresight         TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  FOREIGN KEY (clean_episode_id) REFERENCES clean_episodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_cells_episode ON memory_cells(clean_episode_id);

-- ============================================================
-- 4. 语义向量表
-- ============================================================
CREATE TABLE IF NOT EXISTS embeddings (
  id              TEXT PRIMARY KEY NOT NULL,
  memory_cell_id  TEXT NOT NULL,
  embedding       BLOB NOT NULL,
  model_version   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (memory_cell_id) REFERENCES memory_cells(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_embeddings_cell ON embeddings(memory_cell_id);

-- ============================================================
-- 5. 蒸馏运行状态表 (幂等保证)
-- ============================================================
CREATE TABLE IF NOT EXISTS distill_runs (
  id             TEXT PRIMARY KEY NOT NULL,
  date           TEXT NOT NULL,
  hour_bucket    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending',
  segment_count  INTEGER NOT NULL DEFAULT 0,
  error_message  TEXT NOT NULL DEFAULT '',
  model_name     TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT '',
  updated_at     TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_distill_runs_hour ON distill_runs(date, hour_bucket);

-- ============================================================
-- 6. 知识 Wiki 页面表
-- ============================================================
CREATE TABLE IF NOT EXISTS wiki_pages (
  id                TEXT PRIMARY KEY NOT NULL,
  title             TEXT NOT NULL,
  content           TEXT NOT NULL DEFAULT '',
  source_type       TEXT NOT NULL DEFAULT 'ai',
  source_episode_id TEXT,
  status            TEXT NOT NULL DEFAULT 'draft',
  tags              TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (source_episode_id) REFERENCES clean_episodes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_status ON wiki_pages(status);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_updated ON wiki_pages(updated_at);

-- ============================================================
-- 7. 工作报告表
-- ============================================================
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY NOT NULL,
  date         TEXT NOT NULL,
  report_type  TEXT NOT NULL DEFAULT 'daily',
  template     TEXT NOT NULL DEFAULT 'enhanced',
  title        TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft',
  model_name   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date);

-- ============================================================
-- 8. 隐私过滤规则表
-- ============================================================
CREATE TABLE IF NOT EXISTS privacy_rules (
  id         TEXT PRIMARY KEY NOT NULL,
  rule_type  TEXT NOT NULL,
  pattern    TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- ============================================================
-- 9. 单行 KV 系统设置表
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ============================================================
-- FTS5 全文索引 (02_DATA_MODEL.md §3)
-- ============================================================

-- 1. segments 全文索引
CREATE VIRTUAL TABLE IF NOT EXISTS fts_segments USING fts5(
  ocr_text, window_title,
  content='segments', content_rowid='rowid',
  tokenize='unicode61'
);

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

-- ============================================================
-- 默认数据
-- ============================================================

-- 默认 AppSetting (含 mascotId=1)
INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES (
  'app',
  '{"saveScreenshots":false,"retentionDays":30,"openaiBaseUrl":"https://api.openai.com/v1","openaiModel":"gpt-4o-mini","embeddingEnabled":false,"mascotOpacity":1.0,"mascotActiveFrequency":"normal","onboardingCompleted":false,"mascotId":1}',
  datetime('now')
);

-- 默认隐私规则
INSERT OR IGNORE INTO privacy_rules(id, rule_type, pattern, enabled, created_at) VALUES
  ('privacy-chrome-ext', 'url',     'chrome-extension://', 1, datetime('now')),
  ('privacy-bank',       'keyword', '*银行*',              1, datetime('now')),
  ('privacy-wechat',     'app',     'WeChat',              1, datetime('now'));
"#;

/// 在单个事务中执行完整 DDL：建表、索引、FTS5 虚拟表、触发器及默认数据。
///
/// 幂等：所有语句均使用 `IF NOT EXISTS` / `INSERT OR IGNORE`，可重复执行。
/// 失败时自动回滚整个事务，保证数据库不会停留在半迁移状态。
pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("BEGIN;")?;
    if let Err(err) = conn.execute_batch(DDL_STRING) {
        // 即便回滚失败也应将原始 DDL 错误向上抛出
        let _ = conn.execute_batch("ROLLBACK;");
        return Err(err);
    }
    conn.execute_batch("COMMIT;")?;
    Ok(())
}
