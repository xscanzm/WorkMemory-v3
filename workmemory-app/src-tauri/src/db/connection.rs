// SQLite 链接初始化：WAL 模式 + 外键约束 + 同步策略 + 忙等待
// 严格遵循 02_DATA_MODEL.md §2 PRAGMA 规范与 01_ARCHITECTURAL_DECISIONS.md §3.1 依赖锁定

use rusqlite::Connection;
use std::path::Path;
use std::time::Duration;

/// 打开数据库连接并应用运行时 PRAGMA。
///
/// - `journal_mode = WAL`：写入不阻塞读，崩溃恢复更安全
/// - `foreign_keys = ON`：启用外键级联（memory_cells/embeddings/wiki_pages 依赖）
/// - `synchronous = NORMAL`：WAL 下兼顾安全与性能
/// - `busy_timeout = 5000ms`：多连接竞争时短暂等待而非立即报错
pub fn init(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_millis(5000))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;",
    )?;
    Ok(conn)
}
