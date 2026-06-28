/**
 * WorkMemory 前端统一 TypeScript 接口定义
 * 严格遵循 02_DATA_MODEL.md §4 (前端 TypeScript 声明) 与
 * 03_CORE_ARCHITECTURE.md §3.3 (SearchResult DTO)。
 * 字段统一 camelCase，前后端命名保持一致。
 */

/** 原始像素/应用捕获的物理片段，代表某一个具体应用窗口活动 (segments 表) */
export interface WorkSegment {
  id: string;
  date: string;                       // YYYY-MM-DD
  startTime: string;                  // HH:MM:SS
  endTime: string;                    // HH:MM:SS
  durationSeconds: number;
  appName: string;
  processName: string;
  windowTitle: string;
  ocrText: string;
  ocrStatus: 'pending' | 'done' | 'failed' | 'skipped';
  imageHash: string;
  screenshotPath: string;
  isImportant: boolean;
  isPrivate: boolean;
  captureSource: 'auto' | 'manual';
  browserUrl?: string;
  activityType?: 'coding' | 'browsing' | 'communication' | 'writing' | 'reading' | 'idle';
}

/** 聚合后的逻辑事件，由 AI/聚类算法将连续同主题 segments 合并而成 (clean_episodes 表) */
export interface CleanEpisode {
  id: string;
  date: string;
  hourBucket: string;                 // HH:00
  startTime: string;
  endTime: string;
  title: string;
  summary: string;
  memoryKind: 'work' | 'life' | 'study' | 'social' | 'play' | 'rest';
  project: string;
  entities: string[];
  topics: string[];
  materials: string[];
  outputs: string[];
  todos: string[];
  blockers: string[];
  segmentIds: string[];
  evidenceRefs: string[];
  sourceQuality: 'high' | 'medium' | 'low';
  confidence: number;                 // 0.0 - 1.0
  wikiEligible: boolean;
  wikiStatus: 'none' | 'eligible' | 'saved';
  isPrivate: boolean;
}

/** 蒸馏出的结构化记忆单元，Episode 的灵魂，用于向量化和双链图谱 (memory_cells 表) */
export interface MemoryCell {
  id: string;
  cleanEpisodeId: string;
  episodeText: string;
  facts: string[];
  foresight: Array<{
    statement: string;
    validFrom: string;
    validTo: string;
    confidence: number;
  }>;
}

/** 长期沉淀的双链知识页面 (wiki_pages 表) */
export interface WikiPage {
  id: string;
  title: string;
  content: string;
  sourceType: 'ai' | 'manual';
  sourceEpisodeId?: string;
  status: 'draft' | 'published' | 'archived';
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** 用户生成的工作报告：日报/周报/项目进展 (reports 表) */
export interface WorkReport {
  id: string;
  date: string;
  reportType: 'daily' | 'weekly' | 'project';
  template: 'enhanced' | 'concise' | 'okr' | 'structured';
  title: string;
  content: string;
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
}

/** 隐私过滤规则：敏感词 / 应用黑名单 / URL 过滤 (privacy_rules 表) */
export interface PrivacyRule {
  id: string;
  ruleType: 'app' | 'url' | 'keyword';
  pattern: string;
  enabled: boolean;
}

/** 系统全局配置 (settings 表 KV) */
export interface AppSetting {
  saveScreenshots: boolean;
  retentionDays: number;
  openaiBaseUrl: string;
  openaiModel: string;
  embeddingEnabled: boolean;
  mascotOpacity: number;
  mascotActiveFrequency: 'high' | 'normal' | 'low' | 'off';
  onboardingCompleted: boolean;
}

/** 混合检索结果 DTO (03_CORE_ARCHITECTURE.md §3.3) */
export interface SearchResult {
  sourceId: string;
  sourceType: string;                 // "segment" | "episode" | "wiki"
  date: string;
  timeRange: string;
  primaryText: string;                // 标题或窗口名
  snippet: string;                    // FTS5 highlight() 提取的片段
  score: number;                      // 向量相关度或 FTS5 Rank
  matchReason: string;                // "OCR命中" | "语义命中" | "Wiki关联"
}

/* ====================================================================
 * 补充类型：状态机 / 桌面伙伴 / 日历 / 图谱 / 洞察
 * ==================================================================== */

/** 录制状态机 (与 IPC get_recorder_state 返回值一致) */
export type RecorderState = 'Recording' | 'Paused' | 'PrivacyMode' | 'Idle';

/** 桌面伙伴 Spritesheet 动画状态名 (04_UI_SPEC.md §5.3 行映射) */
export type MascotStateName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sleep'
  | 'sit'
  | 'jump'
  | 'fall'
  | 'drag'
  | 'special';

/** AI 洞察项 */
export interface Insight {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'danger';
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/** 日历单日聚合 */
export interface CalendarDay {
  date: string;
  hasData: boolean;
  durationSeconds: number;
  summary: string;
  hasReport: boolean;
}

/** 知识图谱节点 */
export interface GraphNode {
  id: string;
  label: string;
  type: string;
  color: string;
}

/** 知识图谱边 */
export interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

/** 桌面伙伴形象元信息 (04_UI_SPEC.md §5.1 资产清单) */
export interface MascotInfo {
  id: number;
  displayName: string;
  description: string;
}

/** 关系图谱数据聚合 (nodes + edges) */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** 标签聚合信息 (Task 15 - 标签管理面板) */
export interface TagInfo {
  name: string;
  count: number;
  last_used_at: string;
  color: string | null;
}
