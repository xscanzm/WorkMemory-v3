//! 任务引擎：Task CRUD + 状态机 + 全文搜索
//!
//! 严格遵循 analysis_results.md BUG-001/002/003/008/014 修复要求：
//! - save_task 后端生成 uuid v4（非前端 Date.now()）
//! - 状态机单向流转：inbox → todo → in_progress → completed → archived
//! - archived 状态不可再转换
//! - FTS5 全文搜索

use rusqlite::Connection;
use crate::core::error::{AppError, AppResult};
use crate::models::Task;

/// 合法的状态流转映射（from → 允许的 to 集合）
/// inbox → todo / in_progress / completed / archived
/// todo → in_progress / completed / archived
/// in_progress → completed / archived
/// completed → archived
/// archived → （无，终态）
fn allowed_transitions(from: &str) -> &'static [&'static str] {
    match from {
        "inbox" => &["todo", "in_progress", "completed", "archived"],
        "todo" => &["in_progress", "completed", "archived"],
        "in_progress" => &["completed", "archived"],
        "completed" => &["archived"],
        "archived" => &[],
        _ => &[],
    }
}

/// 校验状态流转是否合法
pub fn validate_transition(from: &str, to: &str) -> AppResult<()> {
    if from == to {
        return Ok(());
    }
    let allowed = allowed_transitions(from);
    if !allowed.contains(&to) {
        return Err(AppError::ValidationError(format!(
            "非法状态流转：{} → {}（archived 为终态，不可转换）", from, to
        )));
    }
    Ok(())
}

/// 创建任务（后端生成 uuid v4）
pub fn save_task(conn: &Connection, mut task: Task) -> AppResult<Task> {
    if task.title.trim().is_empty() {
        return Err(AppError::validation("任务标题不能为空"));
    }
    if task.id.is_empty() {
        task.id = uuid::Uuid::new_v4().to_string();
    }
    let now = chrono::Local::now().format("%+").to_string();
    task.created_at = now.clone();
    task.updated_at = now;
    if task.status.is_empty() {
        task.status = "inbox".to_string();
    }
    if task.priority.is_empty() {
        task.priority = "none".to_string();
    }
    let subtasks_json = serde_json::to_string(&task.subtasks).unwrap_or_else(|_| "[]".to_string());
    let tags_json = serde_json::to_string(&task.tags).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO tasks (id, title, description, status, priority, due_date, mood_tag,
            recurrence_rule, is_pinned, sort_order, subtasks, category, tags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        rusqlite::params![
            task.id, task.title, task.description, task.status, task.priority,
            task.due_date, task.mood_tag, task.recurrence_rule,
            task.is_pinned as i32, task.sort_order, subtasks_json, task.category, tags_json,
            task.created_at, task.updated_at,
        ],
    )?;
    Ok(task)
}

/// 查询所有任务（按 sort_order, created_at 排序）
///
/// Task 22.3：新增 `limit` / `offset` 可选分页参数。
/// - 两者均 `Some` 时附加 `LIMIT ?1 OFFSET ?2` 子句（分页查询首页/下一页）。
/// - 任一为 `None` 时回退到全量查询（保留对内部批处理调用方的兼容）。
/// 前端 IPC 命令 `get_all_tasks` 默认以 `limit=100, offset=0` 调用本函数。
pub fn get_all_tasks(
    conn: &Connection,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AppResult<Vec<Task>> {
    let tasks = match (limit, offset) {
        (Some(l), Some(o)) => {
            let mut stmt = conn.prepare(
                "SELECT id, title, description, status, priority, due_date, mood_tag,
                        recurrence_rule, is_pinned, sort_order, subtasks, category, tags, created_at, updated_at
                 FROM tasks ORDER BY sort_order ASC, created_at DESC
                 LIMIT ?1 OFFSET ?2",
            )?;
            // 先 collect 到局部变量再作为块尾返回，避免 `stmt` 仍在借用中被 drop（E0597 块尾临时变量顺序问题）
            let rows: Vec<Task> = stmt
                .query_map(rusqlite::params![l, o], row_to_task)?
                .filter_map(|r| r.ok())
                .collect();
            rows
        }
        _ => {
            let mut stmt = conn.prepare(
                "SELECT id, title, description, status, priority, due_date, mood_tag,
                        recurrence_rule, is_pinned, sort_order, subtasks, category, tags, created_at, updated_at
                 FROM tasks ORDER BY sort_order ASC, created_at DESC",
            )?;
            // 同上：collect 到局部变量再返回，规避块尾临时变量借用问题（E0597）
            let rows: Vec<Task> = stmt
                .query_map([], row_to_task)?
                .filter_map(|r| r.ok())
                .collect();
            rows
        }
    };
    Ok(tasks)
}

/// 查询单个任务
pub fn get_task(conn: &Connection, id: &str) -> AppResult<Task> {
    let task = conn.query_row(
        "SELECT id, title, description, status, priority, due_date, mood_tag,
                recurrence_rule, is_pinned, sort_order, subtasks, category, tags, created_at, updated_at
         FROM tasks WHERE id = ?1",
        rusqlite::params![id],
        row_to_task,
    ).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::not_found(format!("任务不存在: {}", id)),
        other => AppError::DbError(other.to_string()),
    })?;
    Ok(task)
}

/// 更新任务（含状态守卫）
pub fn update_task(conn: &Connection, task: &Task) -> AppResult<()> {
    // 状态守卫：若 status 变化，校验流转合法性
    let current: String = conn.query_row(
        "SELECT status FROM tasks WHERE id = ?1", rusqlite::params![task.id], |r| r.get(0)
    ).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::not_found(format!("任务不存在: {}", task.id)),
        other => AppError::DbError(other.to_string()),
    })?;
    validate_transition(&current, &task.status)?;

    let now = chrono::Local::now().format("%+").to_string();
    let subtasks_json = serde_json::to_string(&task.subtasks).unwrap_or_else(|_| "[]".to_string());
    let tags_json = serde_json::to_string(&task.tags).unwrap_or_else(|_| "[]".to_string());
    let affected = conn.execute(
        "UPDATE tasks SET title=?1, description=?2, status=?3, priority=?4, due_date=?5,
            mood_tag=?6, recurrence_rule=?7, is_pinned=?8, sort_order=?9, subtasks=?10,
            category=?11, tags=?12, updated_at=?13
         WHERE id=?14",
        rusqlite::params![
            task.title, task.description, task.status, task.priority, task.due_date,
            task.mood_tag, task.recurrence_rule, task.is_pinned as i32, task.sort_order,
            subtasks_json, task.category, tags_json, now, task.id,
        ],
    )?;
    if affected == 0 {
        return Err(AppError::not_found(format!("任务不存在: {}", task.id)));
    }

    // 衍生计算接入（Task 29.1）：仅当 status 由非 completed 流转为 completed 时触发，
    // 避免对 completed 任务的幂等 re-save 重复计数。
    // 使用全限定 crate::core:: 路径，规避 commands.rs 中裸模块路径解析问题。
    // 注意：此处采用顺序 `?` 传播——若 pet_engine 失败（如 pet_state 未初始化），
    // analytics_engine 不会执行。权衡：简单优先；调用方可在命令层用 best-effort 容错。
    if task.status == "completed" && current != "completed" {
        crate::core::pet_engine::on_task_completed(conn)?;
        crate::core::analytics_engine::on_task_completed(conn)?;
    }

    Ok(())
}

/// 删除任务（含外键级联清理）
///
/// Task 5.2：tasks.subtasks 是 JSON 数组（存放子任务 ID），focus_sessions.task_id 是
/// 可空外键——二者均无数据库级 FK 约束，需在删除任务前显式清理引用，避免悬挂引用：
/// 1. focus_sessions.task_id SET NULL（保留会话历史，仅断开关联）
/// 2. 从其他任务的 subtasks JSON 数组中移除本任务 ID
/// 3. 删除任务本身
///
/// 使用事务包裹：任一步失败整体回滚。`Transaction` 的 Drop 在未 commit 时自动 ROLLBACK，
/// 故 `?` 早返回即回滚。
pub fn delete_task(conn: &mut Connection, id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;

    // 1. SET NULL focus_sessions.task_id where it references this task
    tx.execute(
        "UPDATE focus_sessions SET task_id = NULL WHERE task_id = ?1",
        rusqlite::params![id],
    )?;

    // 2. Remove this task's ID from other tasks' subtasks JSON arrays.
    //    subtasks 列为 JSON TEXT（如 '["uuid1","uuid2"]'），先用 LIKE 粗筛候选行，
    //    再在内存中解析 JSON 精确移除，避免误伤仅子串匹配的 ID。
    let mut stmt = tx.prepare(
        "SELECT id, subtasks FROM tasks WHERE subtasks IS NOT NULL AND subtasks LIKE ?1",
    )?;
    let affected: Vec<(String, String)> = stmt
        .query_map(rusqlite::params![format!("%{}%", id)], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    for (task_id, subtasks_json) in affected {
        if let Ok(mut arr) = serde_json::from_str::<Vec<String>>(&subtasks_json) {
            arr.retain(|s| s != id);
            let new_json = serde_json::to_string(&arr).unwrap_or_default();
            tx.execute(
                "UPDATE tasks SET subtasks = ?1 WHERE id = ?2",
                rusqlite::params![new_json, task_id],
            )?;
        }
    }

    // 3. Delete the task itself
    let affected = tx.execute("DELETE FROM tasks WHERE id = ?1", rusqlite::params![id])?;
    if affected == 0 {
        // tx 在此 drop → 自动 ROLLBACK
        return Err(AppError::not_found(format!("任务不存在: {}", id)));
    }

    tx.commit()?;
    Ok(())
}

/// FTS5 全文搜索（含中文子串回退）
///
/// 先用 FTS5 MATCH 查询（适合英文/空格分词文本）；若命中为空则回退 LIKE 模糊匹配，
/// 覆盖 unicode61 分词器对中文整词索引导致子串无法命中的场景（如搜 "周报" 匹配 "写周报"）。
pub fn search_tasks(conn: &Connection, query: &str) -> AppResult<Vec<Task>> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    // 1. FTS5 MATCH 查询，通过 rowid 关联回 tasks 表
    let mut stmt = conn.prepare(
        "SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date, t.mood_tag,
                t.recurrence_rule, t.is_pinned, t.sort_order, t.subtasks, t.category, t.tags,
                t.created_at, t.updated_at
         FROM fts_tasks f
         JOIN tasks t ON t.rowid = f.rowid
         WHERE f.title MATCH ?1 OR f.description MATCH ?1
         ORDER BY rank"
    )?;
    let tasks: Vec<Task> = stmt.query_map(rusqlite::params![query], row_to_task)?.filter_map(|r| r.ok()).collect();
    if !tasks.is_empty() {
        return Ok(tasks);
    }
    // 2. FTS5 无命中时回退 LIKE 模糊匹配（中文子串场景）
    let like_pattern = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "SELECT id, title, description, status, priority, due_date, mood_tag,
                recurrence_rule, is_pinned, sort_order, subtasks, category, tags, created_at, updated_at
         FROM tasks
         WHERE title LIKE ?1 OR description LIKE ?1
         ORDER BY sort_order ASC, created_at DESC"
    )?;
    let tasks = stmt.query_map(rusqlite::params![like_pattern], row_to_task)?.filter_map(|r| r.ok()).collect();
    Ok(tasks)
}

/// 行映射函数
fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let subtasks_str: String = row.get(10)?;
    let tags_str: String = row.get(12)?;
    let subtasks: Vec<String> = serde_json::from_str(&subtasks_str).unwrap_or_default();
    let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        status: row.get(3)?,
        priority: row.get(4)?,
        due_date: row.get(5)?,
        mood_tag: row.get(6)?,
        recurrence_rule: row.get(7)?,
        is_pinned: row.get::<_, i32>(8)? != 0,
        sort_order: row.get(9)?,
        subtasks,
        category: row.get(11)?,
        tags,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        // 简化：直接建 tasks + fts_tasks + 同步触发器 + focus_sessions（镜像 migrations.rs 生产 schema）
        conn.execute_batch(r#"
            CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', status TEXT DEFAULT 'inbox', priority TEXT DEFAULT 'none', due_date TEXT, mood_tag TEXT, recurrence_rule TEXT, is_pinned INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, subtasks TEXT DEFAULT '[]', category TEXT DEFAULT '', tags TEXT DEFAULT '[]', created_at TEXT, updated_at TEXT);
            CREATE VIRTUAL TABLE fts_tasks USING fts5(title, description, content='tasks', content_rowid='rowid', tokenize='unicode61');
            CREATE TRIGGER trg_tasks_ai AFTER INSERT ON tasks BEGIN
              INSERT INTO fts_tasks(rowid, title, description) VALUES (new.rowid, new.title, new.description);
            END;
            CREATE TRIGGER trg_tasks_ad BEFORE DELETE ON tasks BEGIN
              INSERT INTO fts_tasks(fts_tasks, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
            END;
            CREATE TRIGGER trg_tasks_au AFTER UPDATE ON tasks BEGIN
              INSERT INTO fts_tasks(fts_tasks, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
              INSERT INTO fts_tasks(rowid, title, description) VALUES (new.rowid, new.title, new.description);
            END;
            CREATE TABLE focus_sessions (id TEXT PRIMARY KEY NOT NULL, start_time TEXT NOT NULL, end_time TEXT, duration_seconds INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'pomodoro', task_id TEXT, interrupted INTEGER NOT NULL DEFAULT 0, interruption_reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
        "#).unwrap();
        conn
    }

    #[test]
    fn validate_transition_archived_is_terminal() {
        assert!(validate_transition("archived", "todo").is_err());
        assert!(validate_transition("archived", "completed").is_err());
        assert!(validate_transition("archived", "archived").is_ok()); // same state ok
    }

    #[test]
    fn validate_transition_inbox_to_any() {
        assert!(validate_transition("inbox", "todo").is_ok());
        assert!(validate_transition("inbox", "completed").is_ok());
    }

    #[test]
    fn validate_transition_completed_only_to_archived() {
        assert!(validate_transition("completed", "archived").is_ok());
        assert!(validate_transition("completed", "in_progress").is_err());
        assert!(validate_transition("completed", "todo").is_err());
    }

    #[test]
    fn save_task_generates_uuid() {
        let conn = in_memory_db();
        let task = Task {
            id: String::new(), title: "测试任务".to_string(), description: String::new(),
            status: "inbox".to_string(), priority: "none".to_string(), due_date: None,
            mood_tag: None, recurrence_rule: None, is_pinned: false, sort_order: 0,
            subtasks: Vec::new(), category: String::new(), tags: Vec::new(),
            created_at: String::new(), updated_at: String::new(),
        };
        let saved = save_task(&conn, task).unwrap();
        assert!(!saved.id.is_empty());
        // uuid v4 格式：8-4-4-4-12
        assert_eq!(saved.id.len(), 36);
    }

    #[test]
    fn save_task_empty_title_rejected() {
        let conn = in_memory_db();
        let task = Task {
            id: String::new(), title: "  ".to_string(), description: String::new(),
            status: "inbox".to_string(), priority: "none".to_string(), due_date: None,
            mood_tag: None, recurrence_rule: None, is_pinned: false, sort_order: 0,
            subtasks: Vec::new(), category: String::new(), tags: Vec::new(),
            created_at: String::new(), updated_at: String::new(),
        };
        assert!(save_task(&conn, task).is_err());
    }

    #[test]
    fn update_task_enforces_state_machine() {
        let conn = in_memory_db();
        let task = Task {
            id: String::new(), title: "T".to_string(), description: String::new(),
            status: "inbox".to_string(), priority: "none".to_string(), due_date: None,
            mood_tag: None, recurrence_rule: None, is_pinned: false, sort_order: 0,
            subtasks: Vec::new(), category: String::new(), tags: Vec::new(),
            created_at: String::new(), updated_at: String::new(),
        };
        let mut saved = save_task(&conn, task).unwrap();
        saved.status = "completed".to_string();
        assert!(update_task(&conn, &saved).is_ok()); // inbox → completed ok
        saved.status = "todo".to_string();
        assert!(update_task(&conn, &saved).is_err()); // completed → todo rejected
    }

    #[test]
    fn search_tasks_fts5() {
        let conn = in_memory_db();
        let t1 = Task { id: String::new(), title: "写周报".to_string(), description: "本周工作总结".to_string(), status: "inbox".to_string(), priority: "none".to_string(), due_date: None, mood_tag: None, recurrence_rule: None, is_pinned: false, sort_order: 0, subtasks: Vec::new(), category: String::new(), tags: Vec::new(), created_at: String::new(), updated_at: String::new() };
        let t2 = Task { id: String::new(), title: "买菜".to_string(), description: "去超市".to_string(), status: "inbox".to_string(), priority: "none".to_string(), due_date: None, mood_tag: None, recurrence_rule: None, is_pinned: false, sort_order: 0, subtasks: Vec::new(), category: String::new(), tags: Vec::new(), created_at: String::new(), updated_at: String::new() };
        save_task(&conn, t1).unwrap();
        save_task(&conn, t2).unwrap();
        let results = search_tasks(&conn, "周报").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "写周报");
    }

    #[test]
    fn test_delete_task_cascades() {
        let mut conn = in_memory_db();

        // 父任务 subtasks 引用子任务 ID；专注会话 task_id 引用子任务 ID
        let child_id = "child-uuid-001".to_string();
        let parent_id = "parent-uuid-001".to_string();

        let parent = Task {
            id: parent_id.clone(), title: "父任务".to_string(), description: String::new(),
            status: "inbox".to_string(), priority: "none".to_string(), due_date: None,
            mood_tag: None, recurrence_rule: None, is_pinned: false, sort_order: 0,
            subtasks: vec![child_id.clone()], category: String::new(), tags: Vec::new(),
            created_at: String::new(), updated_at: String::new(),
        };
        save_task(&conn, parent).unwrap();

        let child = Task {
            id: child_id.clone(), title: "子任务".to_string(), description: String::new(),
            status: "inbox".to_string(), priority: "none".to_string(), due_date: None,
            mood_tag: None, recurrence_rule: None, is_pinned: false, sort_order: 0,
            subtasks: Vec::new(), category: String::new(), tags: Vec::new(),
            created_at: String::new(), updated_at: String::new(),
        };
        save_task(&conn, child).unwrap();

        conn.execute(
            "INSERT INTO focus_sessions (id, start_time, task_id, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["fs-1", "2024-01-01T00:00:00+08:00", &child_id, "2024-01-01T00:00:00+08:00"],
        ).unwrap();

        // 删除子任务
        delete_task(&mut conn, &child_id).unwrap();

        // 1. focus_session.task_id 应被置 NULL（会话历史保留）
        let task_id: Option<String> = conn.query_row(
            "SELECT task_id FROM focus_sessions WHERE id = ?1",
            rusqlite::params!["fs-1"],
            |row| row.get(0),
        ).unwrap();
        assert!(task_id.is_none(), "focus_session.task_id 应被置 NULL");

        // 2. 父任务 subtasks JSON 不再包含子任务 ID
        let parent_after = get_task(&conn, &parent_id).unwrap();
        assert!(!parent_after.subtasks.contains(&child_id), "父任务 subtasks 应移除子任务 ID");
        assert!(parent_after.subtasks.is_empty());

        // 3. 子任务本身已删除
        assert!(get_task(&conn, &child_id).is_err(), "子任务应被删除");
    }
}
