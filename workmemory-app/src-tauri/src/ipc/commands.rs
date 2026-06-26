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

/// 按 ID 获取单个 Episode（用于图谱节点双击穿梭回历史 Episode）。
#[tauri::command]
pub async fn get_episode_by_id(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<models::CleanEpisode>, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    repository::get_episode_by_id(&conn, &id).map_err(|e| e.to_string())
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
    date_range: Option<DateRange>,
) -> Result<Vec<models::SearchResult>, String> {
    // 前端 api.ts 发送 {from, to} 对象，serde 无法反序列化为元组 (String, String)，
    // 这里先反序列化为 DateRange 结构体，再转换为 repository 层期望的元组。
    let dr_tuple = date_range.map(|d| (d.from, d.to));
    let (mut results, embedding_enabled) = {
        let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
        let conn = state.lock().map_err(|e| e.to_string())?;
        let results =
            repository::search_memories(&conn, &query, dr_tuple).map_err(|e| e.to_string())?;
        let settings = repository::get_settings(&conn).map_err(|e| e.to_string())?;
        (results, settings.embedding_enabled)
    };
    if embedding_enabled {
        let vec_results = core::embedding::vector_search(&app, &query).await?;
        results.extend(vec_results);
    }
    Ok(results)
}

/// 日期范围筛选器（前端发送 `{from, to}` 对象，对应 ISO 日期字符串）。
/// 反序列化为结构体后再转换为 repository 层期望的 `(String, String)` 元组。
#[derive(serde::Deserialize)]
struct DateRange {
    from: String,
    to: String,
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
        source_type: "ai".to_string(),
        source_episode_id: Some(episode_id.clone()),
        status: "draft".to_string(),
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

/// 获取当日洞察：时间分布 / 频繁切换 / 未完成线索 / 深度专注，返回 Vec<Insight>。
///
/// insight type 与前端 InsightsView.tsx 对齐：
///   - "time_distribution"：各应用时长分布（metadata.apps）
///   - "fragmented_switch"：应用切换频繁（warning）
///   - "open_todo"：未完成线索（metadata.episodes，仅含 todos 非空的 episode）
///   - "deep_focus"：连续 ≥25 分钟单应用片段（metadata.sessions）
#[tauri::command]
pub async fn get_insights(
    app: tauri::AppHandle,
    date: String,
) -> Result<Vec<models::Insight>, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    let now = chrono::Local::now().format("%+").to_string();
    let mut insights = Vec::new();

    // 1. 时间分布（type=time_distribution，metadata.apps）
    let mut stmt = conn
        .prepare(
            "SELECT process_name, SUM(duration_seconds) FROM segments \
             WHERE date = ?1 AND is_deleted = 0 AND is_private = 0 \
             GROUP BY process_name ORDER BY SUM(duration_seconds) DESC LIMIT 10",
        )
        .map_err(|e| e.to_string())?;
    let apps: Vec<(String, i64)> = stmt
        .query_map(rusqlite::params![date], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    if !apps.is_empty() {
        let total: i64 = apps.iter().map(|(_, s)| s).sum();
        let hours = total / 3600;
        let minutes = (total % 3600) / 60;
        let apps_json: Vec<serde_json::Value> = apps
            .iter()
            .map(|(app, secs)| serde_json::json!({"app": app, "seconds": secs}))
            .collect();
        insights.push(models::Insight {
            id: uuid::Uuid::new_v4().to_string(),
            r#type: "time_distribution".to_string(),
            title: "今日时间分布".to_string(),
            description: format!("共记录 {} 小时 {} 分钟", hours, minutes),
            severity: "info".to_string(),
            metadata: Some(serde_json::json!({"apps": apps_json}).to_string()),
            created_at: now.clone(),
        });
    }

    // 2. 频繁切换（type=fragmented_switch，warning）
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
            r#type: "fragmented_switch".to_string(),
            title: "应用切换频繁".to_string(),
            description: format!(
                "今日切换了 {} 个不同应用，可能影响专注度",
                switch_count
            ),
            severity: "warning".to_string(),
            metadata: None,
            created_at: now.clone(),
        });
    }

    // 3. 未完成线索（type=open_todo，metadata.episodes，仅含 todos 非空的 episode）
    let episodes =
        repository::get_episodes_by_date(&conn, &date).map_err(|e| e.to_string())?;
    let todo_episodes: Vec<&models::CleanEpisode> = episodes
        .iter()
        .filter(|e| !e.todos.is_empty())
        .collect();
    if !todo_episodes.is_empty() {
        let total_todos: usize = todo_episodes.iter().map(|e| e.todos.len()).sum();
        let eps_json: Vec<serde_json::Value> = todo_episodes
            .iter()
            .map(|ep| serde_json::json!({"title": ep.title, "todos": ep.todos}))
            .collect();
        insights.push(models::Insight {
            id: uuid::Uuid::new_v4().to_string(),
            r#type: "open_todo".to_string(),
            title: "待办事项".to_string(),
            description: format!("当日共 {} 条待办", total_todos),
            severity: "info".to_string(),
            metadata: Some(serde_json::json!({"episodes": eps_json}).to_string()),
            created_at: now.clone(),
        });
    }

    // 4. 深度专注统计（type=deep_focus，连续 ≥25 分钟单应用片段，metadata.sessions）
    let mut stmt = conn
        .prepare(
            "SELECT process_name, start_time, end_time, duration_seconds FROM segments \
             WHERE date = ?1 AND is_deleted = 0 AND is_private = 0 AND duration_seconds >= 1500 \
             ORDER BY start_time",
        )
        .map_err(|e| e.to_string())?;
    let sessions: Vec<(String, String, String, i64)> = stmt
        .query_map(rusqlite::params![date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    if !sessions.is_empty() {
        let n = sessions.len();
        let max_dur = sessions.iter().map(|(_, _, _, d)| *d).max().unwrap_or(0);
        let max_min = max_dur / 60;
        let sessions_json: Vec<serde_json::Value> = sessions
            .iter()
            .map(|(app, start, _end, dur)| {
                serde_json::json!({"app": app, "duration": dur, "start": start})
            })
            .collect();
        insights.push(models::Insight {
            id: uuid::Uuid::new_v4().to_string(),
            r#type: "deep_focus".to_string(),
            title: "深度专注".to_string(),
            description: format!("今日有 {} 段深度专注，最长 {} 分钟", n, max_min),
            severity: "info".to_string(),
            metadata: Some(serde_json::json!({"sessions": sessions_json}).to_string()),
            created_at: now.clone(),
        });
    }

    Ok(insights)
}

// ============================================================
// 关系图谱
// ============================================================

/// 计算关系图谱数据。
///
/// 节点类型（5 类，颜色与前端 ForceGraph NODE_COLORS 对齐）：
///   - document：Wiki 页面（#8B5CF6）
///   - episode：逻辑事件（#10B981）
///   - project：Episode.project（#F59E0B）
///   - person：Episode.entities 中的人名（#2563EB）
///   - time：Episode.date（#0D9488）
/// 边：
///   - document → episode（source_episode_id，label="来源"）
///   - episode → project（label="属于"）
///   - episode → person（label="涉及"）
///   - episode → time（label="发生在"）
///   - document → document（[[wikilink]] 引用，label="引用"）
#[tauri::command]
pub async fn get_graph_data(app: tauri::AppHandle) -> Result<models::GraphData, String> {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = state.lock().map_err(|e| e.to_string())?;
    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    let mut project_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut person_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut time_set: std::collections::HashSet<String> = std::collections::HashSet::new();

    // 1. Wiki → document 节点 + document→episode 边
    let wiki_pages = repository::get_wiki_pages(&conn, 100).map_err(|e| e.to_string())?;
    // 标题→id 映射，供 [[wikilink]] 双链解析使用
    let mut wiki_title_to_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for page in &wiki_pages {
        nodes.push(models::GraphNode {
            id: page.id.clone(),
            label: page.title.clone(),
            r#type: "document".to_string(),
            // color 字段保留为空：前端 ForceGraph 按 type→CSS 变量派生颜色
            color: String::new(),
        });
        wiki_title_to_id.insert(page.title.clone(), page.id.clone());
        if let Some(ref ep_id) = page.source_episode_id {
            edges.push(models::GraphEdge {
                source: page.id.clone(),
                target: ep_id.clone(),
                label: "来源".to_string(),
            });
        }
    }

    // 2. Episode 节点 + project/person/time 节点与边
    let mut stmt = conn
        .prepare(
            "SELECT id, title, entities, project, date FROM clean_episodes \
             ORDER BY updated_at DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;
    let episode_rows: Vec<(String, String, String, String, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for (ep_id, title, entities_json, project, date) in &episode_rows {
        // episode 节点
        nodes.push(models::GraphNode {
            id: ep_id.clone(),
            label: if title.is_empty() {
                format!("Episode {}", &ep_id[..ep_id.len().min(8)])
            } else {
                title.clone()
            },
            r#type: "episode".to_string(),
            color: String::new(),
        });

        // project 节点（非空时），HashSet 去重
        if !project.is_empty() {
            let project_node_id = format!("project:{}", project);
            if project_set.insert(project.clone()) {
                nodes.push(models::GraphNode {
                    id: project_node_id.clone(),
                    label: project.clone(),
                    r#type: "project".to_string(),
                    color: String::new(),
                });
            }
            edges.push(models::GraphEdge {
                source: ep_id.clone(),
                target: project_node_id,
                label: "属于".to_string(),
            });
        }

        // person 节点（Episode.entities），HashSet 去重
        let entities: Vec<String> = serde_json::from_str(entities_json).unwrap_or_default();
        for entity in &entities {
            let person_node_id = format!("person:{}", entity);
            if person_set.insert(entity.clone()) {
                nodes.push(models::GraphNode {
                    id: person_node_id.clone(),
                    label: entity.clone(),
                    r#type: "person".to_string(),
                    color: String::new(),
                });
            }
            edges.push(models::GraphEdge {
                source: ep_id.clone(),
                target: person_node_id,
                label: "涉及".to_string(),
            });
        }

        // time 节点（Episode.date，同一天只建一个）
        if !date.is_empty() {
            let time_node_id = format!("time:{}", date);
            if time_set.insert(date.clone()) {
                nodes.push(models::GraphNode {
                    id: time_node_id.clone(),
                    label: date.clone(),
                    r#type: "time".to_string(),
                    color: String::new(),
                });
            }
            edges.push(models::GraphEdge {
                source: ep_id.clone(),
                target: time_node_id,
                label: "发生在".to_string(),
            });
        }
    }

    // 3. [[wikilink]] 引用边：document → document，label="引用"
    // 遍历所有 wiki_pages 的 content，提取 [[标题]]，若目标标题存在则建边
    for page in &wiki_pages {
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for target_title in extract_wikilinks(&page.content) {
            if !seen.insert(target_title.clone()) {
                continue;
            }
            if let Some(target_id) = wiki_title_to_id.get(&target_title) {
                // 避免自引用
                if target_id != &page.id {
                    edges.push(models::GraphEdge {
                        source: page.id.clone(),
                        target: target_id.clone(),
                        label: "引用".to_string(),
                    });
                }
            }
        }
    }

    Ok(models::GraphData { nodes, edges })
}

/// 手动解析 `[[wikilink]]` 双链标题（不依赖 regex crate）。
/// 提取所有 `[[...]]` 中非空、去空白后的标题，保持出现顺序（含重复），
/// 由调用方按需去重。
fn extract_wikilinks(content: &str) -> Vec<String> {
    let mut links = Vec::new();
    let bytes = content.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let rest = &content[i + 2..];
            if let Some(end) = rest.find("]]") {
                let title = rest[..end].trim();
                if !title.is_empty() {
                    links.push(title.to_string());
                }
                i = i + 2 + end + 2;
                continue;
            }
        }
        i += 1;
    }
    links
}

// ============================================================
// Mascot 资源
// ============================================================

/// 列出全部 9 个桌面伙伴的元信息（从打包资源 pet/{1..9}/pet.json 读取）。
///
/// 返回 Vec<MascotInfo>，字段：id / display_name / description。
/// 读取失败时跳过该伙伴（不阻断整体返回）。
#[tauri::command]
pub async fn list_mascots(app: tauri::AppHandle) -> Result<Vec<MascotInfo>, String> {
    use tauri::Manager;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取 resource_dir: {}", e))?;
    let pet_dir = resource_dir.join("pet");
    let mut result = Vec::new();
    for id in 1..=9 {
        let pet_json_path = pet_dir.join(id.to_string()).join("pet.json");
        match std::fs::read_to_string(&pet_json_path) {
            Ok(content) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    result.push(MascotInfo {
                        id,
                        display_name: v
                            .get("displayName")
                            .and_then(|x| x.as_str())
                            .unwrap_or("Unknown")
                            .to_string(),
                        description: v
                            .get("description")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                    });
                }
            }
            Err(_) => {
                // 资源缺失时跳过，不阻断
                log::warn!("Mascot pet.json 缺失: {:?}", pet_json_path);
            }
        }
    }
    Ok(result)
}

/// 桌面伙伴元信息 DTO（对应前端 types/index.ts MascotInfo）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MascotInfo {
    pub id: i64,
    pub display_name: String,
    pub description: String,
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
