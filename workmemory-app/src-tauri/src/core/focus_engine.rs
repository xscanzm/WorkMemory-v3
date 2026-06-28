//! 专注引擎：番茄钟/自由计时 + 会话持久化 + 事件发布
//!
//! 严格遵循 analysis_results.md 优化 13 要求：
//! - 专注会话开始 → 落库 focus_sessions（planned duration）
//! - 正常完成 → 写 end_time + actual duration，发布 FocusCompleted 事件，
//!   触发 PetEngine 衍生计算（+20 XP/+10 energy）
//! - 中断 → 记录中断原因（interrupted=1）
use rusqlite::Connection;
use crate::core::error::{AppError, AppResult};
use crate::core::event_bus::{global_event_bus, AppEvent};
use crate::core::pet_engine;
use crate::models::{self, FocusSession};

/// 开始专注会话（仅记录开始，返回带 id 的 session）
pub fn start_focus_session(conn: &Connection, session_type: &str, task_id: Option<&str>, planned_duration: i64) -> AppResult<FocusSession> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now();
    let start_time = now.format("%+").to_string();
    let created_at = start_time.clone();
    let session = FocusSession {
        id: id.clone(),
        start_time,
        end_time: None,
        duration_seconds: planned_duration, // planned; updated on stop
        r#type: session_type.to_string(),
        task_id: task_id.map(|s| s.to_string()),
        interrupted: false,
        interruption_reason: String::new(),
        created_at,
    };
    conn.execute(
        "INSERT INTO focus_sessions (id, start_time, end_time, duration_seconds, type, task_id, interrupted, interruption_reason, created_at)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5, 0, '', ?6)",
        rusqlite::params![session.id, session.start_time, session.duration_seconds, session.r#type, session.task_id, session.created_at],
    )?;
    Ok(session)
}

/// 正常完成专注会话：写 end_time + actual duration，发布 FocusCompleted 事件，触发 PetEngine 衍生计算
pub fn complete_focus_session(conn: &Connection, session_id: &str, actual_duration: i64) -> AppResult<FocusSession> {
    let now = chrono::Local::now().format("%+").to_string();
    let affected = conn.execute(
        "UPDATE focus_sessions SET end_time = ?1, duration_seconds = ?2, interrupted = 0 WHERE id = ?3",
        rusqlite::params![now, actual_duration, session_id],
    )?;
    if affected == 0 {
        return Err(AppError::not_found(format!("专注会话不存在: {}", session_id)));
    }
    let session = get_focus_session(conn, session_id)?;
    // 发布事件 → AnalyticsEngine 累加 focus_time（best-effort）
    global_event_bus().publish(AppEvent::FocusCompleted { focus_seconds: actual_duration });
    // 触发宠物 XP/energy 增长（pet 可选；未初始化时 on_focus_completed 返回 Err，忽略）
    let _ = pet_engine::on_focus_completed(conn);
    // 累加 daily_stats.total_focus_time（best-effort，与 pet_engine 一致）
    let _ = crate::core::analytics_engine::on_focus_completed(conn, actual_duration);
    Ok(session)
}

/// 中断专注会话：记录中断原因
pub fn interrupt_focus_session(conn: &Connection, session_id: &str, actual_duration: i64, reason: &str) -> AppResult<FocusSession> {
    let now = chrono::Local::now().format("%+").to_string();
    let affected = conn.execute(
        "UPDATE focus_sessions SET end_time = ?1, duration_seconds = ?2, interrupted = 1, interruption_reason = ?3 WHERE id = ?4",
        rusqlite::params![now, actual_duration, reason, session_id],
    )?;
    if affected == 0 {
        return Err(AppError::not_found(format!("专注会话不存在: {}", session_id)));
    }
    get_focus_session(conn, session_id)
}

/// 查询单个会话
pub fn get_focus_session(conn: &Connection, session_id: &str) -> AppResult<FocusSession> {
    conn.query_row(
        "SELECT id, start_time, end_time, duration_seconds, type, task_id, interrupted, interruption_reason, created_at FROM focus_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        row_to_session,
    ).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::not_found(format!("专注会话不存在: {}", session_id)),
        other => AppError::DbError(other.to_string()),
    })
}

/// 查询今日所有专注会话
pub fn get_today_focus_sessions(conn: &Connection) -> AppResult<Vec<FocusSession>> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut stmt = conn.prepare(
        "SELECT id, start_time, end_time, duration_seconds, type, task_id, interrupted, interruption_reason, created_at FROM focus_sessions WHERE substr(start_time, 1, 10) = ?1 ORDER BY start_time DESC"
    )?;
    let sessions = stmt.query_map(rusqlite::params![today], row_to_session)?.filter_map(|r| r.ok()).collect();
    Ok(sessions)
}

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<FocusSession> {
    Ok(FocusSession {
        id: row.get(0)?,
        start_time: row.get(1)?,
        end_time: row.get(2)?,
        duration_seconds: row.get(3)?,
        r#type: row.get(4)?,
        task_id: row.get(5)?,
        interrupted: row.get::<_, i32>(6)? != 0,
        interruption_reason: row.get(7)?,
        created_at: row.get(8)?,
    })
}

/// 构建专注会话总结（Task 18 - SessionSummaryCard 后端聚合）
///
/// 聚合 focus_sessions / segments / tasks / achievements 四张表：
/// 1. 从 focus_sessions 读取会话基础信息（开始/结束/计划/实际时长）
/// 2. 从 segments 读取会话时间窗口内的应用时长分布（GROUP BY process_name）
/// 3. 计算注意力流失点：检测 60s 窗口内应用切换 >= 3 次的时段
/// 4. 从 tasks 读取关联任务（focus_sessions.task_id）
/// 5. 从 achievements 读取会话期间解锁的成就
pub fn build_session_summary(
    conn: &Connection,
    session_id: &str,
) -> AppResult<models::SessionSummary> {
    // 1. 读取会话基础信息
    let session = get_focus_session(conn, session_id)?;
    let started_at = session.start_time.clone();
    let ended_at = session.end_time.clone().unwrap_or_else(|| {
        chrono::Local::now().format("%+").to_string()
    });
    // duration_seconds 在 complete 时被覆写为实际时长；planned 不可恢复，两者均用此值
    let actual_focus_seconds = session.duration_seconds;
    let planned_duration_seconds = session.duration_seconds;

    // 2. 应用时长分布：从 segments 表按 process_name 聚合
    // segments.date 为 YYYY-MM-DD（取 RFC3339 前 10 字符）
    // segments.start_time 为 HH:MM:SS（取 RFC3339 第 11-19 字符）
    let session_date = started_at.get(..10).unwrap_or("").to_string();
    let session_start_hms = started_at.get(11..19).unwrap_or("00:00:00").to_string();
    let session_end_hms = ended_at.get(11..19).unwrap_or("23:59:59").to_string();

    let mut app_map: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    if !session_date.is_empty() {
        let mut stmt = conn
            .prepare(
                "SELECT COALESCE(NULLIF(process_name, ''), app_name) AS app, \
                        SUM(duration_seconds) \
                 FROM segments \
                 WHERE date = ?1 AND is_deleted = 0 AND is_private = 0 \
                   AND start_time >= ?2 AND start_time <= ?3 \
                 GROUP BY app ORDER BY SUM(duration_seconds) DESC",
            )
            .map_err(|e| AppError::DbError(e.to_string()))?;
        let rows: Vec<(String, i64)> = stmt
            .query_map(
                rusqlite::params![session_date, session_start_hms, session_end_hms],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .map_err(|e| AppError::DbError(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();
        for (app, secs) in rows {
            *app_map.entry(app).or_insert(0) += secs;
        }
    }
    let total_app_seconds: i64 = app_map.values().sum();
    let app_distribution: Vec<models::AppTimeSlice> = {
        let mut entries: Vec<(String, i64)> = app_map.into_iter().collect();
        entries.sort_by(|a, b| b.1.cmp(&a.1));
        entries
            .into_iter()
            .take(5)
            .map(|(app_name, duration_seconds)| {
                let percentage = if total_app_seconds > 0 {
                    (duration_seconds as f64 / total_app_seconds as f64) * 100.0
                } else {
                    0.0
                };
                models::AppTimeSlice {
                    app_name,
                    duration_seconds,
                    percentage,
                }
            })
            .collect()
    };

    // 3. 注意力流失点：读取会话窗口内的 segments 时间序列，检测 60s 内切换 >= 3 次的窗口
    let attention_loss_points = detect_attention_loss_points(
        conn,
        &session_date,
        &session_start_hms,
        &session_end_hms,
    )?;

    // 4. 关联任务
    let related_task = if let Some(ref tid) = session.task_id {
        conn.query_row(
            "SELECT id, title, status FROM tasks WHERE id = ?1",
            rusqlite::params![tid],
            |row| {
                Ok(models::RelatedTaskInfo {
                    task_id: row.get::<_, String>(0)?,
                    task_title: row.get::<_, String>(1)?,
                    completed: row.get::<_, String>(2)? == "completed",
                })
            },
        )
        .ok()
    } else {
        None
    };

    // 5. 会话期间解锁的成就
    let mut unlocked: Vec<String> = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT id FROM achievements \
             WHERE unlocked = 1 AND unlocked_at IS NOT NULL \
               AND unlocked_at >= ?1 AND unlocked_at <= ?2",
        )
        .map_err(|e| AppError::DbError(e.to_string()))?;
    let rows: Vec<String> = stmt
        .query_map(
            rusqlite::params![started_at, ended_at],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| AppError::DbError(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();
    unlocked.extend(rows);

    Ok(models::SessionSummary {
        session_id: session.id,
        started_at,
        ended_at,
        planned_duration_seconds,
        actual_focus_seconds,
        // focus_sessions 表未持久化暂停信息，前端 store 可单独追踪；此处返回 0
        pause_count: 0,
        pause_total_seconds: 0,
        app_distribution,
        attention_loss_points,
        related_task,
        achievements_unlocked: unlocked,
    })
}

/// 检测注意力流失点：60s 滑动窗口内应用切换 >= 3 次记为一次流失点
fn detect_attention_loss_points(
    conn: &Connection,
    session_date: &str,
    session_start_hms: &str,
    session_end_hms: &str,
) -> AppResult<Vec<models::AttentionLossPoint>> {
    if session_date.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT start_time, end_time, duration_seconds, \
                    COALESCE(NULLIF(process_name, ''), app_name) AS app \
             FROM segments \
             WHERE date = ?1 AND is_deleted = 0 AND is_private = 0 \
               AND start_time >= ?2 AND start_time <= ?3 \
             ORDER BY start_time ASC",
        )
        .map_err(|e| AppError::DbError(e.to_string()))?;
    // (start_hms, end_hms, duration_seconds, app)
    let rows: Vec<(String, String, i64, String)> = stmt
        .query_map(
            rusqlite::params![session_date, session_start_hms, session_end_hms],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|e| AppError::DbError(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    let mut points: Vec<models::AttentionLossPoint> = Vec::new();
    if rows.len() < 3 {
        return Ok(points);
    }
    // 60s 滑动窗口：以 segment 开始时间为锚，检测窗口内不同应用数 >= 3
    let window_seconds: i64 = 60;
    let threshold: usize = 3;
    let mut i = 0;
    while i < rows.len() {
        let (start_hms, _, _, _) = &rows[i];
        let start_secs = hms_to_seconds(start_hms);
        // 收集窗口内的 segments
        let mut window_apps: Vec<(i64, String)> = Vec::new();
        let mut j = i;
        while j < rows.len() {
            let (s_hms, _, _dur, app) = &rows[j];
            let s_secs = hms_to_seconds(s_hms);
            if s_secs - start_secs > window_seconds {
                break;
            }
            window_apps.push((s_secs, app.clone()));
            j += 1;
        }
        // 统计窗口内不同应用数
        let mut distinct: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for (_, app) in &window_apps {
            distinct.insert(app.as_str());
        }
        if distinct.len() >= threshold {
            // 流失点：从窗口起点持续到最后一个 segment 的结束
            let last_idx = window_apps.len().saturating_sub(1);
            let loss_start = window_apps.first().map(|(s, _)| *s).unwrap_or(start_secs);
            let loss_end = window_apps
                .get(last_idx)
                .map(|(s, _)| *s)
                .unwrap_or(start_secs)
                + rows[i + last_idx].2;
            let duration = (loss_end - loss_start).max(0);
            // timestamp 用 session_date + start_hms 拼成简化 RFC3339
            let ts = format!("{}T{}+00:00", session_date, start_hms);
            points.push(models::AttentionLossPoint {
                timestamp: ts,
                reason: "应用切换频繁".to_string(),
                duration_seconds: duration,
            });
            // 跳过已处理窗口，避免重复检测
            i = j;
        } else {
            i += 1;
        }
    }
    Ok(points)
}

/// HH:MM:SS → 当日累计秒数
fn hms_to_seconds(hms: &str) -> i64 {
    let parts: Vec<i64> = hms.split(':').filter_map(|p| p.parse().ok()).collect();
    match parts.len() {
        3 => parts[0] * 3600 + parts[1] * 60 + parts[2],
        2 => parts[0] * 60 + parts[1],
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE focus_sessions (id TEXT PRIMARY KEY, start_time TEXT, end_time TEXT, duration_seconds INTEGER, type TEXT, task_id TEXT, interrupted INTEGER, interruption_reason TEXT, created_at TEXT)").unwrap();
        conn
    }
    #[test]
    fn start_and_complete_session() {
        let conn = in_memory_db();
        let s = start_focus_session(&conn, "pomodoro", None, 1500).unwrap();
        assert_eq!(s.r#type, "pomodoro");
        let completed = complete_focus_session(&conn, &s.id, 1500).unwrap();
        assert!(!completed.interrupted);
        assert!(completed.end_time.is_some());
    }
    #[test]
    fn interrupt_session_sets_reason() {
        let conn = in_memory_db();
        let s = start_focus_session(&conn, "free", None, 600).unwrap();
        let interrupted = interrupt_focus_session(&conn, &s.id, 300, "电话打断").unwrap();
        assert!(interrupted.interrupted);
        assert_eq!(interrupted.interruption_reason, "电话打断");
    }
    #[test]
    fn complete_nonexistent_returns_not_found() {
        let conn = in_memory_db();
        assert!(complete_focus_session(&conn, "nonexistent", 100).is_err());
    }

    // ---- hms_to_seconds 纯函数测试 ----

    #[test]
    fn hms_to_seconds_parses_three_parts() {
        assert_eq!(hms_to_seconds("01:02:03"), 3723);
        assert_eq!(hms_to_seconds("00:00:00"), 0);
        assert_eq!(hms_to_seconds("23:59:59"), 86399);
    }

    #[test]
    fn hms_to_seconds_parses_two_parts() {
        assert_eq!(hms_to_seconds("05:30"), 330);
        assert_eq!(hms_to_seconds("00:30"), 30);
    }

    #[test]
    fn hms_to_seconds_invalid_returns_zero() {
        assert_eq!(hms_to_seconds(""), 0);
        assert_eq!(hms_to_seconds("invalid"), 0);
    }

    // ---- detect_attention_loss_points 测试 ----

    /// 完整内存数据库：focus_sessions + segments + tasks + achievements
    fn full_in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE focus_sessions (id TEXT PRIMARY KEY, start_time TEXT, end_time TEXT, duration_seconds INTEGER, type TEXT, task_id TEXT, interrupted INTEGER, interruption_reason TEXT, created_at TEXT);\
             CREATE TABLE segments (id TEXT PRIMARY KEY, date TEXT, start_time TEXT, end_time TEXT, duration_seconds INTEGER, app_name TEXT, process_name TEXT, window_title TEXT, ocr_text TEXT, ocr_status TEXT, image_hash TEXT, screenshot_path TEXT, is_important INTEGER, is_private INTEGER, is_deleted INTEGER, capture_source TEXT, browser_url TEXT, activity_type TEXT, created_at TEXT);\
             CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, updated_at TEXT);\
             CREATE TABLE achievements (id TEXT PRIMARY KEY, title TEXT, description TEXT, icon TEXT, unlocked INTEGER, unlocked_at TEXT, created_at TEXT);\
             CREATE TABLE pet_state (id TEXT PRIMARY KEY, species TEXT, level INTEGER, xp INTEGER, hunger INTEGER, energy INTEGER, happiness INTEGER, cleanliness INTEGER, bond_level INTEGER, mood TEXT, last_updated TEXT);\
             CREATE TABLE daily_stats (date TEXT PRIMARY KEY, tasks_completed INTEGER, total_focus_time INTEGER, streak_count INTEGER, created_at TEXT, updated_at TEXT);",
        )
        .unwrap();
        conn
    }

    fn insert_segment(conn: &Connection, id: &str, date: &str, start: &str, end: &str, dur: i64, app: &str) {
        conn.execute(
            "INSERT INTO segments (id, date, start_time, end_time, duration_seconds, app_name, process_name, window_title, ocr_text, ocr_status, image_hash, screenshot_path, is_important, is_private, is_deleted, capture_source, browser_url, activity_type, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, '', '', 'done', '', '', 0, 0, 0, 'auto', NULL, NULL, '')",
            rusqlite::params![id, date, start, end, dur, app],
        )
        .unwrap();
    }

    #[test]
    fn detect_attention_loss_points_empty_when_no_segments() {
        let conn = full_in_memory_db();
        let points = detect_attention_loss_points(&conn, "2026-06-26", "10:00:00", "11:00:00").unwrap();
        assert!(points.is_empty());
    }

    #[test]
    fn detect_attention_loss_points_empty_when_few_switches() {
        let conn = full_in_memory_db();
        // 仅 2 个 segment — 低于阈值 3
        insert_segment(&conn, "seg-1", "2026-06-26", "10:00:00", "10:05:00", 300, "VSCode");
        insert_segment(&conn, "seg-2", "2026-06-26", "10:05:00", "10:10:00", 300, "Chrome");
        let points = detect_attention_loss_points(&conn, "2026-06-26", "10:00:00", "11:00:00").unwrap();
        assert!(points.is_empty());
    }

    #[test]
    fn detect_attention_loss_points_detects_frequent_switches() {
        let conn = full_in_memory_db();
        // 60s 内 3 个不同应用 → 流失点
        insert_segment(&conn, "seg-1", "2026-06-26", "10:00:00", "10:00:20", 20, "VSCode");
        insert_segment(&conn, "seg-2", "2026-06-26", "10:00:20", "10:00:40", 20, "Chrome");
        insert_segment(&conn, "seg-3", "2026-06-26", "10:00:40", "10:01:00", 20, "Slack");
        let points = detect_attention_loss_points(&conn, "2026-06-26", "10:00:00", "11:00:00").unwrap();
        assert_eq!(points.len(), 1, "应在 60s 内 3 应用切换处检测到 1 个流失点");
        assert_eq!(points[0].reason, "应用切换频繁");
        assert!(points[0].duration_seconds > 0);
    }

    #[test]
    fn detect_attention_loss_points_empty_date_returns_empty() {
        let conn = full_in_memory_db();
        let points = detect_attention_loss_points(&conn, "", "10:00:00", "11:00:00").unwrap();
        assert!(points.is_empty());
    }

    // ---- build_session_summary 测试 ----

    #[test]
    fn build_session_summary_returns_basic_info() {
        let conn = full_in_memory_db();
        conn.execute(
            "INSERT INTO focus_sessions (id, start_time, end_time, duration_seconds, type, task_id, interrupted, interruption_reason, created_at) \
             VALUES ('s1', '2026-06-26T10:00:00+08:00', '2026-06-26T10:25:00+08:00', 1500, 'pomodoro', NULL, 0, '', '2026-06-26T10:00:00+08:00')",
            [],
        )
        .unwrap();
        let summary = build_session_summary(&conn, "s1").unwrap();
        assert_eq!(summary.session_id, "s1");
        assert_eq!(summary.actual_focus_seconds, 1500);
        assert_eq!(summary.planned_duration_seconds, 1500);
        assert_eq!(summary.pause_count, 0);
        assert!(summary.app_distribution.is_empty());
        assert!(summary.related_task.is_none());
    }

    #[test]
    fn build_session_summary_aggregates_app_distribution_and_percentages() {
        let conn = full_in_memory_db();
        conn.execute(
            "INSERT INTO focus_sessions (id, start_time, end_time, duration_seconds, type, task_id, interrupted, interruption_reason, created_at) \
             VALUES ('s1', '2026-06-26T10:00:00+08:00', '2026-06-26T10:25:00+08:00', 1500, 'pomodoro', NULL, 0, '', '2026-06-26T10:00:00+08:00')",
            [],
        )
        .unwrap();
        insert_segment(&conn, "seg-1", "2026-06-26", "10:00:00", "10:15:00", 900, "VSCode");
        insert_segment(&conn, "seg-2", "2026-06-26", "10:15:00", "10:25:00", 600, "Chrome");
        let summary = build_session_summary(&conn, "s1").unwrap();
        assert_eq!(summary.app_distribution.len(), 2);
        // 降序：VSCode (900s) 在前
        assert_eq!(summary.app_distribution[0].app_name, "VSCode");
        assert_eq!(summary.app_distribution[0].duration_seconds, 900);
        // 百分比：900/1500 = 60%
        assert!((summary.app_distribution[0].percentage - 60.0).abs() < 1e-9);
        assert!((summary.app_distribution[1].percentage - 40.0).abs() < 1e-9);
    }

    #[test]
    fn build_session_summary_returns_related_task() {
        let conn = full_in_memory_db();
        conn.execute(
            "INSERT INTO tasks (id, title, status) VALUES ('t1', '写周报', 'in_progress')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO focus_sessions (id, start_time, end_time, duration_seconds, type, task_id, interrupted, interruption_reason, created_at) \
             VALUES ('s1', '2026-06-26T10:00:00+08:00', '2026-06-26T10:25:00+08:00', 1500, 'pomodoro', 't1', 0, '', '2026-06-26T10:00:00+08:00')",
            [],
        )
        .unwrap();
        let summary = build_session_summary(&conn, "s1").unwrap();
        let task = summary.related_task.expect("应有关联任务");
        assert_eq!(task.task_id, "t1");
        assert_eq!(task.task_title, "写周报");
        assert!(!task.completed);
    }

    #[test]
    fn build_session_summary_collects_unlocked_achievements() {
        let conn = full_in_memory_db();
        conn.execute(
            "INSERT INTO focus_sessions (id, start_time, end_time, duration_seconds, type, task_id, interrupted, interruption_reason, created_at) \
             VALUES ('s1', '2026-06-26T10:00:00+08:00', '2026-06-26T10:25:00+08:00', 1500, 'pomodoro', NULL, 0, '', '2026-06-26T10:00:00+08:00')",
            [],
        )
        .unwrap();
        // 会话期间解锁的成就
        conn.execute(
            "INSERT INTO achievements (id, title, description, icon, unlocked, unlocked_at, created_at) \
             VALUES ('first_task', '初出茅庐', '', '🌱', 1, '2026-06-26T10:10:00+08:00', '2026-06-26T10:00:00+08:00')",
            [],
        )
        .unwrap();
        // 会话开始前解锁的成就（不应出现）
        conn.execute(
            "INSERT INTO achievements (id, title, description, icon, unlocked, unlocked_at, created_at) \
             VALUES ('streak_7', '一周坚持', '', '🔥', 1, '2026-06-25T10:00:00+08:00', '2026-06-25T10:00:00+08:00')",
            [],
        )
        .unwrap();
        let summary = build_session_summary(&conn, "s1").unwrap();
        assert_eq!(summary.achievements_unlocked.len(), 1);
        assert_eq!(summary.achievements_unlocked[0], "first_task");
    }
}
