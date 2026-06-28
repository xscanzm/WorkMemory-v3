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
    let affected = cascade_delete_task(&tx, id)?;
    if affected == 0 {
        // tx 在此 drop → 自动 ROLLBACK
        return Err(AppError::not_found(format!("任务不存在: {}", id)));
    }
    tx.commit()?;
    Ok(())
}

/// 单条任务的级联清理（在调用方提供的事务/连接上执行）。
///
/// 抽出此内部辅助是为了让 `batch_delete_tasks` 能在共享事务内复用同一组级联逻辑，
/// 保证"任一失败回滚整个批次"。返回受影响行数（0 表示该任务不存在，调用方决定是否报错）。
///
/// 接受 `&Connection` 而非 `&mut`，以便 `Transaction`（Deref<Target=Connection>）也能传入。
fn cascade_delete_task(conn: &Connection, id: &str) -> AppResult<i64> {
    // 1. SET NULL focus_sessions.task_id where it references this task
    conn.execute(
        "UPDATE focus_sessions SET task_id = NULL WHERE task_id = ?1",
        rusqlite::params![id],
    )?;

    // 2. Remove this task's ID from other tasks' subtasks JSON arrays.
    //    subtasks 列为 JSON TEXT（如 '["uuid1","uuid2"]'），先用 LIKE 粗筛候选行，
    //    再在内存中解析 JSON 精确移除，避免误伤仅子串匹配的 ID。
    let mut stmt = conn.prepare(
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
            conn.execute(
                "UPDATE tasks SET subtasks = ?1 WHERE id = ?2",
                rusqlite::params![new_json, task_id],
            )?;
        }
    }

    // 3. Delete the task itself
    let affected = conn.execute("DELETE FROM tasks WHERE id = ?1", rusqlite::params![id])?;
    Ok(affected as i64)
}

/// 批量删除任务（事务化，任一失败回滚整个批次）。
///
/// Task 21.3：在共享事务内对每个 id 调用 `cascade_delete_task` 完成级联清理；
/// 任意 id 不存在或清理失败时整批回滚，保证不会出现"部分删除部分保留"的脏状态。
/// 返回受影响行数（即成功删除的任务数）。
pub fn batch_delete_tasks(conn: &mut Connection, ids: &[String]) -> AppResult<i64> {
    let tx = conn.transaction()?;
    let mut total: i64 = 0;
    for id in ids {
        let affected = cascade_delete_task(&tx, id)?;
        if affected == 0 {
            // tx 在此 drop → 自动 ROLLBACK
            return Err(AppError::not_found(format!("任务不存在: {}", id)));
        }
        total += affected;
    }
    tx.commit()?;
    Ok(total)
}

/// 批量更新任务（事务化，任一失败回滚整个批次）。
///
/// Task 21.3：在共享事务内逐个 id 执行 UPDATE。状态机校验仍生效——
/// 例如批次中某任务已 archived，再批量 completed 时会因 archived→completed 非法流转
/// 而拒绝整批。返回受影响行数（即成功更新的任务数）。
///
/// 字段语义：
///   - `completed: Some(true)`  → status='completed'
///   - `completed: Some(false)` → status='todo'（取消完成）
///   - `archived: Some(true)`   → status='archived'
///   - `archived: Some(false)`  → status='todo'（取消归档）
///   - `priority: Some(s)`      → priority=s
///   - `tags: Some(vec)`        → tags=JSON(vec)
///   - 多个字段同时设置时按上述顺序解析 status（archived 优先级高于 completed）
pub fn batch_update_tasks(
    conn: &mut Connection,
    ids: &[String],
    updates: &crate::models::TaskBatchUpdate,
) -> AppResult<i64> {
    let tx = conn.transaction()?;
    let now = chrono::Local::now().format("%+").to_string();

    // 解析目标 status：completed/archived 互斥，archived 优先（更"终态"）
    let target_status: Option<&str> = if let Some(true) = updates.archived {
        Some("archived")
    } else if let Some(true) = updates.completed {
        Some("completed")
    } else if matches!(updates.archived, Some(false)) || matches!(updates.completed, Some(false)) {
        // 任一字段为 false（取消终态）→ 回到 todo
        Some("todo")
    } else {
        None
    };

    let mut total: i64 = 0;
    for id in ids {
        // 读取当前 status 用于状态机校验；不存在则整批回滚
        let current_status: String = tx
            .query_row(
                "SELECT status FROM tasks WHERE id = ?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::not_found(format!("任务不存在: {}", id))
                }
                other => AppError::DbError(other.to_string()),
            })?;

        let final_status = target_status.unwrap_or(current_status.as_str()).to_string();
        if final_status != current_status {
            validate_transition(&current_status, &final_status)?;
        }

        // 拼 UPDATE：按字段动态拼接 SET 子句，使用 Vec<Box<dyn ToSql>> 绑定动态参数
        let mut set_clauses: Vec<&str> = Vec::new();
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        set_clauses.push("status = ?");
        params_vec.push(Box::new(final_status.clone()));

        if let Some(ref p) = updates.priority {
            set_clauses.push("priority = ?");
            params_vec.push(Box::new(p.clone()));
        }
        if let Some(ref tags) = updates.tags {
            let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string());
            set_clauses.push("tags = ?");
            params_vec.push(Box::new(tags_json));
        }
        set_clauses.push("updated_at = ?");
        params_vec.push(Box::new(now.clone()));

        let sql = format!("UPDATE tasks SET {} WHERE id = ?", set_clauses.join(", "));
        params_vec.push(Box::new(id.clone())); // WHERE id = ?

        let param_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|b| b.as_ref()).collect();
        let affected = tx.execute(&sql, param_refs.as_slice())?;
        if affected == 0 {
            // tx 在此 drop → 自动 ROLLBACK
            return Err(AppError::not_found(format!("任务不存在: {}", id)));
        }
        total += affected as i64;

        // 衍生计算：与 update_task 对齐，仅在 status 真正转入 completed 时触发
        if final_status == "completed" && current_status != "completed" {
            crate::core::pet_engine::on_task_completed(&tx)?;
            crate::core::analytics_engine::on_task_completed(&tx)?;
        }
    }

    tx.commit()?;
    Ok(total)
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
        let conn = full_in_memory_db();
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

    // ---- 补充测试：生命周期 / subtasks / 排序 / 分页 / 批量 ----

    /// 含 pet_state + daily_stats 的完整内存数据库（用于 completed 流转触发衍生计算）
    fn full_in_memory_db() -> Connection {
        let conn = in_memory_db();
        conn.execute_batch(
            "CREATE TABLE pet_state (id TEXT PRIMARY KEY, species TEXT, level INTEGER, xp INTEGER, hunger INTEGER, energy INTEGER, happiness INTEGER, cleanliness INTEGER, bond_level INTEGER, mood TEXT, last_updated TEXT);\
             CREATE TABLE pet_interaction_logs (id TEXT PRIMARY KEY, action TEXT, delta TEXT, created_at TEXT);\
             CREATE TABLE daily_stats (date TEXT PRIMARY KEY, tasks_completed INTEGER, total_focus_time INTEGER, streak_count INTEGER, created_at TEXT, updated_at TEXT);\
             INSERT INTO pet_state (id, species, level, xp, hunger, energy, happiness, cleanliness, bond_level, mood, last_updated) VALUES ('default', 'cat', 1, 0, 80, 80, 80, 80, 0, 'happy', '2026-06-26T10:00:00+08:00');",
        )
        .unwrap();
        conn
    }

    fn sample_task(title: &str, sort_order: i64) -> Task {
        Task {
            id: String::new(), title: title.to_string(), description: String::new(),
            status: "inbox".to_string(), priority: "none".to_string(), due_date: None,
            mood_tag: None, recurrence_rule: None, is_pinned: false, sort_order,
            subtasks: Vec::new(), category: String::new(), tags: Vec::new(),
            created_at: String::new(), updated_at: String::new(),
        }
    }

    #[test]
    fn full_lifecycle_inbox_to_archived() {
        let conn = full_in_memory_db();
        let mut t = save_task(&conn, sample_task("T", 0)).unwrap();
        // inbox → todo
        t.status = "todo".to_string();
        assert!(update_task(&conn, &t).is_ok());
        // todo → in_progress
        t.status = "in_progress".to_string();
        assert!(update_task(&conn, &t).is_ok());
        // in_progress → completed（触发 pet/analytics 衍生计算）
        t.status = "completed".to_string();
        assert!(update_task(&conn, &t).is_ok());
        // completed → archived
        t.status = "archived".to_string();
        assert!(update_task(&conn, &t).is_ok());
        // archived → todo（终态，拒绝）
        t.status = "todo".to_string();
        assert!(update_task(&conn, &t).is_err());
    }

    #[test]
    fn subtasks_json_roundtrip() {
        let conn = in_memory_db();
        let mut task = sample_task("父任务", 0);
        task.subtasks = vec!["child-1".to_string(), "child-2".to_string()];
        let saved = save_task(&conn, task).unwrap();
        let fetched = get_task(&conn, &saved.id).unwrap();
        assert_eq!(fetched.subtasks, vec!["child-1".to_string(), "child-2".to_string()]);
    }

    #[test]
    fn get_all_tasks_sorted_by_sort_order() {
        let conn = in_memory_db();
        save_task(&conn, sample_task("T1", 2)).unwrap();
        save_task(&conn, sample_task("T2", 1)).unwrap();
        let tasks = get_all_tasks(&conn, None, None).unwrap();
        assert_eq!(tasks.len(), 2);
        // sort_order ASC：T2 (1) 在 T1 (2) 之前
        assert_eq!(tasks[0].title, "T2");
        assert_eq!(tasks[1].title, "T1");
    }

    #[test]
    fn get_all_tasks_pagination() {
        let conn = in_memory_db();
        for i in 0..5 {
            save_task(&conn, sample_task(&format!("T{}", i), i)).unwrap();
        }
        let page1 = get_all_tasks(&conn, Some(2), Some(0)).unwrap();
        assert_eq!(page1.len(), 2);
        let page2 = get_all_tasks(&conn, Some(2), Some(2)).unwrap();
        assert_eq!(page2.len(), 2);
        let page3 = get_all_tasks(&conn, Some(2), Some(4)).unwrap();
        assert_eq!(page3.len(), 1);
    }

    #[test]
    fn batch_delete_tasks_transactional_success() {
        let mut conn = in_memory_db();
        let t1 = save_task(&conn, sample_task("T1", 0)).unwrap();
        let t2 = save_task(&conn, sample_task("T2", 0)).unwrap();
        let affected = batch_delete_tasks(&mut conn, &[t1.id.clone(), t2.id.clone()]).unwrap();
        assert_eq!(affected, 2);
        assert!(get_task(&conn, &t1.id).is_err());
        assert!(get_task(&conn, &t2.id).is_err());
    }

    #[test]
    fn batch_delete_tasks_rolls_back_on_missing_id() {
        let mut conn = in_memory_db();
        let t1 = save_task(&conn, sample_task("T1", 0)).unwrap();
        // 第二个 id 不存在 → 整批回滚
        let result = batch_delete_tasks(&mut conn, &[t1.id.clone(), "nonexistent-id".to_string()]);
        assert!(result.is_err());
        // t1 应仍存在（回滚保护）
        assert!(get_task(&conn, &t1.id).is_ok());
    }

    #[test]
    fn batch_update_tasks_sets_completed() {
        let mut conn = full_in_memory_db();
        let t1 = save_task(&conn, sample_task("T1", 0)).unwrap();
        let mut t2 = save_task(&conn, sample_task("T2", 0)).unwrap();
        t2.status = "todo".to_string();
        update_task(&conn, &t2).unwrap(); // inbox → todo
        let t2 = get_task(&conn, &t2.id).unwrap();

        let updates = crate::models::TaskBatchUpdate {
            completed: Some(true),
            priority: None,
            archived: None,
            tags: None,
        };
        let affected = batch_update_tasks(&mut conn, &[t1.id.clone(), t2.id.clone()], &updates).unwrap();
        assert_eq!(affected, 2);
        let after1 = get_task(&conn, &t1.id).unwrap();
        assert_eq!(after1.status, "completed");
        let after2 = get_task(&conn, &t2.id).unwrap();
        assert_eq!(after2.status, "completed");
    }

    #[test]
    fn validate_transition_unknown_state_rejects() {
        assert!(validate_transition("unknown", "todo").is_err());
        assert!(validate_transition("todo", "unknown").is_err());
    }

    #[test]
    fn validate_transition_same_state_ok() {
        assert!(validate_transition("inbox", "inbox").is_ok());
        assert!(validate_transition("completed", "completed").is_ok());
        assert!(validate_transition("archived", "archived").is_ok());
    }
}
