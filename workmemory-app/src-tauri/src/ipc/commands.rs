// IPC 命令处理器 (对应 03_CORE_ARCHITECTURE.md §3.1)
//
// 全部 #[tauri::command] 函数名与 lib.rs 的 generate_handler! 列表逐字一致。
// 约定：
//   - 所有命令返回 Result<T, String>，错误统一转 String
//   - DB 连接通过 app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>().get()? 获取
//   - lock 后以 &conn 调用 db::repository 函数
//   - 依赖 core::distill / core::report / core::embedding 的命令直接调用对应函数
//     （这些模块由 Task 9/10/17 创建匹配签名的实现）

#![allow(dead_code)]
#![allow(unused_variables)]

use tauri::Manager;

use crate::core::achievement_engine;
use crate::core::analytics_engine;
use crate::core::data_port;
use crate::core::focus_engine;
use crate::core::pet_engine;
use crate::core::soundscape_engine;
use crate::core::task_engine;
use crate::core::error::{AppError, AppResult};
use crate::core::validator;
use crate::db::repository;
use crate::models;
use crate::models::PetState;
use crate::models::Task;

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
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    repository::get_episodes_by_date(&conn, &date).map_err(|e| e.to_string())
}

/// 按 ID 获取单个 Episode（用于图谱节点双击穿梭回历史 Episode）。
#[tauri::command]
pub async fn get_episode_by_id(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<models::CleanEpisode>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
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
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
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
        let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
        let conn = pool.get().map_err(|e| e.to_string())?;
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
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let mut conn = pool.get().map_err(|e| e.to_string())?;
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
    // 跨表写事务：wiki_pages INSERT + clean_episodes UPDATE 原子化，任一失败回滚
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    repository::insert_wiki_page(&tx, &page).map_err(|e| e.to_string())?;
    repository::update_episode_wiki_status(&tx, &episode_id, "saved")
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(page)
}

/// 获取最近更新的 Wiki 列表（默认上限 100 条）。
#[tauri::command]
pub async fn get_wiki_pages(app: tauri::AppHandle) -> Result<Vec<models::WikiPage>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    repository::get_wiki_pages(&conn, 100).map_err(|e| e.to_string())
}

/// 按 ID 获取单个 Wiki 页面。
#[tauri::command]
pub async fn get_wiki_page(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<models::WikiPage>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    repository::get_wiki_page(&conn, &id).map_err(|e| e.to_string())
}

/// 获取待审阅队列：wiki_eligible=1 AND wiki_status='eligible' 的 Episode。
#[tauri::command]
pub async fn get_review_queue(app: tauri::AppHandle) -> Result<Vec<models::CleanEpisode>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    repository::get_eligible_episodes_for_wiki(&conn).map_err(|e| e.to_string())
}

// ============================================================
// 设置
// ============================================================

/// 读取 AppSetting（settings 表 key='app'，缺失则返回 Default）。
#[tauri::command]
pub async fn get_settings(app: tauri::AppHandle) -> Result<models::AppSetting, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    repository::get_settings(&conn).map_err(|e| e.to_string())
}

/// 更新 AppSetting（upsert key='app'）。
#[tauri::command]
pub async fn update_settings(
    app: tauri::AppHandle,
    settings: models::AppSetting,
) -> Result<(), String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    repository::update_settings(&conn, &settings).map_err(|e| e.to_string())?;
    Ok(())
}

/// 从 settings 读取当前 Mascot ID。
#[tauri::command]
pub async fn get_mascot_id(app: tauri::AppHandle) -> Result<i64, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    let settings = repository::get_settings(&conn).map_err(|e| e.to_string())?;
    Ok(settings.mascot_id)
}

/// 更新 settings.mascot_id（读-改-写）。
#[tauri::command]
pub async fn set_mascot_id(app: tauri::AppHandle, mascot_id: i64) -> Result<(), String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
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
    validator::validate_year(year).map_err(|e| e.to_string())?;
    validator::validate_month(month).map_err(|e| e.to_string())?;

    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;

    let days_in_month = days_in_month(year, month).map_err(|e| e.to_string())?;
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
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
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
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
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
// 每日统计 (core::stats_engine)
// ============================================================

/// 获取指定日期的每日统计（不存在则创建默认行）。
#[tauri::command]
pub fn get_daily_stats(app: tauri::AppHandle, date: String) -> Result<models::DailyStats, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    core::stats_engine::get_daily_stats(&conn, &date).map_err(|e| e.to_string())
}

/// 获取今日每日统计。
#[tauri::command]
pub fn get_today_stats(app: tauri::AppHandle) -> Result<models::DailyStats, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    core::stats_engine::get_today_stats(&conn).map_err(|e| e.to_string())
}

// ============================================================
// 分析引擎 (core::analytics_engine)
// ============================================================

/// 计算连续打卡天数：从今日往前数连续有 completed 任务的日期数。
#[tauri::command]
pub fn calculate_streak(app: tauri::AppHandle) -> Result<i64, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    analytics_engine::calculate_streak(&conn).map_err(|e| e.to_string())
}

/// 获取最近 7 天的每日统计（周报/趋势图数据源），按日期升序返回。
#[tauri::command]
pub fn get_weekly_stats(app: tauri::AppHandle) -> Result<Vec<models::DailyStats>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    analytics_engine::get_weekly_stats(&conn).map_err(|e| e.to_string())
}

/// 生产力评分（0-100）：综合今日任务完成数 + 专注时长。
#[tauri::command]
pub fn productivity_score(app: tauri::AppHandle) -> Result<i64, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    analytics_engine::productivity_score(&conn).map_err(|e| e.to_string())
}

// ============================================================
// 宠物引擎 (core::pet_engine)
// ============================================================

/// 获取宠物状态（单行，id='default'）。
#[tauri::command]
pub fn get_pet_state(app: tauri::AppHandle) -> Result<PetState, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    pet_engine::get_pet_state(&conn).map_err(|e| e.to_string())
}

/// 保存宠物状态（全量覆盖写）。
#[tauri::command]
pub fn save_pet_state(app: tauri::AppHandle, pet: PetState) -> Result<(), String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    pet_engine::save_pet_state(&conn, &pet).map_err(|e| e.to_string())
}

/// 喂食：+hunger, +happiness。
#[tauri::command]
pub fn feed_pet(app: tauri::AppHandle) -> Result<PetState, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    pet_engine::feed(&conn).map_err(|e| e.to_string())
}

/// 玩耍：+happiness, -energy, +bond。
#[tauri::command]
pub fn play_pet(app: tauri::AppHandle) -> Result<PetState, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    pet_engine::play(&conn).map_err(|e| e.to_string())
}

/// 休息：+energy，mood 置为 sleeping。
#[tauri::command]
pub fn rest_pet(app: tauri::AppHandle) -> Result<PetState, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    pet_engine::rest(&conn).map_err(|e| e.to_string())
}

/// 清洁：+cleanliness, +happiness。
#[tauri::command]
pub fn clean_pet(app: tauri::AppHandle) -> Result<PetState, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    pet_engine::clean(&conn).map_err(|e| e.to_string())
}

// ============================================================
// 任务引擎 (core::task_engine)
// ============================================================

/// 创建任务（后端生成 uuid v4，含标题校验与状态机默认值）。
#[tauri::command]
pub fn save_task(app: tauri::AppHandle, task: Task) -> Result<Task, String> {
    validator::validate_title(&task.title).map_err(|e| e.to_string())?;
    validator::validate_content(&task.description).map_err(|e| e.to_string())?;
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    task_engine::save_task(&conn, task).map_err(|e| e.to_string())
}

/// 查询全部任务（按 sort_order ASC, created_at DESC 排序）。
///
/// Task 22.3：新增可选 `limit` / `offset` 分页参数。
/// 前端不传时默认 `limit=100, offset=0`，保持向后兼容（旧调用方仍取首页 100 条）。
#[tauri::command]
pub fn get_all_tasks(
    app: tauri::AppHandle,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Task>, String> {
    validator::validate_pagination(offset, limit).map_err(|e| e.to_string())?;
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    // 默认 limit=100, offset=0；显式传入时尊重调用方
    let lim = limit.or(Some(100));
    let off = offset.or(Some(0));
    task_engine::get_all_tasks(&conn, lim, off).map_err(|e| e.to_string())
}

/// 按 ID 查询单个任务。
#[tauri::command]
pub fn get_task(app: tauri::AppHandle, id: String) -> Result<Task, String> {
    validator::validate_uuid(&id).map_err(|e| e.to_string())?;
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    task_engine::get_task(&conn, &id).map_err(|e| e.to_string())
}

/// 更新任务（含状态机守卫：archived 为终态，非法流转将被拒绝）。
#[tauri::command]
pub fn update_task(app: tauri::AppHandle, task: Task) -> Result<(), String> {
    validator::validate_title(&task.title).map_err(|e| e.to_string())?;
    validator::validate_content(&task.description).map_err(|e| e.to_string())?;
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    task_engine::update_task(&conn, &task).map_err(|e| e.to_string())
}

/// 删除任务（不存在则返回 NotFound 错误）。
#[tauri::command]
pub fn delete_task(app: tauri::AppHandle, id: String) -> Result<(), String> {
    validator::validate_uuid(&id).map_err(|e| e.to_string())?;
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    task_engine::delete_task(&mut conn, &id).map_err(|e| e.to_string())
}

/// FTS5 全文搜索任务（匹配 title / description）。
#[tauri::command]
pub fn search_tasks(app: tauri::AppHandle, query: String) -> Result<Vec<Task>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    task_engine::search_tasks(&conn, &query).map_err(|e| e.to_string())
}

// ============================================================
// 专注会话 (core::focus_engine)
// ============================================================

/// 开始专注会话：落库 focus_sessions，返回带 id 的 session（前端据此驱动计时）。
#[tauri::command]
pub fn start_focus_session(
    app: tauri::AppHandle,
    session_type: String,
    task_id: Option<String>,
    planned_duration: i64,
) -> Result<models::FocusSession, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    focus_engine::start_focus_session(&conn, &session_type, task_id.as_deref(), planned_duration)
        .map_err(|e| e.to_string())
}

/// 正常完成专注会话：写 end_time + actual duration，发布事件并触发宠物 XP 增长。
#[tauri::command]
pub fn complete_focus_session(
    app: tauri::AppHandle,
    session_id: String,
    actual_duration: i64,
) -> Result<models::FocusSession, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    focus_engine::complete_focus_session(&conn, &session_id, actual_duration).map_err(|e| e.to_string())
}

/// 中断专注会话：记录中断原因（interrupted=1）。
#[tauri::command]
pub fn interrupt_focus_session(
    app: tauri::AppHandle,
    session_id: String,
    actual_duration: i64,
    reason: String,
) -> Result<models::FocusSession, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    focus_engine::interrupt_focus_session(&conn, &session_id, actual_duration, &reason)
        .map_err(|e| e.to_string())
}

/// 查询今日所有专注会话（按 start_time 倒序）。
#[tauri::command]
pub fn get_today_focus_sessions(app: tauri::AppHandle) -> Result<Vec<models::FocusSession>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    focus_engine::get_today_focus_sessions(&conn).map_err(|e| e.to_string())
}

// ============================================================
// 音景包 (core::soundscape_engine)
// ============================================================

/// 获取所有已启用的音景包（前端用于渲染混音器面板）。
#[tauri::command]
pub fn get_soundscape_packs(app: tauri::AppHandle) -> Result<Vec<models::SoundscapePack>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    soundscape_engine::get_soundscape_packs(&conn).map_err(|e| e.to_string())
}

/// 获取所有音景包（含禁用，用于设置页管理）。
#[tauri::command]
pub fn get_all_soundscape_packs(app: tauri::AppHandle) -> Result<Vec<models::SoundscapePack>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    soundscape_engine::get_all_soundscape_packs(&conn).map_err(|e| e.to_string())
}

/// 启用/禁用指定音景包。
#[tauri::command]
pub fn toggle_soundscape_pack(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    soundscape_engine::toggle_soundscape_pack(&conn, &id, enabled).map_err(|e| e.to_string())
}

// ============================================================
// 数据导入/导出 (core::data_port) - Task 24.2 / 24.3
// ============================================================

/// 导出全部业务表为单个 JSON 字符串。
#[tauri::command]
pub fn export_data_json(app: tauri::AppHandle) -> Result<String, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    data_port::export_json(&conn).map_err(|e| e.to_string())
}

/// 导出 tasks 表为 CSV 字符串。
#[tauri::command]
pub fn export_tasks_csv(app: tauri::AppHandle) -> Result<String, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    data_port::export_csv_tasks(&conn).map_err(|e| e.to_string())
}

/// 导入 JSON 字符串到数据库（事务内 INSERT OR REPLACE），返回 ImportSummary。
#[tauri::command]
pub fn import_data_json(app: tauri::AppHandle, json_str: String) -> Result<data_port::ImportSummary, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    data_port::import_json(&mut conn, json_str).map_err(|e| e.to_string())
}

/// 清空全部业务表数据（保留 schema）。破坏性操作，前端需 ConfirmDialog 二次确认。
///
/// 跨表写事务：8 张业务表的 DELETE 在单事务内原子执行，任一失败整体回滚，
/// 避免出现"部分表已清空、部分表未清空"的脏状态。
#[tauri::command]
pub fn clear_all_data(app: tauri::AppHandle) -> Result<(), String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for table in [
        "tasks",
        "pet_state",
        "daily_stats",
        "focus_sessions",
        "achievements",
        "soundscape_packs",
        "pet_interaction_logs",
        "user_preferences",
    ] {
        tx.execute(&format!("DELETE FROM {}", table), [])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================
// 用户偏好 KV (Task 24.1 / 24.4) - 主题 / 通知开关等
// ============================================================

/// 读取一个用户偏好；不存在返回 None。
#[tauri::command]
pub fn get_preference(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    repository::get_preference(&conn, &key).map_err(|e| e.to_string())
}

/// 写入（upsert）一个用户偏好。
#[tauri::command]
pub fn set_preference(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    repository::set_preference(&conn, &key, &value).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================
// 成就引擎 (core::achievement_engine)
// ============================================================

/// 获取全部成就（目录 + 解锁状态 + 实时进度）。
#[tauri::command]
pub fn get_all_achievements(
    app: tauri::AppHandle,
) -> Result<Vec<achievement_engine::AchievementView>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    achievement_engine::get_all_achievements(&conn).map_err(|e| e.to_string())
}

/// 手动解锁指定成就（按 code）。
///
/// 解锁后由引擎 `app.emit("achievement-unlocked", payload)` 通知前端弹出
/// `AchievementUnlockModal` 特效弹窗（Task 17.2）。
#[tauri::command]
pub fn unlock_achievement(
    app: tauri::AppHandle,
    code: String,
) -> Result<achievement_engine::AchievementView, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    achievement_engine::unlock_achievement(&conn, &code, &app).map_err(|e| e.to_string())
}

/// 重算所有成就：评估解锁条件并写入新解锁项，返回更新后的列表。
///
/// 对本次新解锁的成就，引擎逐条 `app.emit("achievement-unlocked", payload)`，
/// 前端 `achievementStore` 接收后依次弹出 `AchievementUnlockModal`（Task 17.2）。
#[tauri::command]
pub fn recalculate_achievements(
    app: tauri::AppHandle,
) -> Result<Vec<achievement_engine::AchievementView>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    achievement_engine::recalculate_achievements(&conn, &app).map_err(|e| e.to_string())
}

// ============================================================
// 内部辅助
// ============================================================

/// 计算指定年份月份的天数（含闰年判定）。
fn days_in_month(year: i32, month: i32) -> AppResult<u32> {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => Ok(31),
        4 | 6 | 9 | 11 => Ok(30),
        2 => {
            if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) {
                Ok(29)
            } else {
                Ok(28)
            }
        }
        _ => Err(AppError::ValidationError(format!("月份必须在 1-12 范围，收到: {}", month))),
    }
}

// ============================================================
// 快速捕获窗口 (Task 12 - QuickCaptureWindow)
// ============================================================

/// 显示桌面悬浮快速捕获窗口（show + set_focus）。
#[tauri::command]
pub async fn show_quick_capture(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("quick-capture") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

/// 隐藏桌面悬浮快速捕获窗口。
#[tauri::command]
pub async fn hide_quick_capture(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("quick-capture") {
        let _ = window.hide();
    }
    Ok(())
}

// ============================================================
// 标签管理 (Task 15 - TagManagementPanel)
// ============================================================

/// 标签聚合信息 DTO（与前端 types/index.ts TagInfo 对齐，
/// last_used_at 字段保持 snake_case 以匹配前端 TS 接口定义）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct TagInfo {
    pub name: String,
    pub count: i64,
    pub last_used_at: String,
    pub color: Option<String>,
}

impl From<repository::TagInfo> for TagInfo {
    fn from(t: repository::TagInfo) -> Self {
        Self {
            name: t.name,
            count: t.count,
            last_used_at: t.last_used_at,
            color: t.color,
        }
    }
}

/// 列出全部标签：从 wiki_pages.tags 聚合每个标签的出现次数与最近使用时间，
/// 颜色字段从 settings 表 key='tag_colors' 的 JSON（Map<String,String>）读取。
#[tauri::command]
pub async fn list_tags(app: tauri::AppHandle) -> Result<Vec<TagInfo>, String> {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    repository::list_tags(&conn)
        .map(|v| v.into_iter().map(TagInfo::from).collect())
        .map_err(|e| e.to_string())
}

/// 校验标签名长度：1-30 字符。
fn validate_tag_name(name: &str) -> Result<(), String> {
    let len = name.chars().count();
    if len == 0 {
        return Err("标签名不能为空".to_string());
    }
    if len > 30 {
        return Err(format!("标签名长度不能超过 30 字符，当前: {}", len));
    }
    Ok(())
}

/// 校验颜色格式：空字符串（清除）或 #RRGGBB（6 位十六进制）。
fn validate_tag_color(color: &str) -> Result<(), String> {
    if color.is_empty() {
        return Ok(());
    }
    let bytes = color.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' {
        return Err(format!("颜色格式必须为 #RRGGBB，收到: {}", color));
    }
    for &b in &bytes[1..] {
        if !b.is_ascii_hexdigit() {
            return Err(format!("颜色包含非十六进制字符: {}", color));
        }
    }
    Ok(())
}

/// 重命名标签：在事务内遍历全部 wiki_pages，将 tags 数组中的 old_name 替换为 new_name。
/// 返回受影响的 wiki_pages 行数。
#[tauri::command]
pub async fn rename_tag(
    app: tauri::AppHandle,
    old_name: String,
    new_name: String,
) -> Result<i64, String> {
    let old_name = old_name.trim().to_string();
    let new_name = new_name.trim().to_string();
    if old_name.is_empty() {
        return Err("原标签名不能为空".to_string());
    }
    validate_tag_name(&new_name)?;

    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    repository::rename_tag(&mut conn, &old_name, &new_name).map_err(|e| e.to_string())
}

/// 合并标签：在事务内遍历全部 wiki_pages，从 tags 数组移除 source_tags 中的项，
/// 若 target_tag 不存在则添加。返回受影响的 wiki_pages 行数。
#[tauri::command]
pub async fn merge_tags(
    app: tauri::AppHandle,
    source_tags: Vec<String>,
    target_tag: String,
) -> Result<i64, String> {
    if source_tags.is_empty() {
        return Err("源标签列表不能为空".to_string());
    }
    let target_tag = target_tag.trim().to_string();
    validate_tag_name(&target_tag)?;

    // source 集合：去除空白项与 target 自身（避免无意义自合并）
    let source_set: std::collections::HashSet<String> = source_tags
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != &target_tag)
        .collect();
    if source_set.is_empty() {
        return Err("源标签列表在去重后为空".to_string());
    }

    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    repository::merge_tags(&mut conn, &source_tags, &target_tag).map_err(|e| e.to_string())
}

/// 设置/清除标签颜色：将 settings 表 key='tag_colors' 的 JSON（Map<String,String>）
/// 中 tag 对应的颜色更新为 color；color 为空字符串时移除该 key。
#[tauri::command]
pub async fn set_tag_color(
    app: tauri::AppHandle,
    tag: String,
    color: String,
) -> Result<(), String> {
    let tag = tag.trim().to_string();
    validate_tag_name(&tag)?;
    validate_tag_color(&color)?;

    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = pool.get().map_err(|e| e.to_string())?;
    repository::set_tag_color(&conn, &tag, &color).map_err(|e| e.to_string())
}
