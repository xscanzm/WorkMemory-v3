// WorkMemory 共享数据结构 (对应 02_DATA_MODEL.md §2 DB schema 与 §4 前端 TS 声明)
// 所有结构体 serde camelCase 序列化以对齐前端 TypeScript 接口。
// 布尔字段在 DB 中以 INTEGER 0/1 存储，结构体使用 bool，转换在 repository 层完成。

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// 原始像素或应用捕获的物理片段 (对应 segments 表)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkSegment {
    pub id: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub duration_seconds: i64,
    pub app_name: String,
    pub process_name: String,
    pub window_title: String,
    pub ocr_text: String,
    pub ocr_status: String,
    pub image_hash: String,
    pub screenshot_path: String,
    pub is_important: bool,
    pub is_private: bool,
    pub is_deleted: bool,
    pub capture_source: String,
    pub browser_url: Option<String>,
    pub activity_type: Option<String>,
    pub created_at: String,
}

/// 聚合后的逻辑事件 (对应 clean_episodes 表)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanEpisode {
    pub id: String,
    pub date: String,
    pub hour_bucket: String,
    pub start_time: String,
    pub end_time: String,
    pub title: String,
    pub summary: String,
    pub memory_kind: String,
    pub project: String,
    pub entities: Vec<String>,
    pub topics: Vec<String>,
    pub materials: Vec<String>,
    pub outputs: Vec<String>,
    pub todos: Vec<String>,
    pub blockers: Vec<String>,
    pub segment_ids: Vec<String>,
    pub evidence_refs: Vec<String>,
    pub source_quality: String,
    pub confidence: f64,
    pub wiki_eligible: bool,
    pub wiki_status: String,
    /// 是否为隐私段聚合而成（隐私窗口标题需在蒸馏时聚合为一条带标记的 episode，
    /// 前端 TodayView 据此渲染紫色斜条 + 🔒）。
    #[serde(default)]
    pub is_private: bool,
    pub model_name: String,
    pub distill_version: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 预判待办单元
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Foresight {
    pub statement: String,
    pub valid_from: String,
    pub valid_to: String,
    pub confidence: f64,
}

/// 结构化记忆单元 (对应 memory_cells 表)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCell {
    pub id: String,
    pub clean_episode_id: String,
    pub episode_text: String,
    pub facts: Vec<String>,
    pub foresight: Vec<Foresight>,
    pub created_at: String,
}

/// 语义向量记录 (对应 embeddings 表，仅后端使用)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Embedding {
    pub id: String,
    pub memory_cell_id: String,
    pub embedding: Vec<u8>,
    pub model_version: String,
    pub created_at: String,
}

/// 蒸馏运行状态 (对应 distill_runs 表，幂等保证)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistillRun {
    pub id: String,
    pub date: String,
    pub hour_bucket: String,
    pub status: String,
    pub segment_count: i64,
    pub error_message: String,
    pub model_name: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 知识 Wiki 页面 (对应 wiki_pages 表)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiPage {
    pub id: String,
    pub title: String,
    pub content: String,
    pub source_type: String,
    pub source_episode_id: Option<String>,
    pub status: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 工作报告 (对应 reports 表)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkReport {
    pub id: String,
    pub date: String,
    pub report_type: String,
    pub template: String,
    pub title: String,
    pub content: String,
    pub status: String,
    pub model_name: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 隐私过滤规则 (对应 privacy_rules 表)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyRule {
    pub id: String,
    pub rule_type: String,
    pub pattern: String,
    pub enabled: bool,
    pub created_at: String,
}

/// 系统全局配置 (对应 settings 表 key='app'，DB 存 JSON)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSetting {
    pub save_screenshots: bool,
    pub retention_days: i64,
    pub openai_base_url: String,
    pub openai_model: String,
    pub embedding_enabled: bool,
    pub mascot_opacity: f64,
    pub mascot_active_frequency: String,
    pub onboarding_completed: bool,
    pub mascot_id: i64,
    /// OpenAI API Key。独立存储于 settings 表 key='openai_api_key'，
    /// 与 app JSON 解耦（避免 Key 被序列化进 app JSON 而泄漏）。
    /// `skip` 保证它不参与 AppSetting JSON 的序列化/反序列化，
    /// 由 `repository::get_settings` 附带读取单独的 key 填充。
    #[serde(skip)]
    pub openai_api_key: Option<String>,
}

impl Default for AppSetting {
    fn default() -> Self {
        Self {
            save_screenshots: false,
            retention_days: 30,
            openai_base_url: "https://api.openai.com/v1".to_string(),
            openai_model: "gpt-4o-mini".to_string(),
            embedding_enabled: false,
            mascot_opacity: 1.0,
            mascot_active_frequency: "normal".to_string(),
            onboarding_completed: false,
            mascot_id: 1,
            openai_api_key: None,
        }
    }
}

/// 统一检索结果 DTO (对应 03_CORE_ARCHITECTURE.md §3.3)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub source_id: String,
    pub source_type: String, // "segment" | "episode" | "wiki"
    pub date: String,
    pub time_range: String,
    pub primary_text: String,
    pub snippet: String,
    pub score: f32,
    pub match_reason: String, // "OCR命中" | "语义命中" | "Wiki关联"
}

/// 录制状态机 (对应 IPC recorder-state-changed 事件)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum RecorderState {
    Recording,
    Paused,
    PrivacyMode,
    Idle,
}

/// 日历单日汇总 (对应 get_calendar_month 命令返回)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDay {
    pub date: String,
    pub has_data: bool,
    pub duration_seconds: i64,
    pub summary: String,
    pub has_report: bool,
}

/// 洞察项 (对应 get_insights 命令返回)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Insight {
    pub id: String,
    pub r#type: String,
    pub title: String,
    pub description: String,
    pub severity: String,
    /// JSON 字符串，前端解析后用于时间分布图/未完成线索等卡片的详细数据
    /// （前端 types/index.ts 已有 `metadata?: Record<string, unknown>`）。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub metadata: Option<String>,
    pub created_at: String,
}

/// 关系图谱节点 (对应 get_graph_data 命令返回)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub r#type: String,
    pub color: String,
}

/// 关系图谱边 (对应 get_graph_data 命令返回)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub label: String,
}

/// 关系图谱数据聚合 (nodes + edges)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}
