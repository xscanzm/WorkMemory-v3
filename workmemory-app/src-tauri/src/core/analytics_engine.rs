//! 分析引擎：连续天数 / 周报 / 生产力评分
//!
//! 严格遵循 analysis_results.md 优化 13 与 Task 15 要求：
//! - 与 stats_engine 分层：stats_engine 负责基础 get/save，本模块负责派生计算
//! - calculate_streak：从今日往前数连续有 completed 任务的日期数
//! - get_weekly_stats：最近 7 天每日统计（周报/趋势图数据源）
//! - on_task_completed / on_focus_completed：事件回调，upsert daily_stats
//! - productivity_score：综合任务数 + 专注时长的 0-100 评分

use rusqlite::Connection;

use crate::core::error::{AppError, AppResult};
use crate::models::DailyStats;

/// 计算连续打卡天数：从今日往前数，连续有 completed 任务的日期数
/// 今日若无完成则从昨日开始数（允许今日还没完成任务）
pub fn calculate_streak(conn: &Connection) -> AppResult<i64> {
    // 查询所有有 completed 任务的日期（distinct），按日期降序
    let mut stmt = conn.prepare(
        "SELECT DISTINCT substr(updated_at, 1, 10) AS d \
         FROM tasks WHERE status = 'completed' \
         ORDER BY d DESC",
    )?;
    let dates: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();
    if dates.is_empty() {
        return Ok(0);
    }
    // 从今日或昨日开始数连续；今日没完成且昨日也没完成则视为 streak 断裂
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let yesterday = (chrono::Local::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    let mut cursor = if dates.contains(&today) {
        today
    } else if dates.contains(&yesterday) {
        yesterday
    } else {
        return Ok(0);
    };
    let mut streak = 0i64;
    loop {
        if dates.contains(&cursor) {
            streak += 1;
            let d = chrono::NaiveDate::parse_from_str(&cursor, "%Y-%m-%d")
                .map_err(|e| AppError::internal(e.to_string()))?;
            cursor = (d - chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string();
        } else {
            break;
        }
    }
    Ok(streak)
}

/// 获取最近 7 天的每日统计（用于周报/趋势图）
/// 按日期升序返回，缺失日期不会补齐（前端可自行填充空槽）
pub fn get_weekly_stats(conn: &Connection) -> AppResult<Vec<DailyStats>> {
    let mut stmt = conn.prepare(
        "SELECT date, tasks_completed, total_focus_time, streak_count, created_at, updated_at \
         FROM daily_stats \
         WHERE date >= date('now', '-6 days') \
         ORDER BY date ASC",
    )?;
    let stats: Vec<DailyStats> = stmt
        .query_map([], |r| {
            Ok(DailyStats {
                date: r.get(0)?,
                tasks_completed: r.get(1)?,
                total_focus_time: r.get(2)?,
                streak_count: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(stats)
}

/// 任务完成时更新 daily_stats：递增 tasks_completed，重算 streak
/// 幂等 upsert：首次写入 INSERT，再次调用 ON CONFLICT 增量更新
pub fn on_task_completed(conn: &Connection) -> AppResult<DailyStats> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let now = chrono::Local::now().format("%+").to_string();
    // streak 重算（包含今日新完成的任务）
    let streak = calculate_streak(conn).unwrap_or(0);
    conn.execute(
        "INSERT INTO daily_stats (date, tasks_completed, total_focus_time, streak_count, created_at, updated_at) \
         VALUES (?1, 1, 0, ?2, ?3, ?3) \
         ON CONFLICT(date) DO UPDATE SET \
            tasks_completed = tasks_completed + 1, \
            streak_count = ?2, \
            updated_at = ?3",
        rusqlite::params![today, streak, now],
    )?;
    get_daily_stats(conn, &today)
}

/// 专注完成时更新 daily_stats：累加 total_focus_time（秒）
/// 幂等 upsert：由调用方保证 focus_seconds 不重复累加
pub fn on_focus_completed(conn: &Connection, focus_seconds: i64) -> AppResult<DailyStats> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let now = chrono::Local::now().format("%+").to_string();
    conn.execute(
        "INSERT INTO daily_stats (date, tasks_completed, total_focus_time, streak_count, created_at, updated_at) \
         VALUES (?1, 0, ?2, 0, ?3, ?3) \
         ON CONFLICT(date) DO UPDATE SET \
            total_focus_time = total_focus_time + ?2, \
            updated_at = ?3",
        rusqlite::params![today, focus_seconds, now],
    )?;
    get_daily_stats(conn, &today)
}

/// 生产力评分（0-100）：综合任务完成数 + 专注时长
/// 简单公式：任务数*10 + 专注分钟数，上限 100
pub fn productivity_score(conn: &Connection) -> AppResult<i64> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let stats = get_daily_stats(conn, &today).unwrap_or(DailyStats {
        date: today,
        tasks_completed: 0,
        total_focus_time: 0,
        streak_count: 0,
        created_at: String::new(),
        updated_at: String::new(),
    });
    let focus_minutes = stats.total_focus_time / 60;
    let score = (stats.tasks_completed * 10 + focus_minutes).min(100);
    Ok(score)
}

/// 查询指定日期的 daily_stats（不存在返回 NotFound）
pub fn get_daily_stats(conn: &Connection, date: &str) -> AppResult<DailyStats> {
    conn.query_row(
        "SELECT date, tasks_completed, total_focus_time, streak_count, created_at, updated_at \
         FROM daily_stats WHERE date = ?1",
        rusqlite::params![date],
        |r| {
            Ok(DailyStats {
                date: r.get(0)?,
                tasks_completed: r.get(1)?,
                total_focus_time: r.get(2)?,
                streak_count: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::not_found(format!("无统计数据: {}", date)),
        other => AppError::DbError(other.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 内存数据库：建 daily_stats + tasks（仅含 streak 查询所需字段）
    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE daily_stats (\
               date TEXT PRIMARY KEY NOT NULL,\
               tasks_completed INTEGER NOT NULL DEFAULT 0,\
               total_focus_time INTEGER NOT NULL DEFAULT 0,\
               streak_count INTEGER NOT NULL DEFAULT 0,\
               created_at TEXT NOT NULL,\
               updated_at TEXT NOT NULL\
             );\
             CREATE TABLE tasks (\
               id TEXT PRIMARY KEY NOT NULL,\
               title TEXT NOT NULL,\
               status TEXT NOT NULL DEFAULT 'inbox',\
               updated_at TEXT NOT NULL\
             );",
        )
        .unwrap();
        conn
    }

    /// 插入一条 completed 任务，updated_at 截断为指定日期前缀
    fn insert_completed_task(conn: &Connection, id: &str, date_prefix: &str) {
        conn.execute(
            "INSERT INTO tasks (id, title, status, updated_at) VALUES (?1, ?2, 'completed', ?3)",
            rusqlite::params![id, format!("task-{}", id), format!("{}T12:00:00+08:00", date_prefix)],
        )
        .unwrap();
    }

    #[test]
    fn calculate_streak_empty_db_returns_zero() {
        let conn = in_memory_db();
        assert_eq!(calculate_streak(&conn).unwrap(), 0);
    }

    #[test]
    fn calculate_streak_today_completed_returns_one() {
        let conn = in_memory_db();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        insert_completed_task(&conn, "t1", &today);
        assert_eq!(calculate_streak(&conn).unwrap(), 1);
    }

    #[test]
    fn calculate_streak_three_consecutive_days() {
        let conn = in_memory_db();
        let today = chrono::Local::now().date_naive();
        let d1 = (today - chrono::Duration::days(2)).format("%Y-%m-%d").to_string();
        let d2 = (today - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
        let d3 = today.format("%Y-%m-%d").to_string();
        insert_completed_task(&conn, "t1", &d1);
        insert_completed_task(&conn, "t2", &d2);
        insert_completed_task(&conn, "t3", &d3);
        assert_eq!(calculate_streak(&conn).unwrap(), 3);
    }

    #[test]
    fn calculate_streak_gap_breaks_chain() {
        // 今日完成 + 前天完成（缺昨天），streak 应为 1（仅今日）
        let conn = in_memory_db();
        let today = chrono::Local::now().date_naive();
        let d2 = (today - chrono::Duration::days(2)).format("%Y-%m-%d").to_string();
        let d3 = today.format("%Y-%m-%d").to_string();
        insert_completed_task(&conn, "t1", &d2);
        insert_completed_task(&conn, "t2", &d3);
        assert_eq!(calculate_streak(&conn).unwrap(), 1);
    }

    #[test]
    fn calculate_streak_only_yesterday_returns_one() {
        // 今日未完成、昨日完成 → streak=1（允许今日还没完成任务）
        let conn = in_memory_db();
        let yesterday = (chrono::Local::now() - chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();
        insert_completed_task(&conn, "t1", &yesterday);
        assert_eq!(calculate_streak(&conn).unwrap(), 1);
    }

    #[test]
    fn on_task_completed_upserts_and_increments() {
        let conn = in_memory_db();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        // 第一次完成 → tasks_completed=1, streak=1
        insert_completed_task(&conn, "t1", &today);
        let s1 = on_task_completed(&conn).unwrap();
        assert_eq!(s1.date, today);
        assert_eq!(s1.tasks_completed, 1);
        assert_eq!(s1.streak_count, 1);

        // 第二次完成 → tasks_completed=2
        insert_completed_task(&conn, "t2", &today);
        let s2 = on_task_completed(&conn).unwrap();
        assert_eq!(s2.tasks_completed, 2);
        assert_eq!(s2.streak_count, 1); // 同一天 streak 仍为 1
    }

    #[test]
    fn on_focus_completed_accumulates_seconds() {
        let conn = in_memory_db();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        let s1 = on_focus_completed(&conn, 1500).unwrap();
        assert_eq!(s1.total_focus_time, 1500);

        let s2 = on_focus_completed(&conn, 900).unwrap();
        assert_eq!(s2.total_focus_time, 2400);
        assert_eq!(s2.date, today);
    }

    #[test]
    fn productivity_score_empty_day_zero() {
        let conn = in_memory_db();
        assert_eq!(productivity_score(&conn).unwrap(), 0);
    }

    #[test]
    fn productivity_score_caps_at_hundred() {
        let conn = in_memory_db();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        // 5 任务 + 60 分钟专注 = 50 + 60 = 110 → clamp 100
        conn.execute(
            "INSERT INTO daily_stats (date, tasks_completed, total_focus_time, streak_count, created_at, updated_at) \
             VALUES (?1, 5, 3600, 0, '', '')",
            rusqlite::params![today],
        )
        .unwrap();
        assert_eq!(productivity_score(&conn).unwrap(), 100);
    }

    #[test]
    fn productivity_score_partial_credit() {
        let conn = in_memory_db();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        // 3 任务 + 15 分钟专注 = 30 + 15 = 45
        conn.execute(
            "INSERT INTO daily_stats (date, tasks_completed, total_focus_time, streak_count, created_at, updated_at) \
             VALUES (?1, 3, 900, 0, '', '')",
            rusqlite::params![today],
        )
        .unwrap();
        assert_eq!(productivity_score(&conn).unwrap(), 45);
    }

    #[test]
    fn get_daily_stats_missing_returns_not_found() {
        let conn = in_memory_db();
        let result = get_daily_stats(&conn, "2099-01-01");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFoundError(_) => (),
            other => panic!("预期 NotFoundError，实际 {:?}", other),
        }
    }

    #[test]
    fn get_weekly_stats_returns_recent_days_sorted() {
        let conn = in_memory_db();
        // 插入今日 + 3 天前两条记录
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let d3 = (chrono::Local::now() - chrono::Duration::days(3))
            .format("%Y-%m-%d")
            .to_string();
        conn.execute(
            "INSERT INTO daily_stats (date, tasks_completed, total_focus_time, streak_count, created_at, updated_at) \
             VALUES (?1, 2, 600, 1, '', '')",
            rusqlite::params![d3],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO daily_stats (date, tasks_completed, total_focus_time, streak_count, created_at, updated_at) \
             VALUES (?1, 4, 1800, 3, '', '')",
            rusqlite::params![today],
        )
        .unwrap();
        let stats = get_weekly_stats(&conn).unwrap();
        // 两条都在最近 7 天内，按日期升序
        assert_eq!(stats.len(), 2);
        assert_eq!(stats[0].date, d3);
        assert_eq!(stats[1].date, today);
        assert_eq!(stats[1].tasks_completed, 4);
    }

    // ---- 补充测试：边界与组合场景 ----

    #[test]
    fn calculate_streak_today_and_yesterday_returns_two() {
        let conn = in_memory_db();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let yesterday = (chrono::Local::now() - chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();
        insert_completed_task(&conn, "t1", &yesterday);
        insert_completed_task(&conn, "t2", &today);
        assert_eq!(calculate_streak(&conn).unwrap(), 2);
    }

    #[test]
    fn calculate_streak_ignores_non_completed_tasks() {
        let conn = in_memory_db();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        // 插入 inbox 任务（非 completed）——不应计入 streak
        conn.execute(
            "INSERT INTO tasks (id, title, status, updated_at) VALUES ('t1', 'T', 'inbox', ?1)",
            rusqlite::params![format!("{}T12:00:00+08:00", today)],
        )
        .unwrap();
        assert_eq!(calculate_streak(&conn).unwrap(), 0);
    }

    #[test]
    fn on_focus_then_task_completed_accumulates_both() {
        let conn = in_memory_db();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        insert_completed_task(&conn, "t1", &today);
        let s1 = on_task_completed(&conn).unwrap();
        assert_eq!(s1.tasks_completed, 1);
        let s2 = on_focus_completed(&conn, 1500).unwrap();
        assert_eq!(s2.tasks_completed, 1, "focus 不应影响 tasks_completed");
        assert_eq!(s2.total_focus_time, 1500);
    }

    #[test]
    fn productivity_score_one_task_one_minute_focus() {
        let conn = in_memory_db();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        // 1 任务 + 60s 专注 = 10 + 1 = 11
        conn.execute(
            "INSERT INTO daily_stats (date, tasks_completed, total_focus_time, streak_count, created_at, updated_at) \
             VALUES (?1, 1, 60, 0, '', '')",
            rusqlite::params![today],
        )
        .unwrap();
        assert_eq!(productivity_score(&conn).unwrap(), 11);
    }

    #[test]
    fn get_weekly_stats_empty_returns_empty() {
        let conn = in_memory_db();
        let stats = get_weekly_stats(&conn).unwrap();
        assert!(stats.is_empty());
    }
}
