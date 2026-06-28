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
        is_private: false,
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
    let (_, snippet, _highlight, _rank) = &hits[0];
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

/// Task 2.3：跨表写事务"部分失败回滚"验证。
///
/// 模拟 `save_to_wiki` 的跨表写模式（wiki_pages INSERT + clean_episodes UPDATE）：
/// 1. 先插入一条合法 wiki_page（引用已存在的 episode）—— 成功
/// 2. 再插入一条 wiki_page，source_episode_id 指向不存在的 episode ——
///    在 `PRAGMA foreign_keys = ON` 下触发 SQLITE_CONSTRAINT_FOREIGNKEY 失败
/// 3. 事务未 commit 即 drop —— 应自动 ROLLBACK，第一条 wiki_page 也应消失
///
/// 同时验证对照路径：两条合法写入 commit 后均持久化，episode.wiki_status 被更新。
#[test]
fn cross_table_transaction_rolls_back_on_partial_failure() {
    let mut conn = setup(); // setup() 已开启 PRAGMA foreign_keys = ON
    insert_episode(&conn, &sample_episode("ep-tx", "summary")).unwrap();

    let good_page = WikiPage {
        id: "wiki-good".to_string(),
        title: "好页面".to_string(),
        content: "内容".to_string(),
        source_type: "ai".to_string(),
        source_episode_id: Some("ep-tx".to_string()),
        status: "draft".to_string(),
        tags: vec![],
        created_at: "2026-06-26T12:00:00Z".to_string(),
        updated_at: "2026-06-26T12:00:00Z".to_string(),
    };
    let bad_page = WikiPage {
        id: "wiki-bad".to_string(),
        // 引用不存在的 episode —— 外键约束失败
        source_episode_id: Some("nonexistent-episode".to_string()),
        ..good_page.clone()
    };

    // ---- 回滚路径：第二条 INSERT 失败，事务整体回滚 ----
    let tx = conn.transaction().unwrap();
    insert_wiki_page(&tx, &good_page).unwrap();
    let second_result = insert_wiki_page(&tx, &bad_page);
    assert!(
        second_result.is_err(),
        "引用不存在的 episode 应触发外键约束失败"
    );
    // 不调用 commit 直接 drop tx —— Transaction 未 commit 时 drop 自动回滚
    drop(tx);

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM wiki_pages", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        count, 0,
        "事务回滚后 wiki_pages 应为空（首条写入也应被回滚）"
    );

    // ---- 对照路径：两条合法写入 commit 后全部持久化 ----
    let tx2 = conn.transaction().unwrap();
    insert_wiki_page(&tx2, &good_page).unwrap();
    update_episode_wiki_status(&tx2, "ep-tx", "saved").unwrap();
    tx2.commit().unwrap();

    let count2: i64 = conn
        .query_row("SELECT COUNT(*) FROM wiki_pages", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count2, 1, "commit 后 wiki_pages 应有 1 条");
    let ep = get_episode_by_id(&conn, "ep-tx").unwrap().unwrap();
    assert_eq!(
        ep.wiki_status, "saved",
        "commit 后 episode.wiki_status 应更新为 saved"
    );
}

// ============================================================================
// Task 15: 标签管理（list_tags / rename_tag / merge_tags / set_tag_color）
// ============================================================================

/// 构造一条可定制的 WikiPage（仅 id / tags / updated_at 可变）。
fn sample_wiki_page(id: &str, tags: Vec<&str>, updated_at: &str) -> WikiPage {
    WikiPage {
        id: id.to_string(),
        title: format!("页面-{}", id),
        content: format!("内容-{}", id),
        source_type: "manual".to_string(),
        source_episode_id: None,
        status: "published".to_string(),
        tags: tags.into_iter().map(String::from).collect(),
        created_at: "2026-06-26T08:00:00Z".to_string(),
        updated_at: updated_at.to_string(),
    }
}

#[test]
fn list_tags_aggregates_count_and_last_used_at() {
    let conn = setup();
    // 3 个 wiki_pages，标签分布：
    //   wiki-a: ["设计", "订单"]      updated_at=2026-06-26T10:00:00Z
    //   wiki-b: ["设计", "退款"]      updated_at=2026-06-26T12:00:00Z
    //   wiki-c: ["设计"]              updated_at=2026-06-26T09:00:00Z
    insert_wiki_page(&conn, &sample_wiki_page("wiki-a", vec!["设计", "订单"], "2026-06-26T10:00:00Z")).unwrap();
    insert_wiki_page(&conn, &sample_wiki_page("wiki-b", vec!["设计", "退款"], "2026-06-26T12:00:00Z")).unwrap();
    insert_wiki_page(&conn, &sample_wiki_page("wiki-c", vec!["设计"], "2026-06-26T09:00:00Z")).unwrap();

    let tags = list_tags(&conn).unwrap();
    // 设计: count=3, 退款: count=1, 订单: count=1
    let by_name: std::collections::HashMap<String, TagInfo> = tags
        .iter()
        .map(|t| (t.name.clone(), t.clone()))
        .collect();
    assert_eq!(by_name.len(), 3);
    let design = by_name.get("设计").unwrap();
    assert_eq!(design.count, 3);
    // last_used_at 应为最新一行的 updated_at
    assert_eq!(design.last_used_at, "2026-06-26T12:00:00Z");
    assert!(design.color.is_none(), "未设置颜色时 color 应为 None");

    let order = by_name.get("订单").unwrap();
    assert_eq!(order.count, 1);
    assert_eq!(order.last_used_at, "2026-06-26T10:00:00Z");

    // 顺序：count 降序 → "设计" 在最前
    assert_eq!(tags[0].name, "设计");
    // 退款/订单 count=1，按 name 升序：退款 在 订单 之前（UTF-8 编码序）
    let tail_names: Vec<&str> = tags[1..].iter().map(|t| t.name.as_str()).collect();
    assert!(tail_names.contains(&"订单"));
    assert!(tail_names.contains(&"退款"));
}

#[test]
fn list_tags_reads_colors_from_settings() {
    let conn = setup();
    insert_wiki_page(&conn, &sample_wiki_page("wiki-x", vec!["设计"], "2026-06-26T10:00:00Z")).unwrap();
    // 预置 tag_colors JSON
    let colors_json = "{\"设计\":\"#FF5733\"}";
    conn.execute(
        "INSERT INTO settings(key, value, updated_at) VALUES ('tag_colors', ?1, datetime('now'))",
        rusqlite::params![colors_json],
    )
    .unwrap();

    let tags = list_tags(&conn).unwrap();
    let design = tags.iter().find(|t| t.name == "设计").unwrap();
    assert_eq!(design.color.as_deref(), Some("#FF5733"));
}

#[test]
fn rename_tag_updates_all_wiki_pages() {
    let mut conn = setup();
    insert_wiki_page(&conn, &sample_wiki_page("wiki-a", vec!["设计", "订单"], "2026-06-26T10:00:00Z")).unwrap();
    insert_wiki_page(&conn, &sample_wiki_page("wiki-b", vec!["设计", "退款"], "2026-06-26T12:00:00Z")).unwrap();
    insert_wiki_page(&conn, &sample_wiki_page("wiki-c", vec!["其它"], "2026-06-26T09:00:00Z")).unwrap();

    let affected = rename_tag(&mut conn, "设计", "Design").unwrap();
    // wiki-a 与 wiki-b 含 "设计" → 受影响行数 = 2
    assert_eq!(affected, 2);

    let a = get_wiki_page(&conn, "wiki-a").unwrap().unwrap();
    assert_eq!(a.tags, vec!["Design".to_string(), "订单".to_string()]);
    let b = get_wiki_page(&conn, "wiki-b").unwrap().unwrap();
    assert_eq!(b.tags, vec!["Design".to_string(), "退款".to_string()]);
    let c = get_wiki_page(&conn, "wiki-c").unwrap().unwrap();
    assert_eq!(c.tags, vec!["其它".to_string()], "未含目标标签的页面不应被修改");

    // 再次 list_tags：原 "设计" 应消失，新 "Design" 出现
    let tags = list_tags(&conn).unwrap();
    assert!(tags.iter().all(|t| t.name != "设计"));
    assert!(tags.iter().any(|t| t.name == "Design"));
}

#[test]
fn merge_tags_merges_sources_into_target() {
    let mut conn = setup();
    // wiki-a: ["设计", "订单"]      → 合并 ["订单"] → "设计"：变成 ["设计"]
    // wiki-b: ["退款", "设计"]      → 合并 ["退款"] → "设计"：变成 ["设计"]
    // wiki-c: ["退款", "其它"]      → 合并 ["退款"] → "设计"：变成 ["其它", "设计"]
    // wiki-d: ["设计"]              → 已含 target、无 source：跳过
    insert_wiki_page(&conn, &sample_wiki_page("wiki-a", vec!["设计", "订单"], "2026-06-26T10:00:00Z")).unwrap();
    insert_wiki_page(&conn, &sample_wiki_page("wiki-b", vec!["退款", "设计"], "2026-06-26T12:00:00Z")).unwrap();
    insert_wiki_page(&conn, &sample_wiki_page("wiki-c", vec!["退款", "其它"], "2026-06-26T09:00:00Z")).unwrap();
    insert_wiki_page(&conn, &sample_wiki_page("wiki-d", vec!["设计"], "2026-06-26T11:00:00Z")).unwrap();

    let affected = merge_tags(&mut conn, &["退款".to_string(), "订单".to_string()], "设计").unwrap();
    // wiki-a / wiki-b / wiki-c 受影响（wiki-d 跳过）
    assert_eq!(affected, 3);

    let a = get_wiki_page(&conn, "wiki-a").unwrap().unwrap();
    assert_eq!(a.tags, vec!["设计".to_string()]);
    let b = get_wiki_page(&conn, "wiki-b").unwrap().unwrap();
    assert_eq!(b.tags, vec!["设计".to_string()]);
    let c = get_wiki_page(&conn, "wiki-c").unwrap().unwrap();
    assert_eq!(c.tags, vec!["其它".to_string(), "设计".to_string()]);
    let d = get_wiki_page(&conn, "wiki-d").unwrap().unwrap();
    assert_eq!(d.tags, vec!["设计".to_string()]);

    // 验证源标签已被完全移除
    let tags = list_tags(&conn).unwrap();
    let names: Vec<&str> = tags.iter().map(|t| t.name.as_str()).collect();
    assert!(!names.contains(&"退款"));
    assert!(!names.contains(&"订单"));
    assert!(names.contains(&"设计"));
    assert!(names.contains(&"其它"));
}

#[test]
fn set_tag_color_roundtrip_and_clear() {
    let conn = setup();
    insert_wiki_page(&conn, &sample_wiki_page("wiki-x", vec!["设计"], "2026-06-26T10:00:00Z")).unwrap();

    // 设置颜色
    set_tag_color(&conn, "设计", "#FF5733").unwrap();
    let tags = list_tags(&conn).unwrap();
    let design = tags.iter().find(|t| t.name == "设计").unwrap();
    assert_eq!(design.color.as_deref(), Some("#FF5733"));

    // 更新颜色
    set_tag_color(&conn, "设计", "#10B981").unwrap();
    let tags = list_tags(&conn).unwrap();
    let design = tags.iter().find(|t| t.name == "设计").unwrap();
    assert_eq!(design.color.as_deref(), Some("#10B981"));

    // 清除颜色（传空字符串）
    set_tag_color(&conn, "设计", "").unwrap();
    let tags = list_tags(&conn).unwrap();
    let design = tags.iter().find(|t| t.name == "设计").unwrap();
    assert!(design.color.is_none(), "清除后 color 应为 None");
}
