// 统一存储库封装：为 9 张物理表提供 CRUD，并封装 FTS5 全文检索。
// 所有函数以 `&rusqlite::Connection` 为第一参数，返回 `rusqlite::Result<T>`。
// 布尔字段：DB 用 INTEGER 0/1，结构体用 bool，转换在 from_row / insert 处完成。
// JSON 数组字段：DB 存 JSON 字符串，结构体用 Vec，序列化/反序列化用 serde_json。

#![allow(dead_code)]

use rusqlite::{params, Connection, Row};

use crate::models::{
    AppSetting, CleanEpisode, DistillRun, Embedding, MemoryCell, PrivacyRule, SearchResult,
    WikiPage, WorkReport, WorkSegment,
};

// ============================================================================
// 列清单常量：供 SELECT 复用，保证 from_row 按列名取值时列名齐全
// ============================================================================

const SEGMENT_COLS: &str = "id, date, start_time, end_time, duration_seconds, app_name, process_name, window_title, ocr_text, ocr_status, image_hash, screenshot_path, is_important, is_private, is_deleted, capture_source, browser_url, activity_type, created_at";

const EPISODE_COLS: &str = "id, date, hour_bucket, start_time, end_time, title, summary, memory_kind, project, entities, topics, materials, outputs, todos, blockers, segment_ids, evidence_refs, source_quality, confidence, wiki_eligible, wiki_status, is_private, model_name, distill_version, created_at, updated_at";

const MEMORY_CELL_COLS: &str = "id, clean_episode_id, episode_text, facts, foresight, created_at";

const EMBEDDING_COLS: &str = "id, memory_cell_id, embedding, model_version, created_at";

const DISTILL_RUN_COLS: &str = "id, date, hour_bucket, status, segment_count, error_message, model_name, created_at, updated_at";

const WIKI_COLS: &str = "id, title, content, source_type, source_episode_id, status, tags, created_at, updated_at";

const REPORT_COLS: &str = "id, date, report_type, template, title, content, status, model_name, created_at, updated_at";

const PRIVACY_RULE_COLS: &str = "id, rule_type, pattern, enabled, created_at";

// ============================================================================
// 内部辅助：JSON 序列化/反序列化错误映射
// ============================================================================

fn map_json_err(e: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(e))
}

fn to_json<T: serde::Serialize>(v: &T) -> rusqlite::Result<String> {
    serde_json::to_string(v).map_err(map_json_err)
}

fn parse_json<T: serde::de::DeserializeOwned>(s: &str) -> rusqlite::Result<T> {
    serde_json::from_str(s).map_err(map_json_err)
}

// ============================================================================
// from_row 实现
// ============================================================================

impl WorkSegment {
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            date: row.get("date")?,
            start_time: row.get("start_time")?,
            end_time: row.get("end_time")?,
            duration_seconds: row.get("duration_seconds")?,
            app_name: row.get("app_name")?,
            process_name: row.get("process_name")?,
            window_title: row.get("window_title")?,
            ocr_text: row.get("ocr_text")?,
            ocr_status: row.get("ocr_status")?,
            image_hash: row.get("image_hash")?,
            screenshot_path: row.get("screenshot_path")?,
            is_important: row.get::<_, i32>("is_important")? != 0,
            is_private: row.get::<_, i32>("is_private")? != 0,
            is_deleted: row.get::<_, i32>("is_deleted")? != 0,
            capture_source: row.get("capture_source")?,
            browser_url: row.get("browser_url")?,
            activity_type: row.get("activity_type")?,
            created_at: row.get("created_at")?,
        })
    }
}

impl CleanEpisode {
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            date: row.get("date")?,
            hour_bucket: row.get("hour_bucket")?,
            start_time: row.get("start_time")?,
            end_time: row.get("end_time")?,
            title: row.get("title")?,
            summary: row.get("summary")?,
            memory_kind: row.get("memory_kind")?,
            project: row.get("project")?,
            entities: parse_json(&row.get::<_, String>("entities")?)?,
            topics: parse_json(&row.get::<_, String>("topics")?)?,
            materials: parse_json(&row.get::<_, String>("materials")?)?,
            outputs: parse_json(&row.get::<_, String>("outputs")?)?,
            todos: parse_json(&row.get::<_, String>("todos")?)?,
            blockers: parse_json(&row.get::<_, String>("blockers")?)?,
            segment_ids: parse_json(&row.get::<_, String>("segment_ids")?)?,
            evidence_refs: parse_json(&row.get::<_, String>("evidence_refs")?)?,
            source_quality: row.get("source_quality")?,
            confidence: row.get("confidence")?,
            wiki_eligible: row.get::<_, i32>("wiki_eligible")? != 0,
            wiki_status: row.get("wiki_status")?,
            is_private: row.get::<_, i32>("is_private")? != 0,
            model_name: row.get("model_name")?,
            distill_version: row.get("distill_version")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

impl MemoryCell {
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            clean_episode_id: row.get("clean_episode_id")?,
            episode_text: row.get("episode_text")?,
            facts: parse_json(&row.get::<_, String>("facts")?)?,
            foresight: parse_json(&row.get::<_, String>("foresight")?)?,
            created_at: row.get("created_at")?,
        })
    }
}

impl Embedding {
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            memory_cell_id: row.get("memory_cell_id")?,
            embedding: row.get("embedding")?,
            model_version: row.get("model_version")?,
            created_at: row.get("created_at")?,
        })
    }
}

impl DistillRun {
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            date: row.get("date")?,
            hour_bucket: row.get("hour_bucket")?,
            status: row.get("status")?,
            segment_count: row.get("segment_count")?,
            error_message: row.get("error_message")?,
            model_name: row.get("model_name")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

impl WikiPage {
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            title: row.get("title")?,
            content: row.get("content")?,
            source_type: row.get("source_type")?,
            source_episode_id: row.get("source_episode_id")?,
            status: row.get("status")?,
            tags: parse_json(&row.get::<_, String>("tags")?)?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

impl WorkReport {
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            date: row.get("date")?,
            report_type: row.get("report_type")?,
            template: row.get("template")?,
            title: row.get("title")?,
            content: row.get("content")?,
            status: row.get("status")?,
            model_name: row.get("model_name")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

impl PrivacyRule {
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            rule_type: row.get("rule_type")?,
            pattern: row.get("pattern")?,
            enabled: row.get::<_, i32>("enabled")? != 0,
            created_at: row.get("created_at")?,
        })
    }
}

// ============================================================================
// segments 表
// ============================================================================

/// 插入一条原始片段。触发器 trg_segments_ai 自动同步 FTS5 索引。
pub fn insert_segment(conn: &Connection, seg: &WorkSegment) -> rusqlite::Result<()> {
    let is_important = i32::from(seg.is_important);
    let is_private = i32::from(seg.is_private);
    let is_deleted = i32::from(seg.is_deleted);
    conn.execute(
        "INSERT INTO segments (id, date, start_time, end_time, duration_seconds, app_name, process_name, window_title, ocr_text, ocr_status, image_hash, screenshot_path, is_important, is_private, is_deleted, capture_source, browser_url, activity_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        params![
            seg.id, seg.date, seg.start_time, seg.end_time, seg.duration_seconds,
            seg.app_name, seg.process_name, seg.window_title, seg.ocr_text, seg.ocr_status,
            seg.image_hash, seg.screenshot_path, is_important, is_private, is_deleted,
            seg.capture_source, seg.browser_url, seg.activity_type, seg.created_at
        ],
    )?;
    Ok(())
}

/// 获取某一天所有未软删除的片段，按开始时间升序。
pub fn get_segments_by_date(conn: &Connection, date: &str) -> rusqlite::Result<Vec<WorkSegment>> {
    let sql = format!(
        "SELECT {SEGMENT_COLS} FROM segments WHERE date = ?1 AND is_deleted = 0 ORDER BY start_time ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date], WorkSegment::from_row)?;
    rows.collect()
}

/// 获取某天某小时（hour_bucket 形如 "14:00"）的未软删除片段。
/// 通过比较 start_time 与 hour_bucket 的前两位小时数实现。
/// 过滤 is_private=1，避免隐私窗口标题进入 AI prompt / 聚类标题。
pub fn get_segments_by_hour(
    conn: &Connection,
    date: &str,
    hour_bucket: &str,
) -> rusqlite::Result<Vec<WorkSegment>> {
    let sql = format!(
        "SELECT {SEGMENT_COLS} FROM segments \
         WHERE date = ?1 AND substr(start_time, 1, 2) = substr(?2, 1, 2) AND is_deleted = 0 AND is_private = 0 \
         ORDER BY start_time ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date, hour_bucket], WorkSegment::from_row)?;
    rows.collect()
}

/// 更新片段的 OCR 文本与状态。触发器 trg_segments_au 自动同步 FTS5 索引。
pub fn update_segment_ocr(
    conn: &Connection,
    id: &str,
    ocr_text: &str,
    ocr_status: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE segments SET ocr_text = ?2, ocr_status = ?3 WHERE id = ?1",
        params![id, ocr_text, ocr_status],
    )?;
    Ok(())
}

/// 合并片段时长：在现有 duration_seconds 上累加，并更新 end_time。
pub fn merge_segment_duration(
    conn: &Connection,
    id: &str,
    additional_seconds: i64,
    new_end_time: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE segments SET duration_seconds = duration_seconds + ?2, end_time = ?3 WHERE id = ?1",
        params![id, additional_seconds, new_end_time],
    )?;
    Ok(())
}

/// 按 ID 获取单个片段（含已软删除）。
pub fn get_segment_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<WorkSegment>> {
    let sql = format!("SELECT {SEGMENT_COLS} FROM segments WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => Ok(Some(WorkSegment::from_row(row)?)),
        None => Ok(None),
    }
}

/// 软删除片段（is_deleted = 1）。
pub fn soft_delete_segment(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE segments SET is_deleted = 1 WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

// ============================================================================
// clean_episodes 表
// ============================================================================

/// 插入一条逻辑事件。触发器 trg_episodes_ai 自动同步 FTS5 索引。
pub fn insert_episode(conn: &Connection, ep: &CleanEpisode) -> rusqlite::Result<()> {
    let wiki_eligible = i32::from(ep.wiki_eligible);
    let is_private = i32::from(ep.is_private);
    conn.execute(
        "INSERT INTO clean_episodes (id, date, hour_bucket, start_time, end_time, title, summary, memory_kind, project, entities, topics, materials, outputs, todos, blockers, segment_ids, evidence_refs, source_quality, confidence, wiki_eligible, wiki_status, is_private, model_name, distill_version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)",
        params![
            ep.id, ep.date, ep.hour_bucket, ep.start_time, ep.end_time,
            ep.title, ep.summary, ep.memory_kind, ep.project,
            to_json(&ep.entities)?, to_json(&ep.topics)?, to_json(&ep.materials)?,
            to_json(&ep.outputs)?, to_json(&ep.todos)?, to_json(&ep.blockers)?,
            to_json(&ep.segment_ids)?, to_json(&ep.evidence_refs)?,
            ep.source_quality, ep.confidence, wiki_eligible, ep.wiki_status, is_private,
            ep.model_name, ep.distill_version, ep.created_at, ep.updated_at
        ],
    )?;
    Ok(())
}

/// 获取某天的全部 Episode，按开始时间升序。
pub fn get_episodes_by_date(
    conn: &Connection,
    date: &str,
) -> rusqlite::Result<Vec<CleanEpisode>> {
    let sql = format!(
        "SELECT {EPISODE_COLS} FROM clean_episodes WHERE date = ?1 ORDER BY start_time ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date], CleanEpisode::from_row)?;
    rows.collect()
}

/// 按 ID 获取单个 Episode。
pub fn get_episode_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<CleanEpisode>> {
    let sql = format!("SELECT {EPISODE_COLS} FROM clean_episodes WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => Ok(Some(CleanEpisode::from_row(row)?)),
        None => Ok(None),
    }
}

/// 用户手动编辑 Episode 标题与摘要。触发器 trg_episodes_au 自动同步 FTS5 索引。
pub fn update_episode_title_summary(
    conn: &Connection,
    id: &str,
    title: &str,
    summary: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE clean_episodes SET title = ?2, summary = ?3, updated_at = datetime('now') WHERE id = ?1",
        params![id, title, summary],
    )?;
    Ok(())
}

/// 更新 Episode 的 Wiki 状态（none / eligible / saved）。
pub fn update_episode_wiki_status(
    conn: &Connection,
    id: &str,
    wiki_status: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE clean_episodes SET wiki_status = ?2, updated_at = datetime('now') WHERE id = ?1",
        params![id, wiki_status],
    )?;
    Ok(())
}

/// 获取所有适合保存为 Wiki（wiki_eligible=1 且 wiki_status='eligible'）的 Episode。
pub fn get_eligible_episodes_for_wiki(conn: &Connection) -> rusqlite::Result<Vec<CleanEpisode>> {
    let sql = format!(
        "SELECT {EPISODE_COLS} FROM clean_episodes \
         WHERE wiki_eligible = 1 AND wiki_status = 'eligible' \
         ORDER BY date DESC, start_time DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![], CleanEpisode::from_row)?;
    rows.collect()
}

// ============================================================================
// memory_cells 表
// ============================================================================

/// 插入一条结构化记忆单元。
pub fn insert_memory_cell(conn: &Connection, mc: &MemoryCell) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO memory_cells (id, clean_episode_id, episode_text, facts, foresight, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            mc.id,
            mc.clean_episode_id,
            mc.episode_text,
            to_json(&mc.facts)?,
            to_json(&mc.foresight)?,
            mc.created_at
        ],
    )?;
    Ok(())
}

/// 获取某个 Episode 下的全部 MemoryCell。
pub fn get_memory_cells_by_episode(
    conn: &Connection,
    episode_id: &str,
) -> rusqlite::Result<Vec<MemoryCell>> {
    let sql = format!(
        "SELECT {MEMORY_CELL_COLS} FROM memory_cells WHERE clean_episode_id = ?1 ORDER BY created_at ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![episode_id], MemoryCell::from_row)?;
    rows.collect()
}

// ============================================================================
// embeddings 表
// ============================================================================

/// 插入一条语义向量。embedding 为 f32[] 序列化后的字节数组（Little-Endian）。
pub fn insert_embedding(conn: &Connection, emb: &Embedding) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO embeddings (id, memory_cell_id, embedding, model_version, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            emb.id,
            emb.memory_cell_id,
            emb.embedding,
            emb.model_version,
            emb.created_at
        ],
    )?;
    Ok(())
}

/// 获取全部向量（用于本地余弦检索的暴力扫描）。
pub fn get_all_embeddings(conn: &Connection) -> rusqlite::Result<Vec<Embedding>> {
    let sql = format!("SELECT {EMBEDDING_COLS} FROM embeddings ORDER BY created_at ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![], Embedding::from_row)?;
    rows.collect()
}

/// 按 MemoryCell ID 获取向量。
pub fn get_embedding_by_cell(
    conn: &Connection,
    cell_id: &str,
) -> rusqlite::Result<Option<Embedding>> {
    let sql = format!("SELECT {EMBEDDING_COLS} FROM embeddings WHERE memory_cell_id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![cell_id])?;
    match rows.next()? {
        Some(row) => Ok(Some(Embedding::from_row(row)?)),
        None => Ok(None),
    }
}

// ============================================================================
// distill_runs 表
// ============================================================================

/// 幂等写入蒸馏运行状态。以 (date, hour_bucket) 唯一索引为冲突键做 upsert。
pub fn upsert_distill_run(conn: &Connection, run: &DistillRun) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO distill_runs (id, date, hour_bucket, status, segment_count, error_message, model_name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(date, hour_bucket) DO UPDATE SET
           status = excluded.status,
           segment_count = excluded.segment_count,
           error_message = excluded.error_message,
           model_name = excluded.model_name,
           updated_at = excluded.updated_at",
        params![
            run.id,
            run.date,
            run.hour_bucket,
            run.status,
            run.segment_count,
            run.error_message,
            run.model_name,
            run.created_at,
            run.updated_at
        ],
    )?;
    Ok(())
}

/// 按 (date, hour_bucket) 获取蒸馏运行记录。
pub fn get_distill_run(
    conn: &Connection,
    date: &str,
    hour_bucket: &str,
) -> rusqlite::Result<Option<DistillRun>> {
    let sql = format!(
        "SELECT {DISTILL_RUN_COLS} FROM distill_runs WHERE date = ?1 AND hour_bucket = ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![date, hour_bucket])?;
    match rows.next()? {
        Some(row) => Ok(Some(DistillRun::from_row(row)?)),
        None => Ok(None),
    }
}

/// 获取某天所有 status='pending' 的小时桶（待蒸馏）。
pub fn get_pending_distill_hours(conn: &Connection, date: &str) -> rusqlite::Result<Vec<DistillRun>> {
    let sql = format!(
        "SELECT {DISTILL_RUN_COLS} FROM distill_runs \
         WHERE date = ?1 AND status = 'pending' ORDER BY hour_bucket ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date], DistillRun::from_row)?;
    rows.collect()
}

// ============================================================================
// wiki_pages 表
// ============================================================================

/// 插入一条 Wiki 页面。触发器 trg_wiki_ai 自动同步 FTS5 索引。
pub fn insert_wiki_page(conn: &Connection, page: &WikiPage) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO wiki_pages (id, title, content, source_type, source_episode_id, status, tags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            page.id,
            page.title,
            page.content,
            page.source_type,
            page.source_episode_id,
            page.status,
            to_json(&page.tags)?,
            page.created_at,
            page.updated_at
        ],
    )?;
    Ok(())
}

/// 获取最近更新的 Wiki 列表（分页）。
pub fn get_wiki_pages(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<WikiPage>> {
    let sql = format!(
        "SELECT {WIKI_COLS} FROM wiki_pages ORDER BY updated_at DESC LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit], WikiPage::from_row)?;
    rows.collect()
}

/// 按 ID 获取 Wiki 页面。
pub fn get_wiki_page(conn: &Connection, id: &str) -> rusqlite::Result<Option<WikiPage>> {
    let sql = format!("SELECT {WIKI_COLS} FROM wiki_pages WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => Ok(Some(WikiPage::from_row(row)?)),
        None => Ok(None),
    }
}

/// 按标题精确获取 Wiki 页面（用于双链解析 [[标题]]）。
pub fn get_wiki_page_by_title(
    conn: &Connection,
    title: &str,
) -> rusqlite::Result<Option<WikiPage>> {
    let sql = format!("SELECT {WIKI_COLS} FROM wiki_pages WHERE title = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![title])?;
    match rows.next()? {
        Some(row) => Ok(Some(WikiPage::from_row(row)?)),
        None => Ok(None),
    }
}

/// 更新 Wiki 页面字段。触发器 trg_wiki_au 自动同步 FTS5 索引。
pub fn update_wiki_page(conn: &Connection, page: &WikiPage) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE wiki_pages SET title = ?2, content = ?3, source_type = ?4, source_episode_id = ?5, status = ?6, tags = ?7, updated_at = datetime('now') WHERE id = ?1",
        params![
            page.id,
            page.title,
            page.content,
            page.source_type,
            page.source_episode_id,
            page.status,
            to_json(&page.tags)?
        ],
    )?;
    Ok(())
}

/// 反向链接检索：查找 content 中包含 `[[title]]` 的 Wiki 页面。
pub fn search_wiki_backlinks(
    conn: &Connection,
    title: &str,
) -> rusqlite::Result<Vec<WikiPage>> {
    let pattern = format!("%[[{}]]%", title);
    let sql = format!(
        "SELECT {WIKI_COLS} FROM wiki_pages WHERE content LIKE ?1 ORDER BY updated_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![pattern], WikiPage::from_row)?;
    rows.collect()
}

// ============================================================================
// reports 表
// ============================================================================

/// 插入一条工作报告。
pub fn insert_report(conn: &Connection, report: &WorkReport) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO reports (id, date, report_type, template, title, content, status, model_name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            report.id,
            report.date,
            report.report_type,
            report.template,
            report.title,
            report.content,
            report.status,
            report.model_name,
            report.created_at,
            report.updated_at
        ],
    )?;
    Ok(())
}

/// 获取某天的全部报告。
pub fn get_reports_by_date(conn: &Connection, date: &str) -> rusqlite::Result<Vec<WorkReport>> {
    let sql = format!(
        "SELECT {REPORT_COLS} FROM reports WHERE date = ?1 ORDER BY created_at ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date], WorkReport::from_row)?;
    rows.collect()
}

/// 按 ID 获取报告。
pub fn get_report_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<WorkReport>> {
    let sql = format!("SELECT {REPORT_COLS} FROM reports WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => Ok(Some(WorkReport::from_row(row)?)),
        None => Ok(None),
    }
}

// ============================================================================
// privacy_rules 表
// ============================================================================

/// 获取所有启用的隐私规则（enabled = 1）。
pub fn get_active_privacy_rules(conn: &Connection) -> rusqlite::Result<Vec<PrivacyRule>> {
    let sql = format!(
        "SELECT {PRIVACY_RULE_COLS} FROM privacy_rules WHERE enabled = 1 ORDER BY created_at ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![], PrivacyRule::from_row)?;
    rows.collect()
}

/// 插入一条隐私规则。
pub fn insert_privacy_rule(conn: &Connection, rule: &PrivacyRule) -> rusqlite::Result<()> {
    let enabled = i32::from(rule.enabled);
    conn.execute(
        "INSERT INTO privacy_rules (id, rule_type, pattern, enabled, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![rule.id, rule.rule_type, rule.pattern, enabled, rule.created_at],
    )?;
    Ok(())
}

// ============================================================================
// settings 表
// ============================================================================

/// 读取 AppSetting。若 key='app' 不存在则返回 Default。
/// 附带从 settings 表 key='openai_api_key' 读取 API Key 并填充到
/// `AppSetting.openai_api_key`（与 app JSON 解耦存储，见 models.rs 注释）。
pub fn get_settings(conn: &Connection) -> rusqlite::Result<AppSetting> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'app'",
            params![],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let mut settings = match value {
        Some(json) => parse_json::<AppSetting>(&json)?,
        None => AppSetting::default(),
    };
    // 附带读 openai_api_key（独立 key 存储，非空时覆盖）
    let key: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'openai_api_key'",
            params![],
            |row| row.get::<_, String>(0),
        )
        .ok();
    if let Some(k) = key {
        if !k.is_empty() {
            settings.openai_api_key = Some(k);
        }
    }
    Ok(settings)
}

/// 更新 AppSetting（upsert key='app'）。
pub fn update_settings(conn: &Connection, settings: &AppSetting) -> rusqlite::Result<()> {
    let json = to_json(settings)?;
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES ('app', ?1, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![json],
    )?;
    Ok(())
}

// ============================================================================
// user_preferences 表 (KV 偏好，Task 24.1/24.4 使用)
// ============================================================================

/// 读取一个用户偏好；不存在返回 None。
pub fn get_preference(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let v: Option<String> = conn
        .query_row(
            "SELECT value FROM user_preferences WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(v)
}

/// 写入（upsert）一个用户偏好。
pub fn set_preference(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO user_preferences (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value],
    )?;
    Ok(())
}

/// 读取布尔偏好（"true"/"1" 视为真；不存在或解析失败返回 default）。
pub fn get_preference_bool(conn: &Connection, key: &str, default: bool) -> bool {
    match get_preference(conn, key) {
        Ok(Some(v)) => v == "true" || v == "1",
        _ => default,
    }
}

// ============================================================================
// FTS5 全文检索
// ============================================================================

/// segments 全文检索：返回 (rowid, snippet, highlight, rank)。
/// snippet 取自 ocr_text 列（FTS 列索引 0），用 '==' 标记命中词。
/// highlight 取整列原文并在命中处用 '==' 标记，适合作为 SearchResult.primary_text
/// 以支持"高亮反查"用例。
pub fn search_segments_fts(
    conn: &Connection,
    query: &str,
    limit: i64,
) -> rusqlite::Result<Vec<(i64, String, String, f64)>> {
    let mut stmt = conn.prepare(
        "SELECT rowid, snippet(fts_segments, 0, '==', '==', '...', 10) AS snippet, \
         highlight(fts_segments, 0, '==', '==') AS highlight_text, rank \
         FROM fts_segments WHERE fts_segments MATCH ?1 ORDER BY rank LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![query, limit], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, f64>(3)?,
        ))
    })?;
    rows.collect()
}

/// clean_episodes 全文检索：snippet 取自 summary 列（FTS 列索引 1）。
pub fn search_episodes_fts(
    conn: &Connection,
    query: &str,
    limit: i64,
) -> rusqlite::Result<Vec<(i64, String, f64)>> {
    let mut stmt = conn.prepare(
        "SELECT rowid, snippet(fts_clean_episodes, 1, '==', '==', '...', 10) AS snippet, rank \
         FROM fts_clean_episodes WHERE fts_clean_episodes MATCH ?1 ORDER BY rank LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![query, limit], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
    })?;
    rows.collect()
}

/// wiki_pages 全文检索：snippet 取自 content 列（FTS 列索引 1）。
pub fn search_wiki_fts(
    conn: &Connection,
    query: &str,
    limit: i64,
) -> rusqlite::Result<Vec<(i64, String, f64)>> {
    let mut stmt = conn.prepare(
        "SELECT rowid, snippet(fts_wiki, 1, '==', '==', '...', 10) AS snippet, rank \
         FROM fts_wiki WHERE fts_wiki MATCH ?1 ORDER BY rank LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![query, limit], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
    })?;
    rows.collect()
}

/// 统一记忆检索：合并 segments / clean_episodes / wiki_pages 三表 FTS5 命中，
/// 映射为 SearchResult（source_type 分别为 "segment"/"episode"/"wiki"，
/// match_reason 分别为 "OCR命中"/"语义命中"/"Wiki关联"）。
///
/// date_range 为 Some((start_date, end_date)) 时按 YYYY-MM-DD 字符串比较过滤
/// segments 与 episodes；wiki 无日期列，始终纳入。
///
/// score 归一化：FTS5 rank 为负值（越小越相关），转为 `1.0 / (1.0 + (-rank))`
/// 得到 0-1 之间正值，与向量 cosine similarity 量纲一致（越高越相关）。
/// 结果按 score 降序排列（最相关在前）。
pub fn search_memories(
    conn: &Connection,
    query: &str,
    date_range: Option<(String, String)>,
) -> rusqlite::Result<Vec<SearchResult>> {
    let limit: i64 = 50;
    let mut results: Vec<SearchResult> = Vec::new();

    // 1. segments
    for (rowid, snippet, highlight, rank) in search_segments_fts(conn, query, limit)? {
        let seg: Option<WorkSegment> = conn
            .query_row(
                &format!("SELECT {SEGMENT_COLS} FROM segments WHERE rowid = ?1"),
                params![rowid],
                WorkSegment::from_row,
            )
            .ok();
        if let Some(seg) = seg {
            if let Some((ref start, ref end)) = date_range {
                if seg.date.as_str() < start.as_str() || seg.date.as_str() > end.as_str() {
                    continue;
                }
            }
            // primary_text 优先使用 highlight（含 == 命中标记），为空时回退到窗口标题/应用名
            let primary_text = if !highlight.is_empty() {
                highlight
            } else if !seg.window_title.is_empty() {
                seg.window_title.clone()
            } else {
                seg.app_name.clone()
            };
            results.push(SearchResult {
                source_id: seg.id.clone(),
                source_type: "segment".to_string(),
                date: seg.date.clone(),
                time_range: format!("{} - {}", seg.start_time, seg.end_time),
                primary_text,
                snippet,
                score: normalize_fts_rank(rank),
                match_reason: "OCR命中".to_string(),
            });
        }
    }

    // 2. clean_episodes
    for (rowid, snippet, rank) in search_episodes_fts(conn, query, limit)? {
        let ep: Option<CleanEpisode> = conn
            .query_row(
                &format!("SELECT {EPISODE_COLS} FROM clean_episodes WHERE rowid = ?1"),
                params![rowid],
                CleanEpisode::from_row,
            )
            .ok();
        if let Some(ep) = ep {
            if let Some((ref start, ref end)) = date_range {
                if ep.date.as_str() < start.as_str() || ep.date.as_str() > end.as_str() {
                    continue;
                }
            }
            results.push(SearchResult {
                source_id: ep.id.clone(),
                source_type: "episode".to_string(),
                date: ep.date.clone(),
                time_range: format!("{} - {}", ep.start_time, ep.end_time),
                primary_text: if ep.title.is_empty() {
                    ep.summary.clone()
                } else {
                    ep.title.clone()
                },
                snippet,
                score: normalize_fts_rank(rank),
                match_reason: "语义命中".to_string(),
            });
        }
    }

    // 3. wiki_pages (无日期列，不做 date_range 过滤)
    for (rowid, snippet, rank) in search_wiki_fts(conn, query, limit)? {
        let page: Option<WikiPage> = conn
            .query_row(
                &format!("SELECT {WIKI_COLS} FROM wiki_pages WHERE rowid = ?1"),
                params![rowid],
                WikiPage::from_row,
            )
            .ok();
        if let Some(page) = page {
            results.push(SearchResult {
                source_id: page.id.clone(),
                source_type: "wiki".to_string(),
                date: page.updated_at.clone(),
                time_range: String::new(),
                primary_text: page.title.clone(),
                snippet,
                score: normalize_fts_rank(rank),
                match_reason: "Wiki关联".to_string(),
            });
        }
    }

    // 归一化后 score 越大越相关 → 降序排列，最相关在前
    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(results)
}

/// FTS5 rank 归一化：rank 为负值（BM25，越小越相关），转为
/// `1.0 / (1.0 + (-rank))`，得到 0-1 之间正值（越高越相关），
/// 与向量 cosine similarity 量纲一致。对非负 rank（异常值）按 0 处理。
fn normalize_fts_rank(rank: f64) -> f32 {
    let neg = if rank < 0.0 { -rank } else { 0.0 };
    (1.0 / (1.0 + neg)) as f32
}
