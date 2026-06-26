// IPC 命令处理器 (对应 03_CORE_ARCHITECTURE.md §3.1)
//
// 全部 #[tauri::command] 函数名与 lib.rs 的 generate_handler! 列表逐字一致。
// 约定：
//   - 所有命令返回 Result<T, String>，错误统一转 String
//   - DB 连接通过 app.state::<std::sync::Mutex<rusqlite::Connection>>() 获取
//   - lock 后以 &conn 调用 db::repository 函数
//   - 依赖 core::distill / core::report / core::embedding 的命令直接调用对应函数
//     （这些模块由 Task 9/10/17 创建匹配签名的实现）

#![allow(dead_code)]
#![allow(unused_variables)]

use tauri::Manager;

use crate::db::repository;
use crate::models;

// ============================================================
// 录制状态机 (core::capture)
// ============================================================

/// 读取当前记录状态（Recording / Paused / PrivacyMode / Idle）。
#[tauri::command]
pub async fn get_recorder_state(app: tauri::AppHandle) -> Result<String, String> {
    Ok(core::capture::get_recorder_state(&app))
}

/// 设置记录状态；状态变更会触发 `recorder-state-changed` 事件。
#[tauri::command]
pub async fn set_recorder_state(app: tauri::AppHandle, state: String) -> Result<(), String> {
    core::capture::set_recorder_state(&app, state);
    Ok(())
}

/// 手动快速捕捉（Ghost Capture），返回 OCR 纯文本。
#[tauri::command]
pub async fn trigger_manual_capture(app: tauri::AppHandle) -> Result<String, String> {
    Ok(core::capture::trigger_manual_capture(app).await)
}

// ============================================================
// 蒸馏与日报 (core::distill / core::report)
// ============================================================

/// 获取指定日期的今日总结（由 core::distill 生成/缓存）。
#[tauri::command]
pub async fn get_today_summary(app: tauri::AppHandle, date: String) -> Result<String, String> {
    core::distill::get_today_summary(&app, &date).await
}

/// 生成工作报告（由 core::report 按 template_type 渲染）。
#[tauri::command]
pub async fn generate_report(
    app: tauri::AppHandle,
    date: String,
    template_type: String,
) -> Result<models::WorkReport, String> {
    core::report::generate_report(&app, &date, &template_type).await
}

// ============================================================
// Episode CRUD
// ============================================================

/// 获取某天的全部 Episode，按开始时间升序。
#[tauri::command]
pub async fn get_episodes_by_date(
    app: tauri::AppHandle,
    date: String,
) -> Result<Vec<models::CleanEpisode>, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    repository::get_episodes_by_date(&conn, &date).map_err(|e| e.to_string())
}

/// 用户手动编辑 Episode 标题与摘要。
#[tauri::command]
pub async fn update_episode_title_summary(
    app: tauri::AppHandle,
    id: String,
    title: String,
    summary: String,
) -> Result<(), String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    repository::update_episode_title_summary(&conn, &id, &title, &summary)
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================
// 检索 (FTS5 + 可选向量融合)
// ============================================================

/// 统一记忆检索：合并 segments / episodes / wiki 三表 FTS5 命中，
/// 若 settings.embedding_enabled 则融合 core::embedding::vector_search 语义命中。
///
/// 注意：必须在 await 之前释放 DB 锁，否则 vector_search 内部若再次获取同一连接会死锁。
#[tauri::command]
pub async fn search_memories(
    app: tauri::AppHandle,
    query: String,
    date_range: Option<(String, String)>,
) -> Result<Vec<models::SearchResult>, String> {
    let (mut results, embedding_enabled) = {
        let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
        let conn = state.lock().map_err(|e| e.to_string())?;
        let results =
            repository::search_memories(&conn, &query, date_range).map_err(|e| e.to_string())?;
        let settings = repository::get_settings(&conn).map_err(|e| e.to_string())?;
        (results, settings.embedding_enabled)
    };
    if embedding_enabled {
        let vec_results = core::embedding::vector_search(&app, &query).await?;
        results.extend(vec_results);
    }
    Ok(results)
}

// ============================================================
// Wiki
// ============================================================

/// 将 Episode 保存为 Wiki 页面，并把 Episode 的 wiki_status 置为 'saved'。
#[tauri::command]
pub async fn save_to_wiki(
    app: tauri::AppHandle,
    episode_id: String,
    title: String,
    content: String,
    tags: Vec<String>,
) -> Result<models::WikiPage, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    let now = chrono::Local::now().format("%+").to_string();
    let page = models::WikiPage {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        content,
        source_type: "episode".to_string(),
        source_episode_id: Some(episode_id.clone()),
        status: "saved".to_string(),
        tags,
        created_at: now.clone(),
        updated_at: now,
    };
    repository::insert_wiki_page(&conn, &page).map_err(|e| e.to_string())?;
    repository::update_episode_wiki_status(&conn, &episode_id, "saved")
        .map_err(|e| e.to_string())?;
    Ok(page)
}

/// 获取最近更新的 Wiki 列表（默认上限 100 条）。
#[tauri::command]
pub async fn get_wiki_pages(app: tauri::AppHandle) -> Result<Vec<models::WikiPage>, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    repository::get_wiki_pages(&conn, 100).map_err(|e| e.to_string())
}

/// 按 ID 获取单个 Wiki 页面。
#[tauri::command]
pub async fn get_wiki_page(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<models::WikiPage>, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    repository::get_wiki_page(&conn, &id).map_err(|e| e.to_string())
}

/// 获取待审阅队列：wiki_eligible=1 AND wiki_status='eligible' 的 Episode。
#[tauri::command]
pub async fn get_review_queue(app: tauri::AppHandle) -> Result<Vec<models::CleanEpisode>, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    repository::get_eligible_episodes_for_wiki(&conn).map_err(|e| e.to_string())
}

// ============================================================
// 设置
// ============================================================

/// 读取 AppSetting（settings 表 key='app'，缺失则返回 Default）。
#[tauri::command]
pub async fn get_settings(app: tauri::AppHandle) -> Result<models::AppSetting, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    repository::get_settings(&conn).map_err(|e| e.to_string())
}

/// 更新 AppSetting（upsert key='app'）。
#[tauri::command]
pub async fn update_settings(
    app: tauri::AppHandle,
    settings: models::AppSetting,
) -> Result<(), String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    repository::update_settings(&conn, &settings).map_err(|e| e.to_string())?;
    Ok(())
}

/// 从 settings 读取当前 Mascot ID。
#[tauri::command]
pub async fn get_mascot_id(app: tauri::AppHandle) -> Result<i64, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    let settings = repository::get_settings(&conn).map_err(|e| e.to_string())?;
    Ok(settings.mascot_id)
}

/// 更新 settings.mascot_id（读-改-写）。
#[tauri::command]
pub async fn set_mascot_id(app: tauri::AppHandle, mascot_id: i64) -> Result<(), String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    let mut settings = repository::get_settings(&conn).map_err(|e| e.to_string())?;
    settings.mascot_id = mascot_id;
    repository::update_settings(&conn, &settings).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================
// 日历与洞察
// ============================================================

/// 查询当月每天的 duration_seconds / summary / has_report，返回 Vec<CalendarDay>。
///
/// 为简化实现：summary 暂留空字符串（前端可点击日期后再拉取详情），
/// has_data = duration_seconds > 0，has_report 由 reports 表存在性判定。
#[tauri::command]
pub async fn get_calendar_month(
    app: tauri::AppHandle,
    year: i32,
    month: i32,
) -> Result<Vec<models::CalendarDay>, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;

    let days_in_month = days_in_month(year, month);
    let start_date = format!("{:04}-{:02}-01", year, month);
    let end_date = format!("{:04}-{:02}-{:02}", year, month, days_in_month);

    // 每日时长聚合
    let mut stmt = conn
        .prepare(
            "SELECT date, COALESCE(SUM(duration_seconds), 0) AS total \
             FROM segments \
             WHERE date >= ?1 AND date <= ?2 AND is_deleted = 0 \
             GROUP BY date",
        )
        .map_err(|e| e.to_string())?;
    let duration_map: std::collections::HashMap<String, i64> = stmt
        .query_map(rusqlite::params![start_date, end_date], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // 有报告的日期集合
    let mut stmt2 = conn
        .prepare("SELECT DISTINCT date FROM reports WHERE date >= ?1 AND date <= ?2")
        .map_err(|e| e.to_string())?;
    let report_set: std::collections::HashSet<String> = stmt2
        .query_map(rusqlite::params![start_date, end_date], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut result = Vec::with_capacity(days_in_month as usize);
    for day in 1..=days_in_month {
        let date = format!("{:04}-{:02}-{:02}", year, month, day);
        let duration = *duration_map.get(&date).unwrap_or(&0);
        let has_report = report_set.contains(&date);
        result.push(models::CalendarDay {
            date,
            has_data: duration > 0,
            duration_seconds: duration,
            summary: String::new(),
            has_report,
        });
    }
    Ok(result)
}

/// 获取当日洞察：统计时间分布、应用切换频率、未完成 todos，返回 Vec<Insight>。
#[tauri::command]
pub async fn get_insights(
    app: tauri::AppHandle,
    date: String,
) -> Result<Vec<models::Insight>, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    let now = chrono::Local::now().format("%+").to_string();
    let mut insights = Vec::new();

    // 1. 当日总记录时长
    let total_duration: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(duration_seconds), 0) FROM segments \
             WHERE date = ?1 AND is_deleted = 0",
            rusqlite::params![date],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if total_duration > 0 {
        let hours = total_duration / 3600;
        let minutes = (total_duration % 3600) / 60;
        insights.push(models::Insight {
            id: uuid::Uuid::new_v4().to_string(),
            r#type: "duration".to_string(),
            title: "今日记录时长".to_string(),
            description: format!("共记录 {} 小时 {} 分钟", hours, minutes),
            severity: "info".to_string(),
            created_at: now.clone(),
        });
    }

    // 2. 应用切换频率
    let switch_count: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT process_name) FROM segments \
             WHERE date = ?1 AND is_deleted = 0",
            rusqlite::params![date],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if switch_count > 5 {
        insights.push(models::Insight {
            id: uuid::Uuid::new_v4().to_string(),
            r#type: "focus".to_string(),
            title: "应用切换频繁".to_string(),
            description: format!(
                "今日切换了 {} 个不同应用，可能影响专注度",
                switch_count
            ),
            severity: "warning".to_string(),
            created_at: now.clone(),
        });
    }

    // 3. 未完成 todos（聚合当日所有 Episode 的 todos）
    let episodes =
        repository::get_episodes_by_date(&conn, &date).map_err(|e| e.to_string())?;
    let total_todos: usize = episodes.iter().map(|e| e.todos.len()).sum();
    if total_todos > 0 {
        insights.push(models::Insight {
            id: uuid::Uuid::new_v4().to_string(),
            r#type: "todo".to_string(),
            title: "待办事项".to_string(),
            description: format!("当日共 {} 条待办", total_todos),
            severity: "info".to_string(),
            created_at: now,
        });
    }

    Ok(insights)
}

// ============================================================
// 关系图谱
// ============================================================

/// 计算 Wiki + Episode + Entity 关系图谱数据。
///
/// 节点类型：wiki（绿）/ episode（蓝）/ entity（橙）。
/// 边：
///   - wiki → episode（source_episode_id，label="来源"）
///   - episode → entity（episode.entities，label="涉及"）
#[tauri::command]
pub async fn get_graph_data(app: tauri::AppHandle) -> Result<models::GraphData, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    // 1. Wiki 节点 + Wiki→Episode 边
    let wiki_pages = repository::get_wiki_pages(&conn, 100).map_err(|e| e.to_string())?;
    for page in &wiki_pages {
        nodes.push(models::GraphNode {
            id: page.id.clone(),
            label: page.title.clone(),
            r#type: "wiki".to_string(),
            color: "#4CAF50".to_string(),
        });
        if let Some(ref ep_id) = page.source_episode_id {
            edges.push(models::GraphEdge {
                source: page.id.clone(),
                target: ep_id.clone(),
                label: "来源".to_string(),
            });
        }
    }

    // 2. Episode 节点 + Episode→Entity 边
    let mut stmt = conn
        .prepare(
            "SELECT id, title, entities FROM clean_episodes \
             ORDER BY updated_at DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;
    let episode_rows: Vec<(String, String, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut entity_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (ep_id, title, entities_json) in &episode_rows {
        nodes.push(models::GraphNode {
            id: ep_id.clone(),
            label: if title.is_empty() {
                format!("Episode {}", &ep_id[..ep_id.len().min(8)])
            } else {
                title.clone()
            },
            r#type: "episode".to_string(),
            color: "#2196F3".to_string(),
        });
        let entities: Vec<String> = serde_json::from_str(entities_json).unwrap_or_default();
        for entity in &entities {
            let entity_node_id = format!("entity:{}", entity);
            if entity_set.insert(entity.clone()) {
                nodes.push(models::GraphNode {
                    id: entity_node_id.clone(),
                    label: entity.clone(),
                    r#type: "entity".to_string(),
                    color: "#FF9800".to_string(),
                });
            }
            edges.push(models::GraphEdge {
                source: ep_id.clone(),
                target: entity_node_id,
                label: "涉及".to_string(),
            });
        }
    }

    Ok(models::GraphData { nodes, edges })
}

// ============================================================
// 内部辅助
// ============================================================

/// 计算指定年份月份的天数（含闰年判定）。
fn days_in_month(year: i32, month: i32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}
