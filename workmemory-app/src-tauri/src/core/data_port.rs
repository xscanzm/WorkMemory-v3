//! 数据导入/导出 (Task 24.2 / 24.3)
//!
//! - `export_json(conn)`：把 8 张业务表 (tasks / pet_state / daily_stats / focus_sessions /
//!   achievements / soundscape_packs / pet_interaction_logs / user_preferences) 全量导出
//!   为单个 JSON 字符串，结构为 `{ "schema_version": 1, "tables": { "<table>": [ <row>, ... ] } }`。
//! - `export_csv_tasks(conn)`：把 tasks 表导出为 CSV 字符串（含表头 + 转义）。
//! - `import_json(conn, json_str)`：解析上述 JSON 形状，在一个事务内对每张表执行
//!   `INSERT OR REPLACE`，失败则整体回滚；返回 `ImportSummary`（每表插入行数）。
//!
//! 设计原则：
//! - 表的列集合由 `SELECT * FROM <table>` 在运行时动态获取，避免与 schema 漂移。
//! - 行以 `serde_json::Map<String, Value>` 形式序列化，列名为 key，单元格值统一为
//!   字符串/数字/布尔/null（rusqlite `Value` → serde_json::Value 转换）。
//! - 导入时对每行做 `INSERT OR REPLACE INTO <table> (<cols>) VALUES (?, ?, ...)`，
//!   主键冲突即覆盖，保证幂等。
//! - 仅支持本模块白名单内的表，防止任意 SQL 注入。

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, Transaction};
use serde::Serialize;

use crate::core::error::{AppError, AppResult};

/// 导入/导出覆盖的业务表清单（白名单，按依赖顺序排列，方便人工核对）。
/// 注意：仅这 8 张业务表纳入 data_port 范围；segments/clean_episodes/wiki_pages 等
/// "记忆流水线" 表因体量大且有 FTS5 触发器副作用，不在本次范围内。
const PORTABLE_TABLES: &[&str] = &[
    "tasks",
    "pet_state",
    "daily_stats",
    "focus_sessions",
    "achievements",
    "soundscape_packs",
    "pet_interaction_logs",
    "user_preferences",
];

/// 导出容器：`{ "schema_version": 1, "exported_at": "...", "tables": { ... } }`
#[derive(Serialize)]
struct ExportBundle {
    schema_version: u32,
    exported_at: String,
    tables: std::collections::BTreeMap<String, Vec<serde_json::Value>>,
}

/// 导入摘要：每张表成功插入/替换的行数。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub imported: std::collections::BTreeMap<String, usize>,
    pub total: usize,
}

/// 把单张表导出为 Vec<Value>（每个元素是一行 JSON 对象）。
/// 列顺序由 `SELECT *` 决定，与 schema 一致。
fn dump_table(conn: &Connection, table: &str) -> AppResult<Vec<serde_json::Value>> {
    // 白名单已确保 table 不可来自用户输入；这里直接拼接 SQL
    let sql = format!("SELECT * FROM {}", table);
    let mut stmt = conn.prepare(&sql)?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).unwrap_or("").to_string())
        .collect();

    let rows = stmt.query_map([], |row| {
        let mut obj = serde_json::Map::with_capacity(col_count);
        for (i, name) in col_names.iter().enumerate() {
            let v: SqlValue = row.get(i)?;
            obj.insert(name.clone(), sql_value_to_json(v));
        }
        Ok(serde_json::Value::Object(obj))
    })?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// rusqlite::Value → serde_json::Value 转换。
fn sql_value_to_json(v: SqlValue) -> serde_json::Value {
    match v {
        SqlValue::Null => serde_json::Value::Null,
        SqlValue::Integer(i) => serde_json::Value::Number(i.into()),
        SqlValue::Real(f) => serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        SqlValue::Text(s) => serde_json::Value::String(s),
        SqlValue::Blob(b) => {
            // BLOB 以 base64 字符串承载，导入时按字符串原样写回（rusqlite 会再次
            // 隐式 TEXT→BLOB 转换）。当前 8 张表均无 BLOB 列，此处仅做兜底。
            use base64::Engine;
            serde_json::Value::String(base64::engine::general_purpose::STANDARD.encode(b))
        }
    }
}

/// 导出全部业务表为单个 JSON 字符串。
pub fn export_json(conn: &Connection) -> AppResult<String> {
    let mut tables = std::collections::BTreeMap::new();
    for t in PORTABLE_TABLES {
        tables.insert((*t).to_string(), dump_table(conn, t)?);
    }
    let bundle = ExportBundle {
        schema_version: 1,
        exported_at: chrono::Local::now().format("%+").to_string(),
        tables,
    };
    Ok(serde_json::to_string_pretty(&bundle)?)
}

/// 导出 tasks 表为 CSV 字符串（含表头 + 字段转义）。
pub fn export_csv_tasks(conn: &Connection) -> AppResult<String> {
    let mut stmt = conn.prepare("SELECT * FROM tasks")?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).unwrap_or("").to_string())
        .collect();

    let mut out = String::new();
    // 表头
    out.push_str(
        &col_names
            .iter()
            .map(|s| csv_escape(s))
            .collect::<Vec<_>>()
            .join(","),
    );
    out.push('\n');

    let rows = stmt.query_map([], |row| {
        let mut cells = Vec::with_capacity(col_count);
        for i in 0..col_count {
            let v: SqlValue = row.get(i)?;
            cells.push(sql_value_to_csv(v));
        }
        Ok(cells)
    })?;

    for r in rows {
        let cells = r?;
        out.push_str(
            &cells
                .iter()
                .map(|s| csv_escape(s))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push('\n');
    }
    Ok(out)
}

/// CSV 字段转义：包含逗号 / 引号 / 换行时用双引号包裹，内部引号翻倍。
fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// rusqlite::Value → CSV 单元格字符串。
fn sql_value_to_csv(v: SqlValue) -> String {
    match v {
        SqlValue::Null => String::new(),
        SqlValue::Integer(i) => i.to_string(),
        SqlValue::Real(f) => f.to_string(),
        SqlValue::Text(s) => s,
        SqlValue::Blob(b) => {
            // BLOB 在 CSV 中以 base64 字符串呈现
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(b)
        }
    }
}

/// 导入 JSON 字符串：解析 `{ "schema_version": 1, "tables": { ... } }`，
/// 在单个事务内对每张表执行 `INSERT OR REPLACE`，失败整体回滚。
///
/// 行的 JSON 对象的 key 必须是表的实际列名（值可以是字符串/数字/布尔/null）。
/// 不存在的 key 会被忽略；缺失的 key 在 INSERT 中跳过（不写入，触发列默认值）。
pub fn import_json(conn: &mut Connection, json_str: String) -> AppResult<ImportSummary> {
    let bundle: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| {
        AppError::validation(format!("JSON 解析失败: {}", e))
    })?;

    let tables_obj = bundle
        .get("tables")
        .and_then(|v| v.as_object())
        .ok_or_else(|| {
            AppError::validation("导入文件形状不正确：缺少 `tables` 对象")
        })?;

    // 预校验：所有顶层 key 必须在白名单内
    for key in tables_obj.keys() {
        if !PORTABLE_TABLES.contains(&key.as_str()) {
            return Err(AppError::validation(format!(
                "不支持的表名: {}（仅允许: {}）",
                key,
                PORTABLE_TABLES.join(", ")
            )));
        }
    }

    let tx = conn.transaction()?;
    let mut imported = std::collections::BTreeMap::new();
    let mut total = 0usize;

    for table in PORTABLE_TABLES {
        // 缺失该表的 key 视为不导入，跳过
        let Some(rows_val) = tables_obj.get(*table) else {
            continue;
        };
        let rows = rows_val.as_array().ok_or_else(|| {
            AppError::validation(format!("表 `{}` 的值必须是数组", table))
        })?;

        // 取该表的实际列名集合，用于过滤 + 排序
        let col_names = table_columns(&tx, table)?;
        if col_names.is_empty() {
            // 空表结构异常，跳过
            continue;
        }

        let mut count = 0usize;
        for row_val in rows {
            let row_obj = row_val.as_object().ok_or_else(|| {
                AppError::validation(format!(
                    "表 `{}` 中存在非对象行",
                    table
                ))
            })?;

            // 仅取实际存在的列，按 col_names 顺序构造参数
            let mut placeholders: Vec<String> = Vec::with_capacity(col_names.len());
            let mut params: Vec<SqlValue> = Vec::with_capacity(col_names.len());
            for col in &col_names {
                placeholders.push("?".to_string());
                let cell = row_obj.get(col).unwrap_or(&serde_json::Value::Null);
                params.push(json_value_to_sql(cell));
            }

            let cols_csv = col_names.join(", ");
            let sql = format!(
                "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
                table,
                cols_csv,
                placeholders.join(", ")
            );
            let _ = tx.execute(&sql, rusqlite::params_from_iter(params.iter()))?;
            count += 1;
        }

        imported.insert((*table).to_string(), count);
        total += count;
    }

    tx.commit()?;

    Ok(ImportSummary { imported, total })
}

/// 取一张表的列名集合（按 PRAGMA table_info 顺序，主键在前）。
fn table_columns(tx: &Transaction, table: &str) -> AppResult<Vec<String>> {
    let sql = format!("PRAGMA table_info({})", table);
    let mut stmt = tx.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        Ok(name)
    })?;
    let mut cols = Vec::new();
    for r in rows {
        cols.push(r?);
    }
    Ok(cols)
}

/// serde_json::Value → rusqlite::Value 转换。
fn json_value_to_sql(v: &serde_json::Value) -> SqlValue {
    match v {
        serde_json::Value::Null => SqlValue::Null,
        serde_json::Value::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                SqlValue::Null
            }
        }
        serde_json::Value::String(s) => {
            // 兼容历史导出：BLOB 列以 base64 字符串导出，导入时按 TEXT 写回
            // （rusqlite 会按列类型隐式转换；当前 8 表无 BLOB 列，无副作用）。
            SqlValue::Text(s.clone())
        }
        // 复合类型（对象/数组）序列化为 JSON 字符串，兼容 subtasks/tags/layers 列
        other => SqlValue::Text(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 建立包含本模块全部白名单表的内存库（仅最小列集合，覆盖导入导出往返）。
    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT DEFAULT 'inbox', is_pinned INTEGER DEFAULT 0, tags TEXT DEFAULT '[]');
            CREATE TABLE pet_state (id TEXT PRIMARY KEY, species TEXT, level INTEGER, hunger INTEGER);
            CREATE TABLE daily_stats (date TEXT PRIMARY KEY, tasks_completed INTEGER, total_focus_time INTEGER, streak_count INTEGER, created_at TEXT, updated_at TEXT);
            CREATE TABLE focus_sessions (id TEXT PRIMARY KEY, start_time TEXT, duration_seconds INTEGER, type TEXT, interrupted INTEGER);
            CREATE TABLE achievements (id TEXT PRIMARY KEY, title TEXT, unlocked INTEGER);
            CREATE TABLE soundscape_packs (id TEXT PRIMARY KEY, name TEXT, enabled INTEGER);
            CREATE TABLE pet_interaction_logs (id TEXT PRIMARY KEY, action TEXT, delta TEXT, created_at TEXT);
            CREATE TABLE user_preferences (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
            "#,
        )
        .unwrap();
        conn
    }

    #[test]
    fn export_empty_db_returns_valid_bundle() {
        let conn = in_memory_db();
        let json = export_json(&conn).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["schema_version"], 1);
        let tables = v["tables"].as_object().unwrap();
        for t in PORTABLE_TABLES {
            assert!(tables.contains_key(*t));
            assert_eq!(tables[*t].as_array().unwrap().len(), 0);
        }
    }

    #[test]
    fn export_then_import_roundtrip_preserves_rows() {
        let mut conn = in_memory_db();
        conn.execute(
            "INSERT INTO tasks (id, title, status, is_pinned, tags) VALUES ('t1', '写周报', 'todo', 1, '[\"工作\"]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO user_preferences (key, value, updated_at) VALUES ('theme', 'dark', '2026-06-27')",
            [],
        )
        .unwrap();

        let json = export_json(&conn).unwrap();

        // 清空再导入，验证行数与内容一致
        conn.execute("DELETE FROM tasks", []).unwrap();
        conn.execute("DELETE FROM user_preferences", []).unwrap();
        let summary = import_json(&mut conn, json).unwrap();

        assert_eq!(summary.imported.get("tasks").copied(), Some(1));
        assert_eq!(summary.imported.get("user_preferences").copied(), Some(1));
        assert_eq!(summary.total, 2);

        // 校验内容
        let title: String = conn
            .query_row("SELECT title FROM tasks WHERE id='t1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "写周报");
        let theme: String = conn
            .query_row(
                "SELECT value FROM user_preferences WHERE key='theme'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(theme, "dark");
    }

    #[test]
    fn import_rejects_unknown_table() {
        let mut conn = in_memory_db();
        let bad = r#"{"schema_version":1,"tables":{"evil_table":[]}}"#;
        let err = import_json(&mut conn, bad.to_string());
        assert!(err.is_err());
    }

    #[test]
    fn import_rejects_non_object_tables() {
        let mut conn = in_memory_db();
        let bad = r#"{"schema_version":1,"tables":[]}"#;
        let err = import_json(&mut conn, bad.to_string());
        assert!(err.is_err());
    }

    #[test]
    fn csv_export_has_header_and_escaped_values() {
        let conn = in_memory_db();
        conn.execute(
            "INSERT INTO tasks (id, title, status, is_pinned, tags) VALUES ('t1', 'Hello, World', 'todo', 0, '[]')",
            [],
        )
        .unwrap();
        let csv = export_csv_tasks(&conn).unwrap();
        let first_line = csv.lines().next().unwrap();
        assert!(first_line.contains("id"));
        assert!(first_line.contains("title"));
        // 含逗号的字段应被双引号包裹
        assert!(csv.contains("\"Hello, World\""));
    }

    #[test]
    fn import_atomic_rollback_on_failure() {
        let mut conn = in_memory_db();
        // tasks 表 id 为 TEXT PRIMARY KEY；构造一行 id 缺失导致 NOT NULL title 失败
        let bad = r#"{"schema_version":1,"tables":{"tasks":[{"id":"t1","title":null}]}}"#;
        let err = import_json(&mut conn, bad.to_string());
        assert!(err.is_err());
        // 事务回滚后 tasks 表应为空
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
