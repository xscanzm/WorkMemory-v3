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
use crate::models::FocusSession;

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
}
