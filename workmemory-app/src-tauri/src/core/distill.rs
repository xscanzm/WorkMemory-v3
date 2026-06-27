//! 小时蒸馏与降级管道（Task 9）
//!
//! 实现 `03_CORE_ARCHITECTURE.md` §2.2 整点蒸馏管线 +
//! `01_ARCHITECTURAL_DECISIONS.md` §4 无 AI 降级模式 +
//! `08_AI_PROMPTS.md` §1 整点 AI 蒸馏 Prompt 模板。
//!
//! ## 核心硬约束
//! - 整点蒸馏必须**幂等**（`distill_runs` 已 done 则跳过，对应 `09_PRODUCT_ACCEPTANCE_LEDGER.md` 用例 3）
//! - 无 API Key 或网络失败必须**静默降级** No-AI 聚类，绝不抛错弹窗（用例 4）
//! - AI 蒸馏用 JSON Mode 强约束（`response_format={type:"json_object"}`）
//! - 降级聚类基于 **App 邻近度 + 10 分钟时间窗**
//! - 蒸馏完成广播 `distill-completed` 事件

use std::collections::HashMap;

use chrono::{Local, NaiveTime, Timelike, Utc};
use serde::Deserialize;
use tauri::{Emitter, Manager};
use uuid::Uuid;

use crate::db::repository;
use crate::models::{AppSetting, CleanEpisode, DistillRun, Foresight, Insight, MemoryCell, WorkSegment};

// ============================================================
// 事件 Payload（distill-completed 广播负载）
// ============================================================
// 注：理想位置是 `ipc::events` 模块。在 ipc 模块尚未建立时，
// 此处本地定义以保证本模块自洽可编译；后续 ipc::events 落地后
// 可平滑迁移（payload 字段名/形状保持一致）。

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistillCompletedPayload {
    pub date: String,
    pub hour_bucket: String,
}

// ============================================================
// DB 访问辅助（与 core/capture.rs 同模式：取锁、快速操作、释放）
// ============================================================

fn with_db<F, R>(app: &tauri::AppHandle, f: F) -> Option<R>
where
    F: FnOnce(&rusqlite::Connection) -> R,
{
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let guard = state.lock().ok()?;
    Some(f(&guard))
}

fn now_utc_iso() -> String {
    Utc::now().format("%+").to_string()
}

// ============================================================
// 1. 整点调度器
// ============================================================

/// 启动整点蒸馏调度器。每 60s 检查一次当前时间，若分钟==0（整点 HH:00），
/// 对上一小时触发 `run_distill_for_hour`。
///
/// - hour_bucket 格式 "HH:00"（如 "14:00"）
/// - date 格式 "YYYY-MM-DD"
/// - 用 `chrono::Local::now()` 获取当前时间
pub async fn start_hourly_scheduler(app: tauri::AppHandle) {
    log::info!("启动整点蒸馏调度器（60s 轮询）");
    // 记录上一次触发的整点小时，避免同一 HH:00 窗口内重复触发
    let mut last_triggered_hour: i32 = -1;
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        let now = Local::now();
        let hour: i32 = now.format("%H").to_string().parse().unwrap_or(-1);
        let minute: i32 = now.format("%M").to_string().parse().unwrap_or(-1);
        if minute != 0 || hour < 0 {
            continue;
        }
        if hour == last_triggered_hour {
            continue;
        }
        last_triggered_hour = hour;
        // 触发"上一小时"的蒸馏：HH:00 时蒸馏 [HH-1:00, HH:00) 的 segments
        let prev = now - chrono::Duration::hours(1);
        let date = prev.format("%Y-%m-%d").to_string();
        let hour_bucket = prev.format("%H:00").to_string();
        log::info!("整点触发蒸馏: date={} hour_bucket={}", date, hour_bucket);
        if let Err(e) = run_distill_for_hour(&app, &date, &hour_bucket).await {
            log::warn!("蒸馏失败 ({} {}): {}", date, hour_bucket, e);
        }
    }
}

// ============================================================
// 2. 单小时蒸馏（幂等）
// ============================================================

/// 对指定 (date, hour_bucket) 执行蒸馏。幂等：若 `distill_runs` 已 done 则跳过。
///
/// 流程（`03_CORE_ARCHITECTURE.md` §2.2）：
/// 1. 幂等检查 → 已 done 跳过
/// 2. upsert distill_run status='running'
/// 3. 读取上一小时有效 segments（排除 is_deleted=1）
/// 4. segments 为空 → status='skip' 返回
/// 5. 有 API Key → AI 蒸馏；无 Key/网络失败 → 静默降级 No-AI 聚类
/// 6. 事务原子写入 clean_episodes + memory_cells
/// 7. 更新 status='done'，广播 `distill-completed`
pub async fn run_distill_for_hour(
    app: &tauri::AppHandle,
    date: &str,
    hour_bucket: &str,
) -> Result<(), String> {
    // ---- 幂等检查 ----
    let already_done = with_db(app, |conn| {
        repository::get_distill_run(conn, date, hour_bucket)
            .ok()
            .flatten()
            .map(|r| r.status == "done")
            .unwrap_or(false)
    })
    .unwrap_or(false);
    if already_done {
        log::info!("蒸馏已 done，跳过（幂等）: {} {}", date, hour_bucket);
        return Ok(());
    }

    // ---- 读取 segments ----
    let segments: Vec<WorkSegment> = with_db(app, |conn| {
        repository::get_segments_by_hour(conn, date, hour_bucket).unwrap_or_default()
    })
    .unwrap_or_default();

    let now_iso = now_utc_iso();
    let run_id = Uuid::new_v4().to_string();

    // ---- 标记 running ----
    let _ = with_db(app, |conn| {
        repository::upsert_distill_run(
            conn,
            &DistillRun {
                id: run_id.clone(),
                date: date.to_string(),
                hour_bucket: hour_bucket.to_string(),
                status: "running".to_string(),
                segment_count: segments.len() as i64,
                error_message: String::new(),
                model_name: String::new(),
                created_at: now_iso.clone(),
                updated_at: now_iso.clone(),
            },
        )
    });

    // ---- segments 为空 → skip ----
    if segments.is_empty() {
        let _ = with_db(app, |conn| {
            repository::upsert_distill_run(
                conn,
                &DistillRun {
                    id: run_id,
                    date: date.to_string(),
                    hour_bucket: hour_bucket.to_string(),
                    status: "skip".to_string(),
                    segment_count: 0,
                    error_message: "no segments".to_string(),
                    model_name: String::new(),
                    created_at: now_iso,
                    updated_at: now_utc_iso(),
                },
            )
        });
        log::info!("无有效 segments，标记 skip: {} {}", date, hour_bucket);
        return Ok(());
    }

    // ---- 读取 settings ----
    let settings: AppSetting = with_db(app, |conn| repository::get_settings(conn).unwrap_or_default())
        .unwrap_or_default();
    let has_key = settings
        .openai_api_key
        .as_deref()
        .map(|k| !k.is_empty())
        .unwrap_or(false);

    // ---- 蒸馏：AI 或降级 ----
    let pairs: Vec<(CleanEpisode, MemoryCell)> = if has_key {
        match distill_with_ai(app, date, hour_bucket, &segments, &settings).await {
            Ok(p) => p,
            Err(e) => {
                // 静默降级（绝不抛错弹窗）
                log::warn!(
                    "AI 蒸馏失败，降级本地聚类 ({} {}): {}",
                    date,
                    hour_bucket,
                    e
                );
                distill_with_local_cluster(date, hour_bucket, &segments)
            }
        }
    } else {
        log::info!("无 API Key，使用本地聚类降级: {} {}", date, hour_bucket);
        distill_with_local_cluster(date, hour_bucket, &segments)
    };

    let model_name = pairs
        .first()
        .map(|p| p.0.model_name.clone())
        .unwrap_or_default();

    // ---- 原子写入（事务）----
    let write_result = with_db(app, |conn| write_episodes_and_cells(conn, &pairs));

    match write_result {
        Some(Ok(())) => {
            // ---- 标记 done ----
            let _ = with_db(app, |conn| {
                repository::upsert_distill_run(
                    conn,
                    &DistillRun {
                        id: run_id,
                        date: date.to_string(),
                        hour_bucket: hour_bucket.to_string(),
                        status: "done".to_string(),
                        segment_count: segments.len() as i64,
                        error_message: String::new(),
                        model_name,
                        created_at: now_iso,
                        updated_at: now_utc_iso(),
                    },
                )
            });
            // ---- 广播 distill-completed ----
            let _ = app.emit(
                "distill-completed",
                DistillCompletedPayload {
                    date: date.to_string(),
                    hour_bucket: hour_bucket.to_string(),
                },
            );
            log::info!(
                "蒸馏完成: {} {} ({} 个 episode)",
                date,
                hour_bucket,
                pairs.len()
            );
            // ---- 异步向量化 MemoryCell（死代码修复）----
            // 必须在 DB 锁释放后 spawn：embed_memory_cell 内部会再次获取同一连接锁，
            // 在此持有锁时 await 会导致死锁。settings 已在上方读取，pairs 在作用域内。
            if settings.embedding_enabled {
                let app_clone = app.clone();
                let cells_clone = pairs
                    .iter()
                    .map(|(_, mc)| mc.clone())
                    .collect::<Vec<_>>();
                tauri::async_runtime::spawn(async move {
                    for mc in cells_clone {
                        // embed_memory_cell 内部已对失败做 log::warn 静默处理，返回 ()
                        crate::core::embedding::embed_memory_cell(&app_clone, &mc).await;
                    }
                });
            }
            Ok(())
        }
        Some(Err(e)) => {
            let err_msg = e.to_string();
            let _ = with_db(app, |conn| {
                repository::upsert_distill_run(
                    conn,
                    &DistillRun {
                        id: run_id,
                        date: date.to_string(),
                        hour_bucket: hour_bucket.to_string(),
                        status: "error".to_string(),
                        segment_count: segments.len() as i64,
                        error_message: err_msg.clone(),
                        model_name: String::new(),
                        created_at: now_iso,
                        updated_at: now_utc_iso(),
                    },
                )
            });
            // 写入失败也静默：不抛弹窗，仅记录
            log::error!("蒸馏写入失败 ({} {}): {}", date, hour_bucket, err_msg);
            Ok(())
        }
        None => {
            log::error!("DB 锁失败，蒸馏中止: {} {}", date, hour_bucket);
            Ok(())
        }
    }
}

/// 事务原子写入 clean_episodes + memory_cells。任一插入失败则 ROLLBACK。
fn write_episodes_and_cells(
    conn: &rusqlite::Connection,
    pairs: &[(CleanEpisode, MemoryCell)],
) -> rusqlite::Result<()> {
    conn.execute_batch("BEGIN;")?;
    let result: rusqlite::Result<()> = (|| {
        for (ep, mc) in pairs {
            repository::insert_episode(conn, ep)?;
            repository::insert_memory_cell(conn, mc)?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT;")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

// ============================================================
// 3. AI 蒸馏管道
// ============================================================

/// AI 蒸馏：组装 OCR 文本流 → build_distill_prompt → OpenAI Chat Completion
/// （JSON Mode）→ 强约束解析 → 转换为 (CleanEpisode, MemoryCell)。
///
/// 网络错误或 JSON 解析失败 → 返回 Err，上层捕获后降级。
async fn distill_with_ai(
    _app: &tauri::AppHandle,
    date: &str,
    hour_bucket: &str,
    segments: &[WorkSegment],
    settings: &AppSetting,
) -> Result<Vec<(CleanEpisode, MemoryCell)>, String> {
    let ocr_records = build_ocr_records(segments);
    let prompt = build_distill_prompt(date, hour_bucket, &ocr_records);
    let content = call_openai_chat(settings, &prompt).await?;
    let cleaned = extract_json_object(&content)?;
    let resp: DistillResponse = serde_json::from_str(&cleaned)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;
    let model_name = settings.openai_model.clone();
    let pairs: Vec<(CleanEpisode, MemoryCell)> = resp
        .episodes
        .into_iter()
        .map(|raw| raw_to_episode_and_cell(raw, date, hour_bucket, &model_name))
        .collect();
    Ok(pairs)
}

/// 将单个 Segment 序列化为结构化场景块（JSON 对象）。
/// 输出六字段：timestamp / app_name / window_title / browser_url / activity_type / reconstructed_text
/// 当 browser_url 存在时，在 reconstructed_text 前加 "网页上下文：{domain}{path}\n" 前缀。
fn serialize_segment_block(seg: &WorkSegment) -> serde_json::Value {
    // 1. 构建 reconstructed_text：browser_url 存在时加网页上下文前缀
    let reconstructed_text = match &seg.browser_url {
        Some(url) => {
            let context = match crate::core::url_util::parse_domain_path(url) {
                Some((domain, path)) => format!("网页上下文：{}{}\n", domain, path),
                None => format!("网页上下文：{}\n", url),
            };
            format!("{}{}", context, seg.ocr_text)
        }
        None => seg.ocr_text.clone(),
    };

    // 2. 组装 JSON 对象（保持字段顺序便于 LLM 阅读）
    serde_json::json!({
        "timestamp": format!("{} {}", seg.date, seg.start_time),
        "app_name": seg.app_name,
        "window_title": seg.window_title,
        "browser_url": seg.browser_url,
        "activity_type": seg.activity_type,
        "reconstructed_text": reconstructed_text,
    })
}

/// 组装 OCR 文本与窗口标题流为 ocr_records 字符串。
/// 每行为一个 Segment 序列化后的紧凑 JSON 对象（结构化场景块）。
fn build_ocr_records(segments: &[WorkSegment]) -> String {
    segments
        .iter()
        .map(serialize_segment_block)
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

/// 调用 OpenAI Chat Completion（JSON Mode 强约束，temperature=0.3）。
/// 返回 choices[0].message.content 原始字符串。
async fn call_openai_chat(settings: &AppSetting, prompt: &str) -> Result<String, String> {
    let api_key = settings
        .openai_api_key
        .as_deref()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "no api key".to_string())?;
    let base = settings.openai_base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("reqwest build: {}", e))?;
    let body = serde_json::json!({
        "model": settings.openai_model,
        "messages": [{ "role": "user", "content": prompt }],
        "response_format": { "type": "json_object" },
        "temperature": 0.3
    });
    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("reqwest send: {}", e))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("reqwest body: {}", e))?;
    if !status.is_success() {
        return Err(format!("OpenAI {} : {}", status, text));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("resp parse: {}", e))?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "no content in response".to_string())?;
    Ok(content.to_string())
}

/// 强约束 JSON 提取：剥离 ```json 围栏，截取首个 `{` 到末个 `}`。
fn extract_json_object(content: &str) -> Result<String, String> {
    let mut s = content.trim();
    // 剥离 ```json ... ``` 或 ``` ... ``` 围栏
    if s.starts_with("```") {
        if let Some(rest) = s
            .strip_prefix("```json")
            .or_else(|| s.strip_prefix("```"))
        {
            s = rest.trim();
            if let Some(rest) = s.strip_suffix("```") {
                s = rest.trim();
            }
        }
    }
    let start = s.find('{').ok_or_else(|| "缺少起始大括号".to_string())?;
    let end = s.rfind('}').ok_or_else(|| "缺少结束大括号".to_string())?;
    if end < start {
        return Err("JSON 大括号顺序异常".to_string());
    }
    Ok(s[start..=end].to_string())
}

// ---- AI 响应反序列化结构（对应 08_AI_PROMPTS.md §1 输出 schema）----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DistillResponse {
    #[serde(default)]
    episodes: Vec<DistillEpisodeRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DistillEpisodeRaw {
    start_time: String,
    end_time: String,
    title: String,
    summary: String,
    #[serde(default)]
    memory_kind: String,
    #[serde(default)]
    project: String,
    #[serde(default)]
    entities: Vec<String>,
    #[serde(default)]
    topics: Vec<String>,
    #[serde(default)]
    materials: Vec<String>,
    #[serde(default)]
    outputs: Vec<String>,
    #[serde(default)]
    todos: Vec<String>,
    #[serde(default)]
    blockers: Vec<String>,
    #[serde(default)]
    segment_ids: Vec<String>,
    #[serde(default)]
    evidence_refs: Vec<String>,
    #[serde(default)]
    source_quality: String,
    #[serde(default)]
    confidence: f64,
    #[serde(default)]
    wiki_eligible: bool,
    #[serde(default)]
    memory_cell: Option<DistillMemoryCellRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DistillMemoryCellRaw {
    #[serde(default)]
    episode_text: String,
    #[serde(default)]
    facts: Vec<String>,
    #[serde(default)]
    foresight: Vec<DistillForesightRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DistillForesightRaw {
    #[serde(default)]
    statement: String,
    #[serde(default)]
    valid_from: String,
    #[serde(default)]
    valid_to: String,
    #[serde(default)]
    confidence: f64,
}

/// 将 AI 返回的原始结构转换为 (CleanEpisode, MemoryCell)。
/// id 用 uuid v4，date/hour_bucket 填入，时间戳用 chrono UTC ISO8601。
fn raw_to_episode_and_cell(
    raw: DistillEpisodeRaw,
    date: &str,
    hour_bucket: &str,
    model_name: &str,
) -> (CleanEpisode, MemoryCell) {
    let now = now_utc_iso();
    let ep_id = Uuid::new_v4().to_string();
    let mc_id = Uuid::new_v4().to_string();

    let memory_kind = if raw.memory_kind.is_empty() {
        "work".to_string()
    } else {
        raw.memory_kind
    };
    let source_quality = if raw.source_quality.is_empty() {
        "medium".to_string()
    } else {
        raw.source_quality
    };
    let wiki_status = if raw.wiki_eligible {
        "eligible".to_string()
    } else {
        "none".to_string()
    };

    let episode = CleanEpisode {
        id: ep_id.clone(),
        date: date.to_string(),
        hour_bucket: hour_bucket.to_string(),
        start_time: raw.start_time,
        end_time: raw.end_time,
        title: raw.title,
        summary: raw.summary.clone(),
        memory_kind,
        project: raw.project,
        entities: raw.entities,
        topics: raw.topics,
        materials: raw.materials,
        outputs: raw.outputs,
        todos: raw.todos,
        blockers: raw.blockers,
        segment_ids: raw.segment_ids,
        evidence_refs: raw.evidence_refs,
        source_quality,
        confidence: raw.confidence,
        wiki_eligible: raw.wiki_eligible,
        wiki_status,
        is_private: false,
        model_name: model_name.to_string(),
        distill_version: "1".to_string(),
        created_at: now.clone(),
        updated_at: now,
    };

    let mc_raw = raw.memory_cell.unwrap_or(DistillMemoryCellRaw {
        episode_text: episode.summary.clone(),
        facts: vec![],
        foresight: vec![],
    });
    let foresight: Vec<Foresight> = mc_raw
        .foresight
        .into_iter()
        .map(|f| Foresight {
            statement: f.statement,
            valid_from: f.valid_from,
            valid_to: f.valid_to,
            confidence: f.confidence,
        })
        .collect();

    let memory_cell = MemoryCell {
        id: mc_id,
        clean_episode_id: ep_id,
        episode_text: mc_raw.episode_text,
        facts: mc_raw.facts,
        foresight,
        created_at: now_utc_iso(),
    };

    (episode, memory_cell)
}

// ============================================================
// 4. No-AI 物理聚类降级
// ============================================================

/// 基于 App 邻近度与 10 分钟时间窗的本地聚类降级。
///
/// 规则（`01_ARCHITECTURAL_DECISIONS.md` §4.1 + `09_PRODUCT_ACCEPTANCE_LEDGER.md` 用例 4）：
/// - 遍历 segments（已按 start_time 升序），若与当前簇最后一个 segment 同 process_name
///   且时间间隔 <10min，加入当前簇；否则开新簇。
/// - 每个簇生成一个 CleanEpisode + MemoryCell。
fn distill_with_local_cluster(
    date: &str,
    hour_bucket: &str,
    segments: &[WorkSegment],
) -> Vec<(CleanEpisode, MemoryCell)> {
    if segments.is_empty() {
        return vec![];
    }

    // ---- 聚类 ----
    // Task 11：聚类维度增加 activity_type —— 同 activity_type（非 None/非 "other"）
    // 亦可并入当前簇，前提仍是时间间隔 <10min（保留原时间窗约束）。
    let mut clusters: Vec<Vec<&WorkSegment>> = Vec::new();
    for seg in segments {
        let mut append = false;
        if let Some(last_cluster) = clusters.last_mut() {
            if let Some(last_seg) = last_cluster.last() {
                let same_process = last_seg.process_name == seg.process_name;
                let same_activity = last_seg
                    .activity_type
                    .as_deref()
                    .zip(seg.activity_type.as_deref())
                    .map(|(a, b)| a == b && a != "other")
                    .unwrap_or(false);
                if (same_process || same_activity) && time_gap_secs(last_seg, seg) < 600 {
                    last_cluster.push(seg);
                    append = true;
                }
            }
        }
        if !append {
            clusters.push(vec![seg]);
        }
    }

    let now = now_utc_iso();
    clusters
        .into_iter()
        .map(|cluster| build_local_episode(date, hour_bucket, &cluster, &now))
        .collect()
}

/// 由一个簇构建 (CleanEpisode, MemoryCell)。
fn build_local_episode(
    date: &str,
    hour_bucket: &str,
    cluster: &[&WorkSegment],
    now: &str,
) -> (CleanEpisode, MemoryCell) {
    let first = cluster[0];
    let last = cluster[cluster.len() - 1];
    let app_name = first.app_name.clone();
    let process_name = first.process_name.clone();

    let total_secs: i64 = cluster.iter().map(|s| s.duration_seconds).sum();
    let duration_min = (total_secs as f64 / 60.0).round() as i64;

    let title = pick_cluster_title(cluster);
    let memory_kind = infer_memory_kind(&process_name, first.activity_type.as_deref(), cluster);

    // summary: 统计性描述
    let distinct_titles: Vec<String> = {
        let mut v: Vec<String> = Vec::new();
        for s in cluster {
            if s.window_title.is_empty() {
                continue;
            }
            if !v.contains(&s.window_title) {
                v.push(s.window_title.clone());
            }
        }
        v
    };
    let title1 = distinct_titles.first().cloned().unwrap_or_default();
    let title2 = distinct_titles
        .iter()
        .skip(1)
        .next()
        .cloned()
        .unwrap_or_default();
    let summary = if title2.is_empty() {
        format!(
            "在 {} 中活动 {} 分钟，主要涉及 {}。",
            app_name, duration_min, title1
        )
    } else {
        format!(
            "在 {} 中活动 {} 分钟，主要涉及 {}、{}。",
            app_name, duration_min, title1, title2
        )
    };

    let segment_ids: Vec<String> = cluster.iter().map(|s| s.id.clone()).collect();
    // evidence_refs: 取前 3 条 ocr_text 片段
    let evidence_refs: Vec<String> = cluster
        .iter()
        .take(3)
        .map(|s| {
            let snippet: String = s.ocr_text.chars().take(120).collect();
            snippet.trim().to_string()
        })
        .filter(|s| !s.is_empty())
        .collect();

    let ep_id = Uuid::new_v4().to_string();
    let mc_id = Uuid::new_v4().to_string();

    let episode = CleanEpisode {
        id: ep_id.clone(),
        date: date.to_string(),
        hour_bucket: hour_bucket.to_string(),
        start_time: first.start_time.clone(),
        end_time: last.end_time.clone(),
        title,
        summary: summary.clone(),
        memory_kind,
        project: String::new(),
        entities: vec![],
        topics: vec![],
        materials: vec![],
        outputs: vec![],
        todos: vec![],
        blockers: vec![],
        segment_ids,
        evidence_refs,
        source_quality: "medium".to_string(),
        confidence: 0.6,
        wiki_eligible: false,
        wiki_status: "none".to_string(),
        is_private: false,
        model_name: "local-cluster".to_string(),
        distill_version: "1".to_string(),
        created_at: now.to_string(),
        updated_at: now.to_string(),
    };

    // MemoryCell: 第三人称客观叙事改写
    let episode_text = format!("用户在 {} 中持续活动约 {} 分钟。", app_name, duration_min);
    let memory_cell = MemoryCell {
        id: mc_id,
        clean_episode_id: ep_id,
        episode_text,
        facts: vec![],
        foresight: vec![],
        created_at: now.to_string(),
    };

    (episode, memory_cell)
}

/// 取窗口标题关键词作为簇标题：出现频率最高的标题前 20 字；
/// 若所有标题唯一则拼接前 2 个不同标题。
fn pick_cluster_title(cluster: &[&WorkSegment]) -> String {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for s in cluster {
        if s.window_title.is_empty() {
            continue;
        }
        let truncated: String = s.window_title.chars().take(20).collect();
        *counts.entry(truncated).or_insert(0) += 1;
    }
    if counts.is_empty() {
        return cluster
            .first()
            .map(|s| s.app_name.clone())
            .unwrap_or_else(|| "活动片段".to_string());
    }
    let max_count = *counts.values().max().unwrap_or(&0);
    if max_count > 1 {
        // 最高频标题
        return counts
            .iter()
            .find(|(_, c)| **c == max_count)
            .map(|(k, _)| k.clone())
            .unwrap_or_default();
    }
    // 全部唯一 → 拼接前 2 个不同标题
    let mut distinct: Vec<String> = Vec::new();
    for s in cluster {
        let truncated: String = s.window_title.chars().take(20).collect();
        if truncated.is_empty() {
            continue;
        }
        if !distinct.contains(&truncated) {
            distinct.push(truncated);
            if distinct.len() >= 2 {
                break;
            }
        }
    }
    if distinct.is_empty() {
        cluster
            .first()
            .map(|s| s.app_name.clone())
            .unwrap_or_else(|| "活动片段".to_string())
    } else {
        distinct.join(" / ")
    }
}

/// 推断 memoryKind：coding/browsing/communication/writing/reading，其他=idle/work。
///
/// Task 11：优先按 activity_type 映射 memory_kind（明确活动类型胜过进程名推断）；
/// activity_type 为 None 或 "other"（含旧数据）时回退到既有 process_name 逻辑。
fn infer_memory_kind(process_name: &str, activity_type: Option<&str>, cluster: &[&WorkSegment]) -> String {
    // activity_type 优先（Task 11）
    if let Some(act) = activity_type {
        let kind = match act {
            "coding" => "work",
            "browsing" => "research",
            "communication" => "meeting",
            "document" => "documentation",
            "spreadsheet" => "work",
            "terminal" => "work",
            _ => "", // "other" 或未知 → 回退到 process_name 推断
        };
        if !kind.is_empty() {
            return kind.to_string();
        }
    }
    let proc_lower = process_name.to_lowercase();
    let combined: String = cluster
        .iter()
        .flat_map(|s| [s.window_title.clone(), s.ocr_text.clone()])
        .collect::<Vec<_>>()
        .join(" ");
    let text_lower = combined.to_lowercase();

    // coding: 文本中含代码扩展名
    let code_exts = [
        ".go", ".py", ".rs", ".ts", ".tsx", ".js", ".jsx", ".java", ".cpp", ".c", ".vue", ".rb",
        ".kt", ".swift", ".sh",
    ];
    if code_exts.iter().any(|e| text_lower.contains(e)) {
        return "coding".to_string();
    }
    // browsing: 浏览器进程
    let browsers = [
        "chrome", "msedge", "firefox", "brave", "opera", "safari", "arc", "edge",
    ];
    if browsers.iter().any(|b| proc_lower.contains(b)) {
        return "browsing".to_string();
    }
    // communication: IM 进程
    let ims = [
        "wechat", "weixin", "dingtalk", "feishu", "lark", "slack", "telegram", "qq", "teams",
        "skype", "discord",
    ];
    if ims.iter().any(|i| proc_lower.contains(i)) {
        return "communication".to_string();
    }
    // writing: Word/文档
    let writers = [
        "word", "wps", "notion", "obsidian", "typora", "wordpad", "pages", "onenote",
    ];
    if writers.iter().any(|w| proc_lower.contains(w)) {
        return "writing".to_string();
    }
    // reading: PDF
    let readers = ["pdf", "acrobat", "sumatra", "foxit", "preview", "kindle"];
    if readers.iter().any(|r| proc_lower.contains(r)) {
        return "reading".to_string();
    }
    "work".to_string()
}

/// 计算两个 segment 的时间间隔（秒）：b.start_time - a.end_time。
fn time_gap_secs(a: &WorkSegment, b: &WorkSegment) -> i64 {
    let parse = |t: &str| NaiveTime::parse_from_str(t, "%H:%M:%S").ok();
    match (parse(&a.end_time), parse(&b.start_time)) {
        (Some(t1), Some(t2)) => (t2 - t1).num_seconds().max(0),
        _ => 0,
    }
}

// ============================================================
// 5. 今日一句话总结
// ============================================================

/// 今日一句话总结。
/// - 有 API Key 且 episodes 非空 → 调 LLM 生成 1-2 句自然语言总结
/// - 无 Key 或失败 → 规则统计模板（`05_INTERACTION.md` §4.1 降级格式）
pub async fn get_today_summary(app: &tauri::AppHandle, date: &str) -> Result<String, String> {
    let episodes: Vec<CleanEpisode> = with_db(app, |conn| {
        repository::get_episodes_by_date(conn, date).unwrap_or_default()
    })
    .unwrap_or_default();
    let settings: AppSetting =
        with_db(app, |conn| repository::get_settings(conn).unwrap_or_default()).unwrap_or_default();
    let has_key = settings
        .openai_api_key
        .as_deref()
        .map(|k| !k.is_empty())
        .unwrap_or(false);

    if has_key && !episodes.is_empty() {
        let episodes_json = serde_json::to_string(&episodes).unwrap_or_default();
        let prompt = format!("请用 1-2 句话总结以下今日工作事件：{}", episodes_json);
        match call_openai_chat(&settings, &prompt).await {
            Ok(summary) => {
                let trimmed = summary.trim().to_string();
                if !trimmed.is_empty() {
                    return Ok(trimmed);
                }
            }
            Err(e) => log::warn!("AI 今日总结失败，降级规则模板: {}", e),
        }
    }
    Ok(rule_based_summary(app, &episodes, date))
}

/// 规则统计模板（`05_INTERACTION.md` §4.1）：
/// "今天你主要使用了 {app1} 和 {app2}，专注时长共计 {hours} 小时，产生了 {n} 条线索。"
fn rule_based_summary(app: &tauri::AppHandle, episodes: &[CleanEpisode], date: &str) -> String {
    if episodes.is_empty() {
        return "今天还没有记录到工作事件。".to_string();
    }
    let segments: Vec<WorkSegment> = with_db(app, |conn| {
        repository::get_segments_by_date(conn, date).unwrap_or_default()
    })
    .unwrap_or_default();

    // 按 app 聚合 duration，取 Top2
    let mut app_durations: HashMap<String, i64> = HashMap::new();
    for seg in &segments {
        *app_durations.entry(seg.app_name.clone()).or_insert(0) += seg.duration_seconds;
    }
    let mut apps: Vec<(String, i64)> = app_durations.into_iter().collect();
    apps.sort_by(|a, b| b.1.cmp(&a.1));

    let total_secs: i64 = segments.iter().map(|s| s.duration_seconds).sum();
    let hours = (total_secs as f64 / 3600.0).round() as i64;
    let n = episodes.len();

    let app1 = apps
        .first()
        .map(|(name, _)| name.clone())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "应用".to_string());
    if let Some((app2, _)) = apps.get(1) {
        if !app2.is_empty() {
            return format!(
                "今天你主要使用了 {} 和 {}，专注时长共计 {} 小时，产生了 {} 条线索。",
                app1, app2, hours, n
            );
        }
    }
    format!(
        "今天你主要使用了 {}，专注时长共计 {} 小时，产生了 {} 条线索。",
        app1, hours, n
    )
}

// ============================================================
// 6. Insights 计算
// ============================================================

/// 计算 Insights（`05_INTERACTION.md` §3 主动智能）。
/// 简单实现：
/// - time_disturb: 当日 segments 按 app 聚合 duration 的 Top3（info）
/// - fragmented_switch: 10 分钟内切换 >30 次 → warning
/// - open_todo: todos 非空的 episode → info
/// - deep_focus: 单 episode duration >45min → info
pub fn compute_insights(app: &tauri::AppHandle, date: &str) -> Result<Vec<Insight>, String> {
    let segments: Vec<WorkSegment> = with_db(app, |conn| {
        repository::get_segments_by_date(conn, date).unwrap_or_default()
    })
    .unwrap_or_default();
    let episodes: Vec<CleanEpisode> = with_db(app, |conn| {
        repository::get_episodes_by_date(conn, date).unwrap_or_default()
    })
    .unwrap_or_default();
    let now = now_utc_iso();
    let mut insights: Vec<Insight> = Vec::new();

    // 1. 时间分布（info）
    let mut app_durations: HashMap<String, i64> = HashMap::new();
    for seg in &segments {
        *app_durations.entry(seg.app_name.clone()).or_insert(0) += seg.duration_seconds;
    }
    if !app_durations.is_empty() {
        let mut apps: Vec<(String, i64)> = app_durations.into_iter().collect();
        apps.sort_by(|a, b| b.1.cmp(&a.1));
        let top: Vec<String> = apps
            .iter()
            .take(3)
            .map(|(n, s)| format!("{} ({}min)", n, s / 60))
            .collect();
        insights.push(Insight {
            id: Uuid::new_v4().to_string(),
            r#type: "time_disturb".to_string(),
            severity: "info".to_string(),
            title: "今日时间分布".to_string(),
            description: format!("时间占用 Top3: {}", top.join(", ")),
            metadata: None,
            created_at: now.clone(),
        });
    }

    // 2. 异常频繁切换（>30 次 in 10min → warning）
    if has_rapid_switch_window(&segments, 600, 30) {
        insights.push(Insight {
            id: Uuid::new_v4().to_string(),
            r#type: "fragmented_switch".to_string(),
            severity: "warning".to_string(),
            title: "注意力碎片化".to_string(),
            description: "10 分钟内窗口切换超过 30 次，建议合并临时沟通片段。".to_string(),
            metadata: None,
            created_at: now.clone(),
        });
    }

    // 3. 未完成线索（todos 非空 → info）
    for ep in &episodes {
        if !ep.todos.is_empty() {
            insights.push(Insight {
                id: Uuid::new_v4().to_string(),
                r#type: "open_todo".to_string(),
                severity: "info".to_string(),
                title: format!("待跟进: {}", ep.title),
                description: ep.todos.join("; "),
                metadata: None,
                created_at: now.clone(),
            });
        }
    }

    // 4. 深度专注（单 episode duration >45min → info）
    for ep in &episodes {
        let dur = duration_seconds_between(&ep.start_time, &ep.end_time);
        if dur > 2700 {
            insights.push(Insight {
                id: Uuid::new_v4().to_string(),
                r#type: "deep_focus".to_string(),
                severity: "info".to_string(),
                title: format!("深度专注: {}", ep.title),
                description: format!("持续专注 {} 分钟。", dur / 60),
                metadata: None,
                created_at: now.clone(),
            });
        }
    }

    Ok(insights)
}

/// 判断是否存在任意 10 分钟（window_secs）窗口内 segment 数 > threshold。
fn has_rapid_switch_window(segments: &[WorkSegment], window_secs: i64, threshold: usize) -> bool {
    if segments.len() <= threshold {
        return false;
    }
    // segments 已按 start_time 升序，转成当日秒数
    let times: Vec<i64> = segments
        .iter()
        .filter_map(|s| {
            NaiveTime::parse_from_str(&s.start_time, "%H:%M:%S")
                .ok()
                .map(|t| t.num_seconds_from_midnight() as i64)
        })
        .collect();
    if times.len() <= threshold {
        return false;
    }
    // 滑动窗口：right - left + 1 > threshold 即触发
    let mut left = 0usize;
    for right in 0..times.len() {
        while times[right] - times[left] > window_secs {
            left += 1;
        }
        if right - left + 1 > threshold {
            return true;
        }
    }
    false
}

/// 计算 HH:MM:SS 时间跨度（秒）。
fn duration_seconds_between(start: &str, end: &str) -> i64 {
    let parse = |t: &str| NaiveTime::parse_from_str(t, "%H:%M:%S").ok();
    match (parse(start), parse(end)) {
        (Some(t1), Some(t2)) => (t2 - t1).num_seconds().max(0),
        _ => 0,
    }
}

// ============================================================
// 7. build_distill_prompt（逐字实现 08_AI_PROMPTS.md §1）
// ============================================================

/// 整点 AI 蒸馏 Prompt 模板（逐字实现 `08_AI_PROMPTS.md` §1）。
/// 采用严苛的 JSON Schema 强制约束（JSON Mode），`{{`/`}}` 转义大括号。
pub fn build_distill_prompt(date: &str, hour_bucket: &str, ocr_records: &str) -> String {
    format!(
        r#"你是一个高精度的个人工作记忆整理专家。
下面是用户在 {date} {hour_bucket} 这个小时内，在电脑屏幕上被自动记录的原始 OCR 文本与窗口标题流。

【原始记录数据】
{ocr_records}

【处理任务】
请对上述碎片信息进行"智能降噪"、"去重"与"语义聚合"，将其聚合成 1-3 个有实际工作价值的 Episode（逻辑事件）。

【严格约束（核心红线）】
1. 必须完全过滤掉非工作社交聊天、系统弹窗、无意义的空白窗口和纯噪音。
2. 每一个 Episode 必须有理有据，其 evidence_refs 必须关联到产生该事件的物理 segment_id。
3. 必须输出严格 of JSON 格式，不包含任何 Markdown 代码块包裹（如 ```json），第一个字符必须是 {{，最后一个字符必须是 }}。

【输出 JSON Schema 约束】
{{
  "episodes": [
    {{
      "startTime": "HH:MM:SS",
      "endTime": "HH:MM:SS",
      "title": "简练、人类可理解的事件标题，例如：'调试订单退款接口'",
      "summary": "1-2句精炼的内容摘要，说明在这个事件中具体做了什么、得出了什么结论",
      "memoryKind": "work", // 选项: work, life, study, social, play, rest
      "project": "项目或模块名称，无则留空",
      "entities": ["提取出的人名、文档、系统名、链接、关键词"],
      "topics": ["主题标签，如：'Debug', '需求确认'"],
      "materials": ["使用的背景材料或参考文档名"],
      "outputs": ["产出物，如代码文件路径、文档草稿、确认的结论"],
      "todos": ["分析出来的、未来需要跟进的待办事项"],
      "blockers": ["遇到的阻塞点、未解决的问题"],
      "segmentIds": ["关联的 segments 物理 ID 数组"],
      "evidenceRefs": ["用于佐证该事件的关键 OCR 片段/句子 (3条以内)"],
      "sourceQuality": "high", // high, medium, low
      "confidence": 0.95, // 0.0 到 1.0 的置信度
      "wikiEligible": true, // 是否有复用价值、建议沉淀进 Wiki 知识库
      "memoryCell": {{
        "episodeText": "第三人称客观叙事总结，1-2句。例如：'用户在 VS Code 中调试了退款接口的 Go 代码，并确认了状态枚举值。'",
        "facts": ["提炼出的硬核事实 1", "事实 2"],
        "foresight": [
          {{
            "statement": "预判跟进事项，如：'明天需要同前端联调退款状态返回'",
            "validFrom": "YYYY-MM-DD",
            "validTo": "YYYY-MM-DD",
            "confidence": 0.9
          }}
        ]
      }}
    }}
  ]
}}
"#,
        date = date,
        hour_bucket = hour_bucket,
        ocr_records = ocr_records
    )
}

// ============================================================
// 单元测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: &str, start: &str, end: &str, proc: &str, app: &str, title: &str, dur: i64) -> WorkSegment {
        WorkSegment {
            id: id.to_string(),
            date: "2026-06-26".to_string(),
            start_time: start.to_string(),
            end_time: end.to_string(),
            duration_seconds: dur,
            app_name: app.to_string(),
            process_name: proc.to_string(),
            window_title: title.to_string(),
            ocr_text: String::new(),
            ocr_status: "done".to_string(),
            image_hash: String::new(),
            screenshot_path: String::new(),
            is_important: false,
            is_private: false,
            is_deleted: false,
            capture_source: "auto".to_string(),
            browser_url: None,
            activity_type: None,
            created_at: "2026-06-26T00:00:00+00:00".to_string(),
        }
    }

    #[test]
    fn time_gap_basic() {
        let a = seg("a", "14:00:00", "14:05:00", "Code.exe", "Code", "t1", 300);
        let b = seg("b", "14:06:00", "14:10:00", "Code.exe", "Code", "t2", 240);
        assert_eq!(time_gap_secs(&a, &b), 60);
    }

    #[test]
    fn cluster_same_process_within_10min() {
        let segs = vec![
            seg("a", "14:00:00", "14:05:00", "Code.exe", "Code", "t1", 300),
            seg("b", "14:06:00", "14:10:00", "Code.exe", "Code", "t2", 240),
        ];
        let result = distill_with_local_cluster("2026-06-26", "14:00", &segs);
        assert_eq!(result.len(), 1, "同进程 <10min 应聚为 1 簇");
        assert_eq!(result[0].0.model_name, "local-cluster");
        assert_eq!(result[0].0.confidence, 0.6);
        assert_eq!(result[0].0.segment_ids.len(), 2);
    }

    #[test]
    fn cluster_split_on_process_change() {
        let segs = vec![
            seg("a", "14:00:00", "14:05:00", "Code.exe", "Code", "t1", 300),
            seg("b", "14:06:00", "14:10:00", "chrome.exe", "Chrome", "t2", 240),
        ];
        let result = distill_with_local_cluster("2026-06-26", "14:00", &segs);
        assert_eq!(result.len(), 2, "进程变化应开新簇");
    }

    #[test]
    fn cluster_split_on_time_gap_over_10min() {
        let segs = vec![
            seg("a", "14:00:00", "14:05:00", "Code.exe", "Code", "t1", 300),
            seg("b", "14:20:00", "14:25:00", "Code.exe", "Code", "t2", 300),
        ];
        let result = distill_with_local_cluster("2026-06-26", "14:00", &segs);
        assert_eq!(result.len(), 2, "同进程但 >10min 应开新簇");
    }

    #[test]
    fn cluster_merges_same_activity_type_different_process() {
        // Task 11：3 个不同浏览器进程（msedge / chrome / firefox），但 activity_type
        // 均为 "browsing"，且时间间隔 <10min，应聚为 1 簇。
        let mut s1 = seg("a", "14:00:00", "14:05:00", "msedge.exe", "Edge", "t1", 300);
        s1.activity_type = Some("browsing".to_string());
        let mut s2 = seg("b", "14:06:00", "14:10:00", "chrome.exe", "Chrome", "t2", 240);
        s2.activity_type = Some("browsing".to_string());
        let mut s3 = seg("c", "14:11:00", "14:15:00", "firefox.exe", "Firefox", "t3", 240);
        s3.activity_type = Some("browsing".to_string());
        let segs = vec![s1, s2, s3];
        let result = distill_with_local_cluster("2026-06-26", "14:00", &segs);
        assert_eq!(result.len(), 1, "同 activity_type 不同进程 <10min 应聚为 1 簇");
        assert_eq!(result[0].0.segment_ids.len(), 3);
        // browsing → research（Task 11 activity_type 优先映射）
        assert_eq!(result[0].0.memory_kind, "research");
    }

    #[test]
    fn cluster_does_not_merge_on_activity_other() {
        // Task 11：activity_type="other" 不应触发跨进程合并，仍按进程名切分。
        let mut s1 = seg("a", "14:00:00", "14:05:00", "msedge.exe", "Edge", "t1", 300);
        s1.activity_type = Some("other".to_string());
        let mut s2 = seg("b", "14:06:00", "14:10:00", "chrome.exe", "Chrome", "t2", 240);
        s2.activity_type = Some("other".to_string());
        let segs = vec![s1, s2];
        let result = distill_with_local_cluster("2026-06-26", "14:00", &segs);
        assert_eq!(result.len(), 2, "activity_type=other 不应跨进程合并");
    }

    #[test]
    fn infer_kind_coding() {
        let s = seg("a", "14:00:00", "14:05:00", "Code.exe", "Code", "main.go", 300);
        let segs = vec![s];
        assert_eq!(infer_memory_kind("Code.exe", None, &segs.iter().collect::<Vec<_>>()), "coding");
    }

    #[test]
    fn infer_kind_browsing() {
        let s = seg("a", "14:00:00", "14:05:00", "chrome.exe", "Chrome", "Google", 300);
        let segs = vec![s];
        assert_eq!(infer_memory_kind("chrome.exe", None, &segs.iter().collect::<Vec<_>>()), "browsing");
    }

    #[test]
    fn extract_json_strips_fences() {
        let s = "```json\n{\"a\":1}\n```";
        assert_eq!(extract_json_object(s).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn extract_json_pure() {
        let s = "{\"a\":1}";
        assert_eq!(extract_json_object(s).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn extract_json_with_prefix() {
        let s = "好的，结果如下：\n{\"episodes\":[]}\n结束";
        assert_eq!(extract_json_object(s).unwrap(), "{\"episodes\":[]}");
    }

    #[test]
    fn build_prompt_contains_basics() {
        let p = build_distill_prompt("2026-06-26", "14:00", "[14:00:00] Code - t1: hello");
        assert!(p.contains("2026-06-26"));
        assert!(p.contains("14:00"));
        assert!(p.contains("[14:00:00] Code - t1: hello"));
        assert!(p.contains("\"episodes\""));
        assert!(p.starts_with("你是一个高精度的个人工作记忆整理专家。"));
    }

    #[test]
    fn serialize_segment_block_includes_all_six_fields() {
        let mut s = seg("a", "14:00:00", "14:05:00", "Code.exe", "Code", "main.go", 300);
        s.browser_url = Some("https://github.com/org/repo/pull/421".to_string());
        s.activity_type = Some("coding".to_string());
        s.ocr_text = "Fix checkout state machine".to_string();
        let block = serialize_segment_block(&s);
        assert_eq!(block["app_name"], "Code");
        assert_eq!(block["window_title"], "main.go");
        assert_eq!(block["browser_url"], "https://github.com/org/repo/pull/421");
        assert_eq!(block["activity_type"], "coding");
        assert_eq!(block["timestamp"], "2026-06-26 14:00:00");
        let rt = block["reconstructed_text"].as_str().unwrap();
        assert!(
            rt.starts_with("网页上下文：github.com/org/repo/pull/421\n"),
            "应包含网页上下文前缀"
        );
        assert!(rt.contains("Fix checkout state machine"));
    }

    #[test]
    fn serialize_segment_block_no_browser_url_no_prefix() {
        let mut s = seg("a", "14:00:00", "14:05:00", "Code.exe", "Code", "main.go", 300);
        s.activity_type = Some("coding".to_string());
        s.ocr_text = "hello world".to_string();
        let block = serialize_segment_block(&s);
        let rt = block["reconstructed_text"].as_str().unwrap();
        assert_eq!(rt, "hello world"); // 无网页上下文前缀
        assert!(block["browser_url"].is_null());
        assert_eq!(block["activity_type"], "coding");
    }

    #[test]
    fn rapid_switch_detection() {
        // 31 个 segments 集中在 6 分钟内 → 触发
        let mut segs: Vec<WorkSegment> = Vec::new();
        for i in 0..31 {
            let mm = format!("{:02}", i / 6);
            let ss = format!("{:02}", (i % 6) * 10);
            segs.push(seg(&format!("s{}", i), &format!("14:{}:{}", mm, ss), &format!("14:{}:{}", mm, ss), "x", "x", "t", 10));
        }
        assert!(has_rapid_switch_window(&segs, 600, 30));
        // 31 个 segments 每分钟 1 个，分散在 30 分钟内 → 不触发（任一 10 分钟窗口最多 11 个）
        let mut segs2: Vec<WorkSegment> = Vec::new();
        for i in 0..31 {
            let mm = format!("{:02}", i); // 0..30 分钟，均合法
            segs2.push(seg(&format!("s{}", i), &format!("14:{}:00", mm), &format!("14:{}:00", mm), "x", "x", "t", 10));
        }
        assert!(!has_rapid_switch_window(&segs2, 600, 30));
    }

    #[test]
    fn raw_to_episode_fills_defaults() {
        let raw = DistillEpisodeRaw {
            start_time: "14:00:00".to_string(),
            end_time: "14:30:00".to_string(),
            title: "测试".to_string(),
            summary: "做测试".to_string(),
            memory_kind: String::new(),
            project: String::new(),
            entities: vec![],
            topics: vec![],
            materials: vec![],
            outputs: vec![],
            todos: vec![],
            blockers: vec![],
            segment_ids: vec![],
            evidence_refs: vec![],
            source_quality: String::new(),
            confidence: 0.0,
            wiki_eligible: false,
            memory_cell: None,
        };
        let (ep, mc) = raw_to_episode_and_cell(raw, "2026-06-26", "14:00", "gpt-4o-mini");
        assert_eq!(ep.date, "2026-06-26");
        assert_eq!(ep.hour_bucket, "14:00");
        assert_eq!(ep.memory_kind, "work"); // 默认值
        assert_eq!(ep.source_quality, "medium"); // 默认值
        assert_eq!(ep.wiki_status, "none");
        assert_eq!(ep.model_name, "gpt-4o-mini");
        assert_eq!(mc.clean_episode_id, ep.id);
    }
}
