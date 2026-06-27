//! 音景引擎：音频包加载 + 多层混合 + 音量控制
//!
//! 注意：实际音频文件资源尚未提供，本引擎提供数据层 + 命令，
//! 前端通过 HTML5 Audio API 播放 asset:// 协议资源。
//!
//! 表 soundscape_packs 列：id / name / description / layers(JSON) / enabled / created_at
//! 其中 layers 在表注释中标注为 "JSON array of {name, file, volume}"，
//! 当前 models::SoundscapePack.layers 为 Vec<String>，二者保持兼容：
//! 读取时若 JSON 解析失败则降级为空 Vec，避免阻塞空态展示。
use rusqlite::Connection;

use crate::core::error::{AppError, AppResult};
use crate::models::SoundscapePack;

/// 列顺序：id, name, description, layers, enabled, created_at
const PACK_COLS: &str = "id, name, description, layers, enabled, created_at";

/// 获取所有已启用的音景包
pub fn get_soundscape_packs(conn: &Connection) -> AppResult<Vec<SoundscapePack>> {
    let sql = format!(
        "SELECT {} FROM soundscape_packs WHERE enabled = 1 ORDER BY name ASC",
        PACK_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let packs = stmt
        .query_map([], row_to_pack)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(packs)
}

/// 获取所有音景包（含禁用）
pub fn get_all_soundscape_packs(conn: &Connection) -> AppResult<Vec<SoundscapePack>> {
    let sql = format!("SELECT {} FROM soundscape_packs ORDER BY name ASC", PACK_COLS);
    let mut stmt = conn.prepare(&sql)?;
    let packs = stmt
        .query_map([], row_to_pack)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(packs)
}

/// 启用/禁用音景包
pub fn toggle_soundscape_pack(conn: &Connection, id: &str, enabled: bool) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE soundscape_packs SET enabled = ?1 WHERE id = ?2",
        rusqlite::params![enabled as i32, id],
    )?;
    if affected == 0 {
        return Err(AppError::not_found(format!("音景包不存在: {}", id)));
    }
    Ok(())
}

/// 行 → SoundscapePack
/// layers 列存储为 JSON 字符串，解析失败时降级为空 Vec（容错处理）。
fn row_to_pack(row: &rusqlite::Row<'_>) -> rusqlite::Result<SoundscapePack> {
    let layers_str: String = row.get(3)?;
    let layers: Vec<String> = serde_json::from_str(&layers_str).unwrap_or_default();
    Ok(SoundscapePack {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        layers,
        enabled: row.get::<_, i32>(4)? != 0,
        created_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE soundscape_packs (id TEXT PRIMARY KEY, name TEXT, description TEXT, layers TEXT, enabled INTEGER, created_at TEXT)",
        )
        .unwrap();
        conn
    }

    #[test]
    fn get_empty_packs() {
        let conn = in_memory_db();
        assert_eq!(get_soundscape_packs(&conn).unwrap().len(), 0);
        assert_eq!(get_all_soundscape_packs(&conn).unwrap().len(), 0);
    }

    #[test]
    fn get_only_enabled_packs() {
        let conn = in_memory_db();
        conn.execute(
            "INSERT INTO soundscape_packs (id, name, description, layers, enabled, created_at) VALUES ('p1', '雨声', '', '[]', 1, '')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO soundscape_packs (id, name, description, layers, enabled, created_at) VALUES ('p2', '咖啡馆', '', '[]', 0, '')",
            [],
        )
        .unwrap();
        let enabled = get_soundscape_packs(&conn).unwrap();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].name, "雨声");
        let all = get_all_soundscape_packs(&conn).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn toggle_pack() {
        let conn = in_memory_db();
        conn.execute(
            "INSERT INTO soundscape_packs (id, name, description, layers, enabled, created_at) VALUES ('p1', '雨声', '', '[]', 1, '')",
            [],
        )
        .unwrap();
        toggle_soundscape_pack(&conn, "p1", false).unwrap();
        let packs = get_all_soundscape_packs(&conn).unwrap();
        assert!(!packs[0].enabled);
        // 再切回启用
        toggle_soundscape_pack(&conn, "p1", true).unwrap();
        let packs = get_all_soundscape_packs(&conn).unwrap();
        assert!(packs[0].enabled);
    }

    #[test]
    fn toggle_nonexistent_returns_not_found() {
        let conn = in_memory_db();
        assert!(toggle_soundscape_pack(&conn, "nope", true).is_err());
    }

    #[test]
    fn layers_json_parses_or_defaults_empty() {
        let conn = in_memory_db();
        // 正常 JSON 数组
        conn.execute(
            "INSERT INTO soundscape_packs (id, name, description, layers, enabled, created_at) VALUES ('p1', '雨声', '', '[\"rain.mp3\",\"thunder.mp3\"]', 1, '')",
            [],
        )
        .unwrap();
        let packs = get_soundscape_packs(&conn).unwrap();
        assert_eq!(packs[0].layers.len(), 2);
        assert_eq!(packs[0].layers[0], "rain.mp3");

        // 损坏 JSON → 降级为空 Vec，不抛错
        conn.execute(
            "INSERT INTO soundscape_packs (id, name, description, layers, enabled, created_at) VALUES ('p2', '咖啡馆', '', 'not-json', 1, '')",
            [],
        )
        .unwrap();
        let packs = get_all_soundscape_packs(&conn).unwrap();
        let cafe = packs.iter().find(|p| p.id == "p2").unwrap();
        assert_eq!(cafe.layers.len(), 0);
    }
}
