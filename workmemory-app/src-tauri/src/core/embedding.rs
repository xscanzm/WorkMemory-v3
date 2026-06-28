//! 向量语义检索模块 (Task 17 / P2)
//!
//! 实现 `03_CORE_ARCHITECTURE.md` §3.3 的向量召回管线：
//! 1. OpenAI `text-embedding-3-small` 客户端
//! 2. 蒸馏后异步向量化 MemoryCell → embeddings 表
//! 3. 本地余弦相似度暴力召回 top-10
//!
//! ## 硬约束
//! - embeddings 表存 f32 Little-Endian 字节序列
//! - 召回为本地全量扫描（加载全部 embeddings 到内存）
//! - 无 API Key 或 `embedding_enabled=false` 时静默返回空
//! - API Key 从环境变量 `OPENAI_API_KEY` 读取（AppSetting 不持有密钥）

use tauri::Manager;

use crate::db::repository;
use crate::models;

/// OpenAI Embedding 模型版本（同时作为 embeddings.model_version 落库）
const EMBEDDING_MODEL: &str = "text-embedding-3-small";

// ============================================================================
// OpenAI Embedding 请求/响应结构
// ============================================================================

#[derive(serde::Serialize)]
struct EmbeddingRequest<'a> {
    model: &'a str,
    input: &'a str,
}

#[derive(serde::Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(serde::Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

/// 从环境变量读取 OpenAI API Key。空字符串视为未配置。
fn get_api_key() -> Option<String> {
    std::env::var("OPENAI_API_KEY")
        .ok()
        .filter(|s| !s.is_empty())
}

// ============================================================================
// 1. OpenAI Embedding 客户端
// ============================================================================

/// 调用 OpenAI Embeddings API 获取文本向量。
///
/// - endpoint：`{settings.openai_base_url}/embeddings`
/// - model：`text-embedding-3-small`
/// - 解析 `data[0].embedding` 为 `Vec<f32>`
///
/// 失败（无 Key / 网络错误 / 非 2xx / 解析失败）返回 `Err`。
pub async fn embed_text(
    text: &str,
    settings: &models::AppSetting,
) -> Result<Vec<f32>, String> {
    let api_key = get_api_key().ok_or_else(|| "OPENAI_API_KEY 未配置".to_string())?;

    let url = format!(
        "{}/embeddings",
        settings.openai_base_url.trim_end_matches('/')
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("reqwest client 构建失败: {}", e))?;

    let resp = client
        .post(&url)
        .bearer_auth(&api_key)
        .json(&EmbeddingRequest {
            model: EMBEDDING_MODEL,
            input: text,
        })
        .send()
        .await
        .map_err(|e| format!("embedding 请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("embedding API 非 2xx: {} {}", status, body));
    }

    let parsed: EmbeddingResponse = resp
        .json()
        .await
        .map_err(|e| format!("embedding 响应解析失败: {}", e))?;

    parsed
        .data
        .into_iter()
        .next()
        .map(|d| d.embedding)
        .ok_or_else(|| "embedding 响应 data 为空".to_string())
}

// ============================================================================
// 2. 蒸馏后异步向量化
// ============================================================================

/// 将一个 MemoryCell 向量化并写入 embeddings 表。
///
/// 输入文本 = `episode_text + " " + facts.join(" ")`。
/// 向量序列化为 f32 LE 字节数组后入库（id=uuid, model_version=EMBEDDING_MODEL）。
/// 任一步骤失败均 `log::warn` 静默处理，不阻断主蒸馏流程。
pub async fn embed_memory_cell(app: &tauri::AppHandle, cell: &models::MemoryCell) {
    // 加载 settings：未启用 embedding 则直接跳过
    let settings = {
        let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
        let conn = match pool.get() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("向量化跳过（DB 连接池获取失败）cell={}: {}", cell.id, e);
                return;
            }
        };
        match repository::get_settings(&conn) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("向量化跳过（读取 settings 失败）cell={}: {}", cell.id, e);
                return;
            }
        }
    };

    if !settings.embedding_enabled {
        return;
    }

    // 拼接输入文本：episode_text + " " + facts.join(" ")
    let mut text = cell.episode_text.clone();
    if !cell.facts.is_empty() {
        text.push(' ');
        text.push_str(&cell.facts.join(" "));
    }

    // 调用 OpenAI 获取向量
    let vec_f32 = match embed_text(&text, &settings).await {
        Ok(v) => v,
        Err(e) => {
            log::warn!("向量化失败 cell={}: {}", cell.id, e);
            return;
        }
    };

    // 序列化为 f32 LE 字节数组
    let blob: Vec<u8> = vec_f32.iter().flat_map(|f| f.to_le_bytes()).collect();

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let embedding = models::Embedding {
        id: uuid::Uuid::new_v4().to_string(),
        memory_cell_id: cell.id.clone(),
        embedding: blob,
        model_version: EMBEDDING_MODEL.to_string(),
        created_at: now,
    };

    // 写入 DB
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("向量化写库跳过（DB 连接池获取失败）cell={}: {}", cell.id, e);
            return;
        }
    };
    if let Err(e) = repository::insert_embedding(&conn, &embedding) {
        log::warn!("向量化写库失败 cell={}: {}", cell.id, e);
    }
}

// ============================================================================
// 3. 本地余弦相似度召回
// ============================================================================

/// 向量语义检索：对 query 向量化后与库内全部 embedding 做余弦相似度，取 top-10。
///
/// 无 API Key 或 `embedding_enabled=false` 时返回空 vec。
/// API/DB 错误同样静默返回空 vec（仅 `log::warn`）。
///
/// 每条结果反查 memory_cell → clean_episode，构造 SearchResult：
/// - source_id = memory_cell.id
/// - source_type = "memory"
/// - date / time_range / primary_text 取自 episode
/// - snippet = memory_cell.episode_text
/// - score = 余弦相似度
/// - match_reason = "语义命中"
pub async fn vector_search(app: &tauri::AppHandle, query: &str) -> Vec<models::SearchResult> {
    // 1. 读取 settings 并做前置检查
    let settings = {
        let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
        let conn = match pool.get() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("向量检索跳过（DB 连接池获取失败）: {}", e);
                return vec![];
            }
        };
        match repository::get_settings(&conn) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("向量检索跳过（读取 settings 失败）: {}", e);
                return vec![];
            }
        }
    };

    if !settings.embedding_enabled {
        return vec![];
    }
    if get_api_key().is_none() {
        return vec![];
    }

    // 2. 向量化 query（网络调用，不持锁）
    let query_vec = match embed_text(query, &settings).await {
        Ok(v) => v,
        Err(e) => {
            log::warn!("向量检索跳过（query 向量化失败）: {}", e);
            return vec![];
        }
    };

    // 3. 加载全部 embeddings 到内存
    let embeddings = {
        let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
        let conn = match pool.get() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("向量检索跳过（DB 连接池获取失败）: {}", e);
                return vec![];
            }
        };
        match repository::get_all_embeddings(&conn) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("向量检索跳过（加载 embeddings 失败）: {}", e);
                return vec![];
            }
        }
    };

    // 4. 计算余弦相似度
    let mut scored: Vec<(f32, models::Embedding)> = Vec::with_capacity(embeddings.len());
    for emb in embeddings {
        let candidate = deserialize_embedding(&emb.embedding);
        let sim = cosine_similarity(&query_vec, &candidate);
        scored.push((sim, emb));
    }

    // 5. 降序排列取 top-10
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let top_k = scored.into_iter().take(10);

    // 6. 反查 memory_cell → clean_episode，构造 SearchResult
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("向量检索跳过（DB 连接池获取失败，反查阶段）: {}", e);
            return vec![];
        }
    };

    let mut results: Vec<models::SearchResult> = Vec::new();
    for (sim, emb) in top_k {
        // 反查 memory_cell（仅需 id / clean_episode_id / episode_text）
        let cell: Option<(String, String, String)> = conn
            .query_row(
                "SELECT id, clean_episode_id, episode_text FROM memory_cells WHERE id = ?1",
                rusqlite::params![emb.memory_cell_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();

        let (cell_id, episode_id, episode_text) = match cell {
            Some(c) => c,
            None => {
                log::warn!(
                    "向量检索：memory_cell 不存在 id={}",
                    emb.memory_cell_id
                );
                continue;
            }
        };

        // 反查 clean_episode
        let episode = match repository::get_episode_by_id(&conn, &episode_id) {
            Ok(Some(ep)) => ep,
            Ok(None) => {
                log::warn!(
                    "向量检索：episode 不存在 cell={} episode_id={}",
                    cell_id,
                    episode_id
                );
                continue;
            }
            Err(e) => {
                log::warn!(
                    "向量检索：查询 episode 失败 cell={} episode_id={}: {}",
                    cell_id,
                    episode_id,
                    e
                );
                continue;
            }
        };

        results.push(models::SearchResult {
            source_id: cell_id,
            source_type: "memory".to_string(),
            date: episode.date.clone(),
            time_range: format!("{}-{}", episode.start_time, episode.end_time),
            primary_text: episode.title.clone(),
            snippet: episode_text,
            score: sim,
            match_reason: "语义命中".to_string(),
        });
    }

    results
}

// ============================================================================
// 4. 余弦相似度
// ============================================================================

/// 标准余弦相似度：`dot(a,b) / (|a| * |b|)`。零向量或长度为 0 返回 0。
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let len = a.len().min(b.len());
    if len == 0 {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..len {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 || !denom.is_finite() {
        return 0.0;
    }
    dot / denom
}

// ============================================================================
// 辅助：LE 字节 → Vec<f32>
// ============================================================================

/// 将 f32 LE 字节序列反序列化为 `Vec<f32>`。
/// `chunks_exact(4)` 保证每段恰好 4 字节，`try_into().unwrap()` 安全。
fn deserialize_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect()
}
