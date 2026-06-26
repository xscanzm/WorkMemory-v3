//! 日报生成器（Task 10）
//!
//! 严格遵循：
//! - `08_AI_PROMPTS.md` §2 日报生成 Prompt（4 模板：enhanced / concise / okr / structured）
//! - `05_INTERACTION.md` §4.2 降级 Bullet 模板（无 OpenAI Key 时零延迟本地拼接）
//! - `05_INTERACTION.md` §3.1 生成完成后广播 `report-ready` 事件，触发前端 Mascot jump 动画
//!
//! ## 策略
//! 1. 查询当日全部 clean_episodes，组装 episodes_json；
//! 2. 读取 settings：若存在 `openai_api_key` → 调 OpenAI Chat Completion 生成 Markdown；
//! 3. 无 Key 或网络/解析失败 → 降级 Bullet 模板拼接（零延迟）；
//! 4. 构造 WorkReport 写入 reports 表，广播 `report-ready`，返回 WorkReport。
//!
//! ## 并发安全
//! DB 连接由 `std::sync::Mutex` 保护，其 Guard 非 Send，禁止跨 `.await` 持有。
//! 因此读（episodes + settings）与写（insert_report）分两段加锁，AI 请求在两段之间执行。

use tauri::{Emitter, Manager};

use crate::{db::repository, models};

// ============================================================================
// Prompt 构建（08_AI_PROMPTS.md §2）
// ============================================================================

/// 构建日报生成 Prompt。
///
/// 4 模板的 `format_instruction` 通过 match 选择：concise / okr / structured，
/// 其余（含 enhanced）走默认分支。运行时占位符使用具名参数 `{date}` /
/// `{episodes_json}` / `{format_instruction}`（单层大括号即 format! 替换占位符）；
/// 若 Prompt 文本中需要原样输出大括号，须转义为 `{{` `}}`（本 Prompt 暂无字面大括号）。
pub fn build_report_prompt(template: &str, date: &str, episodes_json: &str) -> String {
    let format_instruction = match template {
        "concise" => "使用「简洁模板」：仅保留 3-5 条核心工作线索，每条一句话概括，删除冗余细节与重复项，末尾用 1-2 句总结当日产出。",
        "okr" => "使用「OKR 模板」：按 Objective（目标）→ Key Results（关键结果）组织，将线索归入对应目标下，标注完成进度与偏差，末尾给出明日目标建议。",
        "structured" => "使用「结构化模板」：按「💻 活跃线索流」「🎯 关键产出」「⚠️ 阻塞与风险」「📅 明日待办」四段组织，每段用 bullet 列出，保留时间区间与关键实体。",
        _ => "使用「增强模板」：在结构化基础上增加「💡 洞察与反思」段落，合并语义相近的线索，对长时间沉浸的任务给出专注度评价，并用 Markdown 表格呈现时间分布。",
    };
    format!(
        "你是 WorkMemory 的工作复盘助手。请根据下列当日活跃线索（已蒸馏为逻辑事件）生成一份 Markdown 格式的日报。\n\n\
严格约束：\n\
1. 仅基于给定的 episodes 数据，不得编造未出现的内容；\n\
2. 输出纯 Markdown，第一行为一级标题「# 今日工作复盘」；\n\
3. 合并语义重复的线索，按时间或主题归组；\n\
4. {format_instruction}\n\n\
日期: {date}\n\n\
当日活跃线索（JSON 数组）：\n\
```json\n{episodes_json}\n```\n\n\
请直接输出日报 Markdown，不要附加任何解释。",
        format_instruction = format_instruction,
        date = date,
        episodes_json = episodes_json,
    )
}

// ============================================================================
// generate_report 命令实现
// ============================================================================

/// 生成当日工作复盘报告。
///
/// 流程：查询当日 episodes → 组装 episodes_json → 读 settings →
/// 有 Key 则 AI 生成（失败降级）/ 无 Key 直接降级模板 → 构造 WorkReport →
/// 写入 reports 表 → 广播 `report-ready` 事件 → 返回 WorkReport。
pub async fn generate_report(
    app: &tauri::AppHandle,
    date: &str,
    template_type: &str,
) -> Result<models::WorkReport, String> {
    // ---- 第一段加锁：读取 episodes + settings + api_key（不跨 await）----
    let (episodes, settings, api_key) = {
        let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
        let conn = state.lock().map_err(|e| e.to_string())?;
        let episodes =
            repository::get_episodes_by_date(&conn, date).map_err(|e| e.to_string())?;
        let settings = repository::get_settings(&conn).map_err(|e| e.to_string())?;
        let api_key = read_api_key(&conn);
        (episodes, settings, api_key)
    };

    // ---- 组装 episodes_json ----
    let episodes_json = serde_json::to_string_pretty(&episodes)
        .unwrap_or_else(|_| "[]".to_string());

    // ---- 生成 Markdown：有 Key 走 AI，失败/无 Key 走降级模板 ----
    let prompt = build_report_prompt(template_type, date, &episodes_json);

    let (markdown, model_name) = if !api_key.is_empty() {
        match generate_with_ai(
            &settings.openai_base_url,
            &api_key,
            &settings.openai_model,
            &prompt,
        )
        .await
        {
            Some(md) => (md, settings.openai_model.clone()),
            None => (
                build_fallback_markdown(date, &episodes),
                "local-template".to_string(),
            ),
        }
    } else {
        // 无 Key：零延迟降级模板拼接
        (
            build_fallback_markdown(date, &episodes),
            "local-template".to_string(),
        )
    };

    // ---- 构造 WorkReport ----
    let now = now_iso8601();
    let report = models::WorkReport {
        id: uuid::Uuid::new_v4().to_string(),
        date: date.to_string(),
        report_type: "daily".to_string(),
        template: template_type.to_string(),
        title: "今日工作复盘".to_string(),
        content: markdown,
        status: "draft".to_string(),
        model_name,
        created_at: now.clone(),
        updated_at: now,
    };

    // ---- 第二段加锁：写入 reports 表（不跨 await）----
    {
        let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
        let conn = state.lock().map_err(|e| e.to_string())?;
        repository::insert_report(&conn, &report).map_err(|e| e.to_string())?;
    }

    // ---- 广播 report-ready 事件，触发前端 Mascot jump 动画 ----
    let _ = app.emit("report-ready", serde_json::json!({}));

    Ok(report)
}

// ============================================================================
// AI 生成（OpenAI Chat Completion）
// ============================================================================

/// 调用 OpenAI Chat Completion 生成日报 Markdown。
///
/// 成功返回 `Some(markdown)`；网络或解析失败返回 `None`（由调用方降级到本地模板）。
async fn generate_with_ai(
    base_url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Option<String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.4,
        "stream": false
    });

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("reqwest client 构建失败，降级模板: {}", e);
            return None;
        }
    };

    let resp = match client
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::warn!("OpenAI 请求失败，降级模板: {}", e);
            return None;
        }
    };

    let json: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            log::warn!("OpenAI 响应解析失败，降级模板: {}", e);
            return None;
        }
    };

    let content = json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str());

    match content {
        Some(s) if !s.trim().is_empty() => Some(s.to_string()),
        _ => {
            log::warn!("OpenAI 响应 content 为空，降级模板");
            None
        }
    }
}

// ============================================================================
// 降级模板（05_INTERACTION.md §4.2 Bullet 模板）
// ============================================================================

/// 按降级 Bullet 模板拼装 Markdown：标题 + 每条 episode 一段 + 末尾提示。
fn build_fallback_markdown(date: &str, episodes: &[models::CleanEpisode]) -> String {
    let mut md = String::new();
    md.push_str(&format!(
        "# 今日工作复盘 (WorkMemory 自动整理)\n日期: {}\n\n## 💻 活跃线索流 (按持续时间排序)\n",
        date
    ));
    for ep in episodes {
        let apps = extract_apps_from_episode(ep);
        let titles = extract_titles_from_episode(ep);
        md.push_str(&format!(
            "* **[{}-{}] {}**\n    - 活跃应用: {}\n    - 关键标题: {}\n",
            ep.start_time, ep.end_time, ep.title, apps, titles
        ));
    }
    md.push_str("*💡 提示: 已启用本地降级模板。填入 OpenAI Key 后即可享受 AI 自动润色与逻辑合并。*");
    md
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 从 episode 推断活跃应用：简化实现，返回 episode.project 或 "多个应用"。
fn extract_apps_from_episode(ep: &models::CleanEpisode) -> String {
    if !ep.project.is_empty() {
        ep.project.clone()
    } else {
        "多个应用".to_string()
    }
}

/// 从 episode 推断关键标题：返回 episode.title + " " + entities.join(", ")。
fn extract_titles_from_episode(ep: &models::CleanEpisode) -> String {
    format!("{} {}", ep.title, ep.entities.join(", "))
}

// ============================================================================
// 内部工具
// ============================================================================

/// 从 settings KV 表读取 `openai_api_key`；不存在或查询失败返回空串。
fn read_api_key(conn: &rusqlite::Connection) -> String {
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'openai_api_key'",
        [],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_default()
}

/// 当前本地时间的 ISO8601 / RFC3339 字符串（含时区偏移）。
fn now_iso8601() -> String {
    chrono::Local::now().format("%+").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_report_prompt_contains_date_and_episodes() {
        let prompt = build_report_prompt("enhanced", "2026-06-26", "[{\"id\":\"e1\"}]");
        assert!(prompt.contains("2026-06-26"));
        assert!(prompt.contains("[{\"id\":\"e1\"}]"));
        // 增强模板（默认分支）应包含洞察段落说明
        assert!(prompt.contains("增强模板"));
    }

    #[test]
    fn build_report_prompt_template_match() {
        assert!(build_report_prompt("concise", "d", "[]").contains("简洁模板"));
        assert!(build_report_prompt("okr", "d", "[]").contains("OKR 模板"));
        assert!(build_report_prompt("structured", "d", "[]").contains("结构化模板"));
        // 未知模板走 enhanced 默认
        assert!(build_report_prompt("unknown", "d", "[]").contains("增强模板"));
    }

    #[test]
    fn build_report_prompt_substitutes_placeholders() {
        // 占位符 {date}/{episodes_json}/{format_instruction} 应被实际值替换，
        // 替换后 prompt 中不应残留字面 "{format_instruction}"。
        let prompt = build_report_prompt("enhanced", "2026-06-26", "[]");
        assert!(!prompt.contains("{format_instruction}"));
        assert!(!prompt.contains("{date}"));
        assert!(!prompt.contains("{episodes_json}"));
    }

    #[test]
    fn fallback_markdown_format_strict() {
        let ep = models::CleanEpisode {
            id: "e1".into(),
            date: "2026-06-26".into(),
            hour_bucket: "10:00".into(),
            start_time: "10:00:00".into(),
            end_time: "11:00:00".into(),
            title: "编写报告模块".into(),
            summary: String::new(),
            memory_kind: "work".into(),
            project: "WorkMemory".into(),
            entities: vec!["report.rs".into(), "Rust".into()],
            topics: vec![],
            materials: vec![],
            outputs: vec![],
            todos: vec![],
            blockers: vec![],
            segment_ids: vec![],
            evidence_refs: vec![],
            source_quality: "medium".into(),
            confidence: 0.8,
            wiki_eligible: false,
            wiki_status: "none".into(),
            is_private: false,
            model_name: "gpt-4o-mini".into(),
            distill_version: "v1".into(),
            created_at: "2026-06-26T10:00:00+08:00".into(),
            updated_at: "2026-06-26T10:00:00+08:00".into(),
        };
        let md = build_fallback_markdown("2026-06-26", &[ep]);
        assert!(md.contains("# 今日工作复盘 (WorkMemory 自动整理)"));
        assert!(md.contains("日期: 2026-06-26"));
        assert!(md.contains("## 💻 活跃线索流 (按持续时间排序)"));
        assert!(md.contains("* **[10:00:00-11:00:00] 编写报告模块**"));
        assert!(md.contains("- 活跃应用: WorkMemory"));
        assert!(md.contains("- 关键标题: 编写报告模块 report.rs, Rust"));
        assert!(md.contains("已启用本地降级模板"));
    }

    #[test]
    fn extract_apps_fallback_when_no_project() {
        let mut ep = models::CleanEpisode {
            id: "e1".into(),
            date: "d".into(),
            hour_bucket: "10:00".into(),
            start_time: "10:00:00".into(),
            end_time: "11:00:00".into(),
            title: "t".into(),
            summary: String::new(),
            memory_kind: "work".into(),
            project: String::new(),
            entities: vec![],
            topics: vec![],
            materials: vec![],
            outputs: vec![],
            todos: vec![],
            blockers: vec![],
            segment_ids: vec![],
            evidence_refs: vec![],
            source_quality: "medium".into(),
            confidence: 0.0,
            wiki_eligible: false,
            wiki_status: "none".into(),
            is_private: false,
            model_name: String::new(),
            distill_version: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        };
        assert_eq!(extract_apps_from_episode(&ep), "多个应用");
        ep.project = "Web".into();
        assert_eq!(extract_apps_from_episode(&ep), "Web");
    }
}
