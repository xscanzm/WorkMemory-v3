// repository 单元测试：内存 SQLite + 迁移 + CRUD + FTS5 触发器同步
// 注：FTS5 unicode61 把连续 CJK 视为单个 token，故测试中让中文关键词被空格
// 分隔为独立 token，以使 MATCH 短语能命中（与生产环境 OCR 文本常含英文/标点一致）。

#![cfg(test)]

use super::migrations;
use super::repository::*;
use crate::models::*;
use rusqlite::Connection;

/// 建立内存数据库并执行迁移，返回可用连接。
fn setup() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrations::run(&conn).unwrap();
    conn
}

/// 构造一条可定制的 WorkSegment（仅 id 与 ocr_text 可变）。
fn sample_segment(id: &str, ocr_text: &str) -> WorkSegment {
    WorkSegment {
        id: id.to_string(),
        date: "2026-06-26".to_string(),
        start_time: "10:00:00".to_string(),
        end_time: "10:05:00".to_string(),
        duration_seconds: 300,
        app_name: "VSCode".to_string(),
        process_name: "Code.exe".to_string(),
        window_title: "main.rs - WorkMemory".to_string(),
        ocr_text: ocr_text.to_string(),
        ocr_status: "done".to_string(),
        image_hash: "phash-abc".to_string(),
        screenshot_path: "shots/seg.png".to_string(),
        is_important: false,
        is_private: false,
        is_deleted: false,
        capture_source: "auto".to_string(),
        browser_url: None,
        activity_type: Some("coding".to_string()),
        created_at: "2026-06-26T10:05:00Z".to_string(),
    }
}

/// 构造一条可定制的 CleanEpisode（仅 id 与 summary 可变）。
fn sample_episode(id: &str, summary: &str) -> CleanEpisode {
    CleanEpisode {
        id: id.to_string(),
        date: "2026-06-26".to_string(),
        hour_bucket: "10:00".to_string(),
        start_time: "10:00:00".to_string(),
        end_time: "11:00:00".to_string(),
        title: "推进退款字段确认".to_string(),
        summary: summary.to_string(),
        memory_kind: "work".to_string(),
        project: "订单系统".to_string(),
        entities: vec!["张三".to_string(), "需求A".to_string()],
        topics: vec!["退款".to_string()],
        materials: vec!["PRD.docx".to_string()],
        outputs: vec!["字段定义".to_string()],
        todos: vec!["对齐财务".to_string()],
        blockers: vec!["权限不足".to_string()],
        segment_ids: vec!["seg-1".to_string()],
        evidence_refs: vec!["shot-1".to_string()],
        source_quality: "high".to_string(),
        confidence: 0.9,
        wiki_eligible: true,
        wiki_status: "eligible".to_string(),
        model_name: "gpt-4o-mini".to_string(),
        distill_version: "v1".to_string(),
        created_at: "2026-06-26T11:00:00Z".to_string(),
        updated_at: "2026-06-26T11:00:00Z".to_string(),
    }
}

#[test]
fn segment_insert_and_query_roundtrip() {
    let conn = setup();
    let seg = sample_segment("seg-1", "hello world");
    insert_segment(&conn, &seg).unwrap();

    let fetched = get_segments_by_date(&conn, "2026-06-26").unwrap();
    assert_eq!(fetched.len(), 1);
    let s = &fetched[0];
    assert_eq!(s.id, "seg-1");
    assert_eq!(s.app_name, "VSCode");
    assert_eq!(s.ocr_text, "hello world");
    assert_eq!(s.ocr_status, "done");
    assert!(!s.is_important);
    assert!(!s.is_deleted);
    assert_eq!(s.activity_type.as_deref(), Some("coding"));
    assert!(s.browser_url.is_none());
}

#[test]
fn segment_get_by_id_and_soft_delete() {
    let conn = setup();
    insert_segment(&conn, &sample_segment("seg-2", "abc")).unwrap();

    let got = get_segment_by_id(&conn, "seg-2").unwrap();
    assert!(got.is_some());
    assert_eq!(got.unwrap().id, "seg-2");

    soft_delete_segment(&conn, "seg-2").unwrap();
    // 软删除后按日期查询（过滤 is_deleted）应不可见
    let by_date = get_segments_by_date(&conn, "2026-06-26").unwrap();
    assert!(by_date.is_empty());
    // 但 get_segment_by_id 仍可取回（含软删除）
    let still = get_segment_by_id(&conn, "seg-2").unwrap().unwrap();
    assert!(still.is_deleted);
}

#[test]
fn segment_merge_duration_and_ocr_update() {
    let conn = setup();
    insert_segment(&conn, &sample_segment("seg-3", "initial text")).unwrap();
    merge_segment_duration(&conn, "seg-3", 120, "10:07:00").unwrap();
    update_segment_ocr(&conn, "seg-3", "updated ocr text", "done").unwrap();

    let s = get_segment_by_id(&conn, "seg-3").unwrap().unwrap();
    assert_eq!(s.duration_seconds, 420);
    assert_eq!(s.end_time, "10:07:00");
    assert_eq!(s.ocr_text, "updated ocr text");
}

#[test]
fn fts_segments_syncs_on_insert() {
    let conn = setup();
    // "测试" 被空格分隔为独立 token，便于 unicode61 MATCH 命中
    let seg = sample_segment("seg-fts", "WorkMemory 测试 任务 test segment data");
    insert_segment(&conn, &seg).unwrap();

    let hits = search_segments_fts(&conn, "测试", 10).unwrap();
    assert!(!hits.is_empty(), "FTS5 触发器应在 INSERT 后同步并命中 测试");
    let (_, snippet, _rank) = &hits[0];
    assert!(
        snippet.contains("测试"),
        "snippet 应包含命中词，实际: {snippet}"
    );
}

#[test]
fn fts_segments_syncs_on_update() {
    let conn = setup();
    insert_segment(&conn, &sample_segment("seg-up", "initial content without keyword")).unwrap();
    // 初始不含 "报告"
    assert!(
        search_segments_fts(&conn, "报告", 10).unwrap().is_empty(),
        "初始 ocr_text 不含 报告"
    );
    // UPDATE 后触发器同步 FTS
    update_segment_ocr(&conn, "seg-up", "查看 月度 报告 数据", "done").unwrap();
    let hits = search_segments_fts(&conn, "报告", 10).unwrap();
    assert!(!hits.is_empty(), "UPDATE 触发器应同步 FTS 并命中 报告");
}

#[test]
fn episode_json_arrays_roundtrip() {
    let conn = setup();
    let ep = sample_episode("ep-1", "讨论 退款 流程 并 测试 边界 case");
    insert_episode(&conn, &ep).unwrap();

    let fetched = get_episodes_by_date(&conn, "2026-06-26").unwrap();
    assert_eq!(fetched.len(), 1);
    let e = &fetched[0];
    assert_eq!(e.id, "ep-1");
    assert_eq!(e.entities, vec!["张三".to_string(), "需求A".to_string()]);
    assert_eq!(e.topics, vec!["退款".to_string()]);
    assert_eq!(e.segment_ids, vec!["seg-1".to_string()]);
    assert_eq!(e.evidence_refs, vec!["shot-1".to_string()]);
    assert!(e.wiki_eligible);
    assert_eq!(e.wiki_status, "eligible");
    assert!((e.confidence - 0.9).abs() < 1e-9);
}

#[test]
fn episode_update_and_wiki_status_and_eligible_query() {
    let conn = setup();
    insert_episode(&conn, &sample_episode("ep-2", "summary text")).unwrap();
    update_episode_title_summary(&conn, "ep-2", "新标题", "新摘要").unwrap();
    update_episode_wiki_status(&conn, "ep-2", "saved").unwrap();

    let e = get_episode_by_id(&conn, "ep-2").unwrap().unwrap();
    assert_eq!(e.title, "新标题");
    assert_eq!(e.summary, "新摘要");
    assert_eq!(e.wiki_status, "saved");

    // wiki_eligible=1 且 wiki_status 现为 "saved"，不再属于 eligible
    let eligible = get_eligible_episodes_for_wiki(&conn).unwrap();
    assert!(eligible.iter().all(|x| x.wiki_status == "eligible"));
}

#[test]
fn memory_cell_with_foresight_roundtrip() {
    let conn = setup();
    insert_episode(&conn, &sample_episode("ep-3", "summary")).unwrap();
    let mc = MemoryCell {
        id: "mc-1".to_string(),
        clean_episode_id: "ep-3".to_string(),
        episode_text: "用户推进了退款字段确认".to_string(),
        facts: vec!["退款需要财务审批".to_string()],
        foresight: vec![Foresight {
            statement: "下周需对齐财务".to_string(),
            valid_from: "2026-06-27".to_string(),
            valid_to: "2026-07-03".to_string(),
            confidence: 0.8,
        }],
        created_at: "2026-06-26T11:01:00Z".to_string(),
    };
    insert_memory_cell(&conn, &mc).unwrap();

    let cells = get_memory_cells_by_episode(&conn, "ep-3").unwrap();
    assert_eq!(cells.len(), 1);
    assert_eq!(cells[0].facts, vec!["退款需要财务审批".to_string()]);
    assert_eq!(cells[0].foresight.len(), 1);
    assert_eq!(cells[0].foresight[0].statement, "下周需对齐财务");
    assert!((cells[0].foresight[0].confidence - 0.8).abs() < 1e-9);
}

#[test]
fn embedding_blob_roundtrip() {
    let conn = setup();
    insert_episode(&conn, &sample_episode("ep-4", "summary")).unwrap();
    let mc = MemoryCell {
        id: "mc-2".to_string(),
        clean_episode_id: "ep-4".to_string(),
        episode_text: "text".to_string(),
        facts: vec![],
        foresight: vec![],
        created_at: "2026-06-26T11:01:00Z".to_string(),
    };
    insert_memory_cell(&conn, &mc).unwrap();

    let emb = Embedding {
        id: "emb-1".to_string(),
        memory_cell_id: "mc-2".to_string(),
        embedding: vec![0u8, 1, 2, 3, 255, 128],
        model_version: "text-embedding-3-small".to_string(),
        created_at: "2026-06-26T11:02:00Z".to_string(),
    };
    insert_embedding(&conn, &emb).unwrap();

    let got = get_embedding_by_cell(&conn, "mc-2").unwrap().unwrap();
    assert_eq!(got.embedding, vec![0u8, 1, 2, 3, 255, 128]);
    assert_eq!(got.model_version, "text-embedding-3-small");

    let all = get_all_embeddings(&conn).unwrap();
    assert_eq!(all.len(), 1);
}

#[test]
fn distill_run_upsert_is_idempotent() {
    let conn = setup();
    let run = DistillRun {
        id: "run-1".to_string(),
        date: "2026-06-26".to_string(),
        hour_bucket: "10:00".to_string(),
        status: "pending".to_string(),
        segment_count: 5,
        error_message: String::new(),
        model_name: "gpt-4o-mini".to_string(),
        created_at: "2026-06-26T10:00:00Z".to_string(),
        updated_at: "2026-06-26T10:00:00Z".to_string(),
    };
    upsert_distill_run(&conn, &run).unwrap();
    // 相同 (date, hour_bucket) 不同 id 与状态 —— 应 upsert 而非插入新行
    let run2 = DistillRun {
        id: "run-1-new".to_string(),
        status: "done".to_string(),
        segment_count: 6,
        ..run.clone()
    };
    upsert_distill_run(&conn, &run2).unwrap();

    let got = get_distill_run(&conn, "2026-06-26", "10:00").unwrap().unwrap();
    assert_eq!(got.status, "done");
    assert_eq!(got.segment_count, 6);

    // pending 桶查询
    let pending = get_pending_distill_hours(&conn, "2026-06-26").unwrap();
    assert!(pending.is_empty(), "已 done 的小时桶不应出现在 pending 列表");
}

#[test]
fn wiki_page_crud_and_backlinks_and_fts() {
    let conn = setup();
    let page = WikiPage {
        id: "wiki-1".to_string(),
        title: "订单系统".to_string(),
        content: "退款 流程 说明 文档".to_string(),
        source_type: "ai".to_string(),
        source_episode_id: None,
        status: "published".to_string(),
        tags: vec!["订单".to_string(), "退款".to_string()],
        created_at: "2026-06-26T12:00:00Z".to_string(),
        updated_at: "2026-06-26T12:00:00Z".to_string(),
    };
    insert_wiki_page(&conn, &page).unwrap();

    let got = get_wiki_page(&conn, "wiki-1").unwrap().unwrap();
    assert_eq!(got.title, "订单系统");
    assert_eq!(got.tags, vec!["订单".to_string(), "退款".to_string()]);

    let by_title = get_wiki_page_by_title(&conn, "订单系统").unwrap().unwrap();
    assert_eq!(by_title.id, "wiki-1");

    // 反向链接：另一页面 content 含 [[订单系统]]
    let linker = WikiPage {
        id: "wiki-2".to_string(),
        title: "财务对账".to_string(),
        content: "参见 [[订单系统]] 了解退款".to_string(),
        source_type: "manual".to_string(),
        source_episode_id: None,
        status: "published".to_string(),
        tags: vec![],
        created_at: "2026-06-26T12:30:00Z".to_string(),
        updated_at: "2026-06-26T12:30:00Z".to_string(),
    };
    insert_wiki_page(&conn, &linker).unwrap();
    let backlinks = search_wiki_backlinks(&conn, "订单系统").unwrap();
    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].id, "wiki-2");

    // FTS5 wiki 检索
    let hits = search_wiki_fts(&conn, "退款", 10).unwrap();
    assert!(!hits.is_empty(), "wiki FTS 应命中 退款");

    // 更新
    let mut updated = got.clone();
    updated.content = "更新后的 退款 说明".to_string();
    updated.status = "archived".to_string();
    update_wiki_page(&conn, &updated).unwrap();
    let after = get_wiki_page(&conn, "wiki-1").unwrap().unwrap();
    assert_eq!(after.status, "archived");
    assert_eq!(after.content, "更新后的 退款 说明");

    let list = get_wiki_pages(&conn, 10).unwrap();
    assert_eq!(list.len(), 2);
}

#[test]
fn reports_crud() {
    let conn = setup();
    let report = WorkReport {
        id: "rep-1".to_string(),
        date: "2026-06-26".to_string(),
        report_type: "daily".to_string(),
        template: "enhanced".to_string(),
        title: "今日工作日报".to_string(),
        content: "# 日报\n- 推进退款字段".to_string(),
        status: "published".to_string(),
        model_name: "gpt-4o-mini".to_string(),
        created_at: "2026-06-26T20:00:00Z".to_string(),
        updated_at: "2026-06-26T20:00:00Z".to_string(),
    };
    insert_report(&conn, &report).unwrap();
    let by_date = get_reports_by_date(&conn, "2026-06-26").unwrap();
    assert_eq!(by_date.len(), 1);
    let by_id = get_report_by_id(&conn, "rep-1").unwrap().unwrap();
    assert_eq!(by_id.title, "今日工作日报");
}

#[test]
fn privacy_rules_defaults_loaded() {
    let conn = setup();
    let rules = get_active_privacy_rules(&conn).unwrap();
    let patterns: Vec<&str> = rules.iter().map(|r| r.pattern.as_str()).collect();
    assert!(patterns.contains(&"chrome-extension://"));
    assert!(patterns.contains(&"*银行*"));
    assert!(patterns.contains(&"WeChat"));
    assert!(rules.iter().all(|r| r.enabled));

    // 插入新规则
    let rule = PrivacyRule {
        id: "privacy-custom".to_string(),
        rule_type: "keyword".to_string(),
        pattern: "*密码*".to_string(),
        enabled: true,
        created_at: "2026-06-26T00:00:00Z".to_string(),
    };
    insert_privacy_rule(&conn, &rule).unwrap();
    let after = get_active_privacy_rules(&conn).unwrap();
    assert_eq!(after.len(), 4);
}

#[test]
fn settings_default_and_update() {
    let conn = setup();
    let s = get_settings(&conn).unwrap();
    assert_eq!(s.retention_days, 30);
    assert_eq!(s.openai_base_url, "https://api.openai.com/v1");
    assert_eq!(s.openai_model, "gpt-4o-mini");
    assert!(!s.embedding_enabled);
    assert!(!s.save_screenshots);
    assert!((s.mascot_opacity - 1.0).abs() < 1e-9);
    assert_eq!(s.mascot_active_frequency, "normal");
    assert!(!s.onboarding_completed);
    assert_eq!(s.mascot_id, 1);

    let mut s2 = s.clone();
    s2.onboarding_completed = true;
    s2.retention_days = 60;
    s2.mascot_id = 3;
    update_settings(&conn, &s2).unwrap();
    let s3 = get_settings(&conn).unwrap();
    assert!(s3.onboarding_completed);
    assert_eq!(s3.retention_days, 60);
    assert_eq!(s3.mascot_id, 3);
}

#[test]
fn search_memories_merges_segment_and_episode() {
    let conn = setup();
    // segment 含独立 token "测试"
    insert_segment(&conn, &sample_segment("seg-s", "WorkMemory 测试 任务")).unwrap();
    // episode summary 含独立 token "测试"
    insert_episode(&conn, &sample_episode("ep-s", "讨论 退款 流程 并 测试 边界")).unwrap();

    let results = search_memories(&conn, "测试", None).unwrap();
    assert!(results.len() >= 2, "至少应命中 segment 与 episode 各一条");
    let types: Vec<&str> = results.iter().map(|r| r.source_type.as_str()).collect();
    assert!(types.contains(&"segment"), "结果应包含 segment 命中");
    assert!(types.contains(&"episode"), "结果应包含 episode 命中");

    // match_reason 校验
    for r in &results {
        match r.source_type.as_str() {
            "segment" => assert_eq!(r.match_reason, "OCR命中"),
            "episode" => assert_eq!(r.match_reason, "语义命中"),
            "wiki" => assert_eq!(r.match_reason, "Wiki关联"),
            _ => panic!("未知 source_type: {}", r.source_type),
        }
    }
}

#[test]
fn search_memories_date_range_filters_segment() {
    let conn = setup();
    insert_segment(&conn, &sample_segment("seg-d", "WorkMemory 测试 任务")).unwrap();

    // 日期范围命中
    let in_range = search_memories(&conn, "测试", Some(("2026-06-01".into(), "2026-06-30".into()))).unwrap();
    assert!(in_range.iter().any(|r| r.source_type == "segment"));

    // 日期范围不命中
    let out_range = search_memories(&conn, "测试", Some(("2026-01-01".into(), "2026-01-31".into()))).unwrap();
    assert!(out_range.iter().all(|r| r.source_type != "segment"));
}

#[test]
fn migrations_are_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    migrations::run(&conn).unwrap();
    // 再次执行不应报错（所有语句 IF NOT EXISTS / INSERT OR IGNORE）
    migrations::run(&conn).unwrap();
    let rules = get_active_privacy_rules(&conn).unwrap();
    assert_eq!(rules.len(), 3, "重复迁移不应产生重复默认隐私规则");
}
