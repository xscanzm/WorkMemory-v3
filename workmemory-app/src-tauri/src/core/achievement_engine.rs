//! 成就引擎 (Task 23.1)
//!
//! 提供成就目录、解锁判定与进度计算：
//! - `get_all_achievements`：返回静态目录与 DB 解锁状态合并后的视图（含进度）
//! - `unlock_achievement`：手动按 code 解锁单条
//! - `recalculate_achievements`：依据 tasks / focus_sessions / pet_state 评估各条件，
//!   对新满足的成就写入解锁时间并返回更新后的列表
//!
//! 成就 code 与 achievements 表 id 一一对应；表 schema 见 db/migrations.rs。
//! progress 字段为派生值（0.0-1.0），不落库，每次查询时实时计算。

use rusqlite::Connection;
use serde::Serialize;
use tauri::Emitter;

use crate::core::error::{AppError, AppResult};

/// 成就视图 DTO（前端 AchievementCard 渲染用）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementView {
    /// 成就唯一编码（与 DB achievements.id 对齐）
    pub code: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub unlocked: bool,
    pub unlocked_at: Option<String>,
    /// 进度 0.0-1.0，已解锁恒为 1.0
    pub progress: f64,
}

/// 成就稀有度（前端 AchievementUnlockModal 按色系渲染粒子特效）
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AchievementRarity {
    Common,
    Rare,
    Epic,
    Legendary,
}

/// `achievement-unlocked` 事件载荷（Task 17.2）
///
/// 当 `recalculate_achievements` / `unlock_achievement` 写入新解锁记录时，
/// 通过 `app.emit("achievement-unlocked", payload)` 广播给前端，
/// 由 `achievementStore` 接收并触发 `AchievementUnlockModal` 特效弹窗。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockedAchievementPayload {
    pub id: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub rarity: AchievementRarity,
    pub unlocked_at: String,
    pub xp_reward: Option<i64>,
}

/// 按 code 返回稀有度（目录静态映射，与成就难度对齐）
fn rarity_of(code: &str) -> AchievementRarity {
    match code {
        "all_rounded" => AchievementRarity::Legendary,
        "tasks_50" => AchievementRarity::Epic,
        "streak_7" | "pet_level_5" | "focus_10" => AchievementRarity::Rare,
        _ => AchievementRarity::Common,
    }
}

/// 按 code 返回 XP 奖励（目录静态映射，随稀有度递增）
fn xp_reward_of(code: &str) -> i64 {
    match code {
        "all_rounded" => 500,
        "tasks_50" => 200,
        "streak_7" | "pet_level_5" | "focus_10" => 100,
        _ => 50,
    }
}

/// 构造解锁事件 payload（读取 DB 中的 unlocked_at，缺失时回退当前时间）
fn build_unlock_payload(conn: &Connection, code: &str) -> AppResult<UnlockedAchievementPayload> {
    let def = CATALOG
        .iter()
        .find(|d| d.code == code)
        .ok_or_else(|| AppError::not_found(format!("未知成就: {}", code)))?;
    let (_, unlocked_at) = read_unlock_state(conn, def.code);
    Ok(UnlockedAchievementPayload {
        id: def.code.to_string(),
        title: def.title.to_string(),
        description: def.description.to_string(),
        icon: def.icon.to_string(),
        rarity: rarity_of(def.code),
        unlocked_at: unlocked_at.unwrap_or_else(|| {
            chrono::Local::now().format("%+").to_string()
        }),
        xp_reward: Some(xp_reward_of(def.code)),
    })
}

/// 静态成就目录定义
struct AchievementDef {
    code: &'static str,
    title: &'static str,
    description: &'static str,
    icon: &'static str,
}

/// 8 个成就目录（code 与 DB id 对齐）
const CATALOG: &[AchievementDef] = &[
    AchievementDef {
        code: "first_task",
        title: "初出茅庐",
        description: "完成第一个任务",
        icon: "🌱",
    },
    AchievementDef {
        code: "streak_7",
        title: "一周坚持",
        description: "连续 7 天完成任务",
        icon: "🔥",
    },
    AchievementDef {
        code: "pet_level_5",
        title: "宠物达人",
        description: "宠物升至 5 级",
        icon: "🐾",
    },
    AchievementDef {
        code: "focus_10",
        title: "专注新手",
        description: "完成 10 次专注会话",
        icon: "🎯",
    },
    AchievementDef {
        code: "tasks_50",
        title: "效率专家",
        description: "累计完成 50 个任务",
        icon: "⚡",
    },
    AchievementDef {
        code: "night_owl",
        title: "夜猫子",
        description: "在 23:00-04:00 完成任务或专注",
        icon: "🦉",
    },
    AchievementDef {
        code: "early_bird",
        title: "早起鸟",
        description: "在 05:00-08:00 完成任务或专注",
        icon: "🐦",
    },
    AchievementDef {
        code: "all_rounded",
        title: "全面发展",
        description: "解锁以上全部成就",
        icon: "🏆",
    },
];

/// 评估某成就当前进度（0.0-1.0）
fn eval_progress(conn: &Connection, code: &str) -> AppResult<f64> {
    let p = match code {
        "first_task" => {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM tasks WHERE status = 'completed'",
                [],
                |r| r.get(0),
            )?;
            (n as f64).min(1.0)
        }
        "streak_7" => {
            let streak = crate::core::analytics_engine::calculate_streak(conn).unwrap_or(0);
            (streak as f64 / 7.0).min(1.0)
        }
        "pet_level_5" => {
            let level: i64 = conn
                .query_row(
                    "SELECT level FROM pet_state WHERE id = 'default'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            (level as f64 / 5.0).min(1.0)
        }
        "focus_10" => {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM focus_sessions WHERE end_time IS NOT NULL",
                [],
                |r| r.get(0),
            )?;
            (n as f64 / 10.0).min(1.0)
        }
        "tasks_50" => {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM tasks WHERE status = 'completed'",
                [],
                |r| r.get(0),
            )?;
            (n as f64 / 50.0).min(1.0)
        }
        "night_owl" => {
            // 23:00-04:00（含 23、00、01、02、03）有完成的任务或专注会话
            let n_tasks: i64 = conn.query_row(
                "SELECT COUNT(*) FROM tasks \
                 WHERE status = 'completed' \
                 AND (CAST(substr(updated_at, 12, 2) AS INTEGER) >= 23 \
                      OR CAST(substr(updated_at, 12, 2) AS INTEGER) <= 3)",
                [],
                |r| r.get(0),
            )?;
            let n_focus: i64 = conn.query_row(
                "SELECT COUNT(*) FROM focus_sessions \
                 WHERE end_time IS NOT NULL \
                 AND (CAST(substr(start_time, 12, 2) AS INTEGER) >= 23 \
                      OR CAST(substr(start_time, 12, 2) AS INTEGER) <= 3)",
                [],
                |r| r.get(0),
            )?;
            if n_tasks + n_focus > 0 { 1.0 } else { 0.0 }
        }
        "early_bird" => {
            // 05:00-08:00（含 5、6、7、8）
            let n_tasks: i64 = conn.query_row(
                "SELECT COUNT(*) FROM tasks \
                 WHERE status = 'completed' \
                 AND CAST(substr(updated_at, 12, 2) AS INTEGER) BETWEEN 5 AND 8",
                [],
                |r| r.get(0),
            )?;
            let n_focus: i64 = conn.query_row(
                "SELECT COUNT(*) FROM focus_sessions \
                 WHERE end_time IS NOT NULL \
                 AND CAST(substr(start_time, 12, 2) AS INTEGER) BETWEEN 5 AND 8",
                [],
                |r| r.get(0),
            )?;
            if n_tasks + n_focus > 0 { 1.0 } else { 0.0 }
        }
        "all_rounded" => {
            // 其余 7 个成就已解锁数 / 7
            let mut unlocked = 0;
            for def in CATALOG {
                if def.code == "all_rounded" {
                    continue;
                }
                let u: i64 = conn
                    .query_row(
                        "SELECT unlocked FROM achievements WHERE id = ?1",
                        rusqlite::params![def.code],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                if u > 0 {
                    unlocked += 1;
                }
            }
            (unlocked as f64 / 7.0).min(1.0)
        }
        _ => 0.0,
    };
    Ok(p)
}

/// 读取 DB 中某成就的解锁状态（unlocked / unlocked_at）
fn read_unlock_state(conn: &Connection, code: &str) -> (bool, Option<String>) {
    let row: rusqlite::Result<(i64, Option<String>)> = conn.query_row(
        "SELECT unlocked, unlocked_at FROM achievements WHERE id = ?1",
        rusqlite::params![code],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?)),
    );
    match row {
        Ok((u, at)) => (u > 0, at),
        Err(_) => (false, None),
    }
}

/// 写入解锁记录（upsert，idempotent：已解锁则保持首次解锁时间）
fn write_unlock(conn: &Connection, code: &str, title: &str, description: &str, icon: &str) -> AppResult<()> {
    let now = chrono::Local::now().format("%+").to_string();
    conn.execute(
        "INSERT INTO achievements (id, title, description, icon, unlocked, unlocked_at, created_at) \
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5) \
         ON CONFLICT(id) DO UPDATE SET unlocked = 1, \
            unlocked_at = COALESCE(unlocked_at, ?5)",
        rusqlite::params![code, title, description, icon, now],
    )?;
    Ok(())
}

/// 返回全部成就（目录 + 解锁状态 + 实时进度）
pub fn get_all_achievements(conn: &Connection) -> AppResult<Vec<AchievementView>> {
    let mut out = Vec::with_capacity(CATALOG.len());
    for def in CATALOG {
        let (unlocked, unlocked_at) = read_unlock_state(conn, def.code);
        let progress = if unlocked {
            1.0
        } else {
            eval_progress(conn, def.code).unwrap_or(0.0)
        };
        out.push(AchievementView {
            code: def.code.to_string(),
            title: def.title.to_string(),
            description: def.description.to_string(),
            icon: def.icon.to_string(),
            unlocked,
            unlocked_at,
            progress,
        });
    }
    Ok(out)
}

/// 手动解锁指定成就（按 code）
///
/// 写入解锁记录后，通过 `app.emit("achievement-unlocked", payload)` 通知前端
/// 弹出 `AchievementUnlockModal` 特效弹窗（Task 17.2）。
pub fn unlock_achievement(
    conn: &Connection,
    code: &str,
    app: &tauri::AppHandle,
) -> AppResult<AchievementView> {
    let def = CATALOG
        .iter()
        .find(|d| d.code == code)
        .ok_or_else(|| AppError::not_found(format!("未知成就: {}", code)))?;
    write_unlock(conn, def.code, def.title, def.description, def.icon)?;
    let (unlocked, unlocked_at) = read_unlock_state(conn, def.code);
    // 广播解锁事件（best-effort，失败仅记录不影响解锁本身）
    if let Ok(payload) = build_unlock_payload(conn, def.code) {
        let _ = app.emit("achievement-unlocked", payload);
    }
    Ok(AchievementView {
        code: def.code.to_string(),
        title: def.title.to_string(),
        description: def.description.to_string(),
        icon: def.icon.to_string(),
        unlocked,
        unlocked_at,
        progress: 1.0,
    })
}

/// 重算所有成就：对进度达到 1.0 且尚未解锁的成就写入解锁记录，返回更新后列表
///
/// 对本次新写入解锁的成就，逐条 `app.emit("achievement-unlocked", payload)`，
/// 由前端 `achievementStore` 接收并依次弹出 `AchievementUnlockModal`（Task 17.2）。
pub fn recalculate_achievements(
    conn: &Connection,
    app: &tauri::AppHandle,
) -> AppResult<Vec<AchievementView>> {
    let mut newly_unlocked_codes: Vec<String> = Vec::new();
    for def in CATALOG {
        if def.code == "all_rounded" {
            // 依赖其余成就解锁状态，放最后单独判定
            continue;
        }
        let (unlocked, _) = read_unlock_state(conn, def.code);
        if unlocked {
            continue;
        }
        let progress = eval_progress(conn, def.code).unwrap_or(0.0);
        if progress >= 1.0 {
            write_unlock(conn, def.code, def.title, def.description, def.icon)?;
            newly_unlocked_codes.push(def.code.to_string());
        }
    }
    // all_rounded：其余 7 个全部解锁后自动解锁
    let (all_unlocked, _) = read_unlock_state(conn, "all_rounded");
    if !all_unlocked {
        let all_def = CATALOG.iter().find(|d| d.code == "all_rounded").unwrap();
        let mut count = 0;
        for def in CATALOG {
            if def.code == "all_rounded" {
                continue;
            }
            let (u, _) = read_unlock_state(conn, def.code);
            if u {
                count += 1;
            }
        }
        if count >= 7 {
            write_unlock(conn, all_def.code, all_def.title, all_def.description, all_def.icon)?;
            newly_unlocked_codes.push(all_def.code.to_string());
        }
    }
    // 对本次新解锁的成就逐条广播事件（best-effort）
    for code in &newly_unlocked_codes {
        if let Ok(payload) = build_unlock_payload(conn, code) {
            let _ = app.emit("achievement-unlocked", payload);
        }
    }
    get_all_achievements(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 内存数据库：achievements + tasks + focus_sessions + pet_state + daily_stats
    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE achievements (id TEXT PRIMARY KEY, title TEXT, description TEXT, icon TEXT, unlocked INTEGER NOT NULL DEFAULT 0, unlocked_at TEXT, created_at TEXT NOT NULL);\
             CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, updated_at TEXT);\
             CREATE TABLE focus_sessions (id TEXT PRIMARY KEY, start_time TEXT, end_time TEXT, duration_seconds INTEGER, type TEXT, task_id TEXT, interrupted INTEGER, interruption_reason TEXT, created_at TEXT);\
             CREATE TABLE pet_state (id TEXT PRIMARY KEY, species TEXT, level INTEGER, xp INTEGER, hunger INTEGER, energy INTEGER, happiness INTEGER, cleanliness INTEGER, bond_level INTEGER, mood TEXT, last_updated TEXT);\
             CREATE TABLE daily_stats (date TEXT PRIMARY KEY, tasks_completed INTEGER, total_focus_time INTEGER, streak_count INTEGER, created_at TEXT, updated_at TEXT);",
        )
        .unwrap();
        conn
    }

    // ---- rarity_of 静态映射测试 ----

    #[test]
    fn rarity_of_returns_correct_rarity() {
        assert!(matches!(rarity_of("all_rounded"), AchievementRarity::Legendary));
        assert!(matches!(rarity_of("tasks_50"), AchievementRarity::Epic));
        assert!(matches!(rarity_of("streak_7"), AchievementRarity::Rare));
        assert!(matches!(rarity_of("pet_level_5"), AchievementRarity::Rare));
        assert!(matches!(rarity_of("focus_10"), AchievementRarity::Rare));
        assert!(matches!(rarity_of("first_task"), AchievementRarity::Common));
        assert!(matches!(rarity_of("night_owl"), AchievementRarity::Common));
        assert!(matches!(rarity_of("early_bird"), AchievementRarity::Common));
        assert!(matches!(rarity_of("unknown_code"), AchievementRarity::Common));
    }

    // ---- xp_reward_of 静态映射测试 ----

    #[test]
    fn xp_reward_of_returns_correct_xp() {
        assert_eq!(xp_reward_of("all_rounded"), 500);
        assert_eq!(xp_reward_of("tasks_50"), 200);
        assert_eq!(xp_reward_of("streak_7"), 100);
        assert_eq!(xp_reward_of("pet_level_5"), 100);
        assert_eq!(xp_reward_of("focus_10"), 100);
        assert_eq!(xp_reward_of("first_task"), 50);
        assert_eq!(xp_reward_of("night_owl"), 50);
        assert_eq!(xp_reward_of("early_bird"), 50);
        assert_eq!(xp_reward_of("unknown"), 50);
    }

    // ---- eval_progress 测试 ----

    #[test]
    fn eval_progress_first_task_zero_initially() {
        let conn = in_memory_db();
        assert_eq!(eval_progress(&conn, "first_task").unwrap(), 0.0);
    }

    #[test]
    fn eval_progress_first_task_one_after_completed() {
        let conn = in_memory_db();
        conn.execute(
            "INSERT INTO tasks (id, title, status, updated_at) VALUES ('t1', 'T', 'completed', '2026-06-26T10:00:00+08:00')",
            [],
        )
        .unwrap();
        assert_eq!(eval_progress(&conn, "first_task").unwrap(), 1.0);
    }

    #[test]
    fn eval_progress_tasks_50_fractional() {
        let conn = in_memory_db();
        for i in 0..10 {
            conn.execute(
                "INSERT INTO tasks (id, title, status, updated_at) VALUES (?1, ?2, 'completed', '2026-06-26T10:00:00+08:00')",
                rusqlite::params![format!("t{}", i), format!("T{}", i)],
            )
            .unwrap();
        }
        // 10/50 = 0.2
        let p = eval_progress(&conn, "tasks_50").unwrap();
        assert!((p - 0.2).abs() < 1e-9);
    }

    #[test]
    fn eval_progress_focus_10_fractional() {
        let conn = in_memory_db();
        for i in 0..5 {
            conn.execute(
                "INSERT INTO focus_sessions (id, start_time, end_time, duration_seconds, type, interrupted, interruption_reason, created_at) VALUES (?1, '2026-06-26T10:00:00+08:00', '2026-06-26T10:25:00+08:00', 1500, 'pomodoro', 0, '', '2026-06-26T10:00:00+08:00')",
                rusqlite::params![format!("fs{}", i)],
            )
            .unwrap();
        }
        // 5/10 = 0.5
        let p = eval_progress(&conn, "focus_10").unwrap();
        assert!((p - 0.5).abs() < 1e-9);
    }

    #[test]
    fn eval_progress_pet_level_5_fractional() {
        let conn = in_memory_db();
        conn.execute(
            "INSERT INTO pet_state (id, species, level, xp, hunger, energy, happiness, cleanliness, bond_level, mood, last_updated) VALUES ('default', 'cat', 3, 0, 80, 80, 80, 80, 0, 'happy', '2026-06-26T10:00:00+08:00')",
            [],
        )
        .unwrap();
        // 3/5 = 0.6
        let p = eval_progress(&conn, "pet_level_5").unwrap();
        assert!((p - 0.6).abs() < 1e-9);
    }

    #[test]
    fn eval_progress_streak_7_full_when_seven_consecutive_days() {
        let conn = in_memory_db();
        let today = chrono::Local::now().date_naive();
        for i in 0..7 {
            let d = (today - chrono::Duration::days(6 - i))
                .format("%Y-%m-%d")
                .to_string();
            conn.execute(
                "INSERT INTO tasks (id, title, status, updated_at) VALUES (?1, ?2, 'completed', ?3)",
                rusqlite::params![format!("t{}", i), format!("T{}", i), format!("{}T12:00:00+08:00", d)],
            )
            .unwrap();
        }
        let p = eval_progress(&conn, "streak_7").unwrap();
        assert!((p - 1.0).abs() < 1e-9, "连续 7 天完成应使 streak_7 进度为 1.0");
    }

    #[test]
    fn eval_progress_unknown_code_returns_zero() {
        let conn = in_memory_db();
        assert_eq!(eval_progress(&conn, "nonexistent").unwrap(), 0.0);
    }

    #[test]
    fn eval_progress_all_rounded_zero_initially() {
        let conn = in_memory_db();
        assert_eq!(eval_progress(&conn, "all_rounded").unwrap(), 0.0);
    }

    #[test]
    fn eval_progress_all_rounded_full_when_others_unlocked() {
        let conn = in_memory_db();
        // 解锁除 all_rounded 外的 7 个成就
        for def in CATALOG {
            if def.code == "all_rounded" {
                continue;
            }
            write_unlock(&conn, def.code, def.title, def.description, def.icon).unwrap();
        }
        let p = eval_progress(&conn, "all_rounded").unwrap();
        assert!(
            (p - 1.0).abs() < 1e-9,
            "其余 7 个全解锁后 all_rounded 进度应为 1.0"
        );
    }

    // ---- read_unlock_state / write_unlock 测试 ----

    #[test]
    fn read_unlock_state_default_false() {
        let conn = in_memory_db();
        let (unlocked, at) = read_unlock_state(&conn, "first_task");
        assert!(!unlocked);
        assert!(at.is_none());
    }

    #[test]
    fn write_unlock_then_read_returns_true() {
        let conn = in_memory_db();
        write_unlock(&conn, "first_task", "初出茅庐", "完成第一个任务", "🌱").unwrap();
        let (unlocked, at) = read_unlock_state(&conn, "first_task");
        assert!(unlocked);
        assert!(at.is_some());
    }

    #[test]
    fn write_unlock_is_idempotent_keeps_first_timestamp() {
        let conn = in_memory_db();
        write_unlock(&conn, "first_task", "初出茅庐", "完成第一个任务", "🌱").unwrap();
        let (_, first_at) = read_unlock_state(&conn, "first_task");
        // 再次写入不应覆盖 unlocked_at
        write_unlock(&conn, "first_task", "初出茅庐", "完成第一个任务", "🌱").unwrap();
        let (_, second_at) = read_unlock_state(&conn, "first_task");
        assert_eq!(first_at, second_at, "重复解锁应保持首次解锁时间");
    }

    // ---- get_all_achievements 测试 ----

    #[test]
    fn get_all_achievements_returns_full_catalog() {
        let conn = in_memory_db();
        let views = get_all_achievements(&conn).unwrap();
        assert_eq!(views.len(), 8, "目录应有 8 个成就");
        let codes: Vec<&str> = views.iter().map(|v| v.code.as_str()).collect();
        assert!(codes.contains(&"first_task"));
        assert!(codes.contains(&"streak_7"));
        assert!(codes.contains(&"pet_level_5"));
        assert!(codes.contains(&"focus_10"));
        assert!(codes.contains(&"tasks_50"));
        assert!(codes.contains(&"night_owl"));
        assert!(codes.contains(&"early_bird"));
        assert!(codes.contains(&"all_rounded"));
    }

    #[test]
    fn get_all_achievements_unlocked_has_progress_one() {
        let conn = in_memory_db();
        write_unlock(&conn, "first_task", "初出茅庐", "完成第一个任务", "🌱").unwrap();
        let views = get_all_achievements(&conn).unwrap();
        let first = views.iter().find(|v| v.code == "first_task").unwrap();
        assert!(first.unlocked);
        assert!((first.progress - 1.0).abs() < 1e-9);
    }

    #[test]
    fn get_all_achievements_all_unlocked_false_when_empty() {
        let conn = in_memory_db();
        let views = get_all_achievements(&conn).unwrap();
        for v in &views {
            assert!(!v.unlocked, "{} 应未解锁", v.code);
            assert!(v.progress >= 0.0 && v.progress <= 1.0);
        }
    }

    // ---- build_unlock_payload 测试 ----

    #[test]
    fn build_unlock_payload_returns_correct_data() {
        let conn = in_memory_db();
        write_unlock(&conn, "tasks_50", "效率专家", "累计完成 50 个任务", "⚡").unwrap();
        let payload = build_unlock_payload(&conn, "tasks_50").unwrap();
        assert_eq!(payload.id, "tasks_50");
        assert_eq!(payload.title, "效率专家");
        assert!(matches!(payload.rarity, AchievementRarity::Epic));
        assert_eq!(payload.xp_reward, Some(200));
        assert!(!payload.unlocked_at.is_empty());
    }

    #[test]
    fn build_unlock_payload_unknown_code_returns_err() {
        let conn = in_memory_db();
        assert!(build_unlock_payload(&conn, "nonexistent").is_err());
    }

    #[test]
    fn build_unlock_payload_uses_now_when_unlocked_at_missing() {
        let conn = in_memory_db();
        // 直接插入一条 unlocked=1 但 unlocked_at=NULL 的记录
        conn.execute(
            "INSERT INTO achievements (id, title, description, icon, unlocked, unlocked_at, created_at) \
             VALUES ('first_task', '初出茅庐', '', '🌱', 1, NULL, '2026-06-26T10:00:00+08:00')",
            [],
        )
        .unwrap();
        let payload = build_unlock_payload(&conn, "first_task").unwrap();
        // unlocked_at 缺失时应回退到当前时间（非空）
        assert!(!payload.unlocked_at.is_empty());
    }

    // ---- night_owl / early_bird 时间判定测试 ----

    #[test]
    fn eval_progress_night_owl_detected_when_task_at_late_hour() {
        let conn = in_memory_db();
        // 23:xx 完成的任务
        conn.execute(
            "INSERT INTO tasks (id, title, status, updated_at) VALUES ('t1', 'T', 'completed', '2026-06-26T23:30:00+08:00')",
            [],
        )
        .unwrap();
        assert_eq!(eval_progress(&conn, "night_owl").unwrap(), 1.0);
    }

    #[test]
    fn eval_progress_early_bird_detected_when_focus_at_morning() {
        let conn = in_memory_db();
        // 06:xx 完成的专注会话
        conn.execute(
            "INSERT INTO focus_sessions (id, start_time, end_time, duration_seconds, type, interrupted, interruption_reason, created_at) \
             VALUES ('fs1', '2026-06-26T06:00:00+08:00', '2026-06-26T06:25:00+08:00', 1500, 'pomodoro', 0, '', '2026-06-26T06:00:00+08:00')",
            [],
        )
        .unwrap();
        assert_eq!(eval_progress(&conn, "early_bird").unwrap(), 1.0);
    }
}
