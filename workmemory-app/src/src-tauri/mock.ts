/**
 * WorkMemory 前端 Mock 挡板 (07_ROADMAP.md §5)
 *
 * 在非 Tauri 环境（纯浏览器 / `vite dev`）下拦截所有 invoke 命令，返回可用的 mock 数据，
 * 让前端可以独立于 Rust 后端进行 UI 调试。
 *
 * 命令名与 `src-tauri/src/lib.rs` 注册的 Tauri command 一致（snake_case）。
 */
import type {
  AppSetting,
  CleanEpisode,
  MascotInfo,
  SearchResult,
  WikiPage,
  WorkReport,
} from '@/types';

/** 今日 YYYY-MM-DD */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DEFAULT_SETTINGS: AppSetting = {
  saveScreenshots: true,
  retentionDays: 30,
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  embeddingEnabled: true,
  mascotOpacity: 0.9,
  mascotActiveFrequency: 'normal',
  onboardingCompleted: false,
};

const MOCK_EPISODES: CleanEpisode[] = [
  {
    id: 'ep-2026-06-26-001',
    date: todayStr(),
    hourBucket: '10:00',
    startTime: '10:00:00',
    endTime: '11:20:00',
    title: '推进订单退款字段确认',
    summary:
      '与前端同事一起核对订单系统的退款状态枚举值，确认了 `RefundState` 的 6 个取值与数据库落库字段一致，修复了 OrderService 中误用 `refunded` 而非 `refund_completed` 的拼写。',
    memoryKind: 'work',
    project: '订单系统',
    entities: ['OrderService', 'RefundState', 'OrderController'],
    topics: ['退款流程', '接口联调', '枚举值'],
    materials: ['订单系统接口文档.md', '退款状态机.png'],
    outputs: ['RefundState 枚举定义', 'OrderService 单元测试'],
    todos: ['补充退款回调的幂等校验', '更新订单系统 API 文档'],
    blockers: ['测试环境数据库需重置退款示例数据'],
    segmentIds: ['seg-001', 'seg-002', 'seg-003'],
    evidenceRefs: ['seg-001', 'seg-002', 'seg-003'],
    sourceQuality: 'high',
    confidence: 0.92,
    wikiEligible: true,
    wikiStatus: 'eligible',
    isPrivate: false,
  },
  {
    id: 'ep-2026-06-26-002',
    date: todayStr(),
    hourBucket: '13:00',
    startTime: '13:00:00',
    endTime: '14:30:00',
    title: '测试验证与 Debug',
    summary:
      '联调过程中发现退款回调偶发丢失，通过抓包定位到 HTTP 5xx 后未触发重试，编写了 RetryMiddleware 单测并复现问题，定位为连接池配置 timeout 过短。',
    memoryKind: 'work',
    project: '订单系统',
    entities: ['RetryMiddleware', 'HttpClient', '连接池'],
    topics: ['调试', '单元测试', '网络请求'],
    materials: ['抓包日志.har', 'RetryMiddleware.ts'],
    outputs: ['连接池 timeout 配置补丁', '回归测试用例'],
    todos: ['提交 PR 评审', '补充压测脚本'],
    blockers: [],
    segmentIds: ['seg-004', 'seg-005'],
    evidenceRefs: ['seg-004', 'seg-005'],
    sourceQuality: 'high',
    confidence: 0.88,
    wikiEligible: false,
    wikiStatus: 'none',
    isPrivate: false,
  },
  {
    id: 'ep-2026-06-26-003',
    date: todayStr(),
    hourBucket: '15:00',
    startTime: '15:00:00',
    endTime: '16:00:00',
    title: '撰写日报素材',
    summary:
      '整理今日工作要点：退款字段确认、RetryMiddleware 修复、API 文档更新；为周报整理本周交付清单与下周计划初稿。',
    memoryKind: 'work',
    project: '个人效率',
    entities: ['日报', '周报'],
    topics: ['日报', '周报', '复盘'],
    materials: ['本周交付清单.md'],
    outputs: ['今日工作日报草稿'],
    todos: ['明早与 Leader 同步周报'],
    blockers: [],
    segmentIds: ['seg-006'],
    evidenceRefs: ['seg-006'],
    sourceQuality: 'medium',
    confidence: 0.8,
    wikiEligible: false,
    wikiStatus: 'none',
    isPrivate: false,
  },
];

const MOCK_SEARCH_RESULTS: SearchResult[] = [
  {
    sourceId: 'ep-2026-06-26-001',
    sourceType: 'episode',
    date: todayStr(),
    timeRange: '10:00-11:20',
    primaryText: '推进订单退款字段确认',
    snippet: '与前端同事一起核对订单系统的==退款==状态枚举值，确认了 RefundState 的 6 个取值……',
    score: 0.94,
    matchReason: '语义命中',
  },
  {
    sourceId: 'ep-2026-06-26-002',
    sourceType: 'episode',
    date: todayStr(),
    timeRange: '13:00-14:30',
    primaryText: '测试验证与 Debug',
    snippet: '联调过程中发现==退款==回调偶发丢失，通过抓包定位到 HTTP 5xx……',
    score: 0.87,
    matchReason: 'OCR命中',
  },
  {
    sourceId: 'wiki-refund-flow',
    sourceType: 'wiki',
    date: '2026-06-20',
    timeRange: '',
    primaryText: '订单退款流程',
    snippet: '订单系统退款流程：用户发起 → 审核 → ==退款==执行 → 回调确认……',
    score: 0.81,
    matchReason: 'Wiki关联',
  },
  {
    sourceId: 'seg-001',
    sourceType: 'segment',
    date: todayStr(),
    timeRange: '10:12:30-10:14:50',
    primaryText: 'OrderService.ts · VS Code',
    snippet: '…确认了==退款异常==枚举 RefundState 的取值，与数据库字段 refund_status 对齐…',
    score: 0.79,
    matchReason: 'OCR命中',
  },
  {
    sourceId: 'seg-004',
    sourceType: 'segment',
    date: todayStr(),
    timeRange: '13:22:10-13:24:00',
    primaryText: 'RetryMiddleware.ts · VS Code',
    snippet: '…退款回调 5xx 后未触发重试，==退款异常==被吞掉，需补幂等校验…',
    score: 0.72,
    matchReason: 'OCR命中',
  },
];

const MOCK_REPORT: WorkReport = {
  id: 'rpt-2026-06-26-001',
  date: todayStr(),
  reportType: 'daily',
  template: 'enhanced',
  title: '今日工作日报 - 2026-06-26',
  content: `# 今日工作日报 - 2026-06-26

## 一、今日交付
- 订单系统：完成退款状态枚举 RefundState 的 6 个取值与数据库字段确认（10:00-11:20）
- 订单系统：定位并修复 RetryMiddleware 退款回调丢失问题，根因为连接池 timeout 过短（13:00-14:30）
- 个人效率：整理今日工作要点，撰写日报与周报素材（15:00-16:00）

## 二、明日计划
- 与 Leader 同步本周周报
- 补充退款回调的幂等校验单测
- 更新订单系统 API 文档

## 三、阻塞项
- 测试环境数据库需重置退款示例数据
`,
  status: 'draft',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const MOCK_WIKI_PAGE: WikiPage = {
  id: 'wiki-' + Date.now(),
  title: '',
  content: '',
  sourceType: 'ai',
  status: 'draft',
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// 富化 Wiki mock：含 [[双链]]，便于演示自动补全 / 跳转 / Backlinks
const MOCK_WIKI_PAGES: WikiPage[] = [
  {
    id: 'wiki-refund-flow',
    title: '订单退款流程',
    content:
      '# 订单退款流程\n\n用户发起退款 → 审核 → 退款执行 → 回调确认。\n\n详见 [[退款接口说明]]。\n\n> 退款回调需做幂等校验。\n\n- 用户发起退款\n- 审核\n- 执行退款\n- 回调确认',
    sourceType: 'ai',
    sourceEpisodeId: 'ep-2026-06-26-001',
    status: 'published',
    tags: ['订单', '退款'],
    createdAt: '2026-06-20T10:00:00Z',
    updatedAt: '2026-06-21T09:30:00Z',
  },
  {
    id: 'wiki-refund-api',
    title: '退款接口说明',
    content:
      '# 退款接口说明\n\n`POST /api/orders/:id/refund`\n\n**请求参数**：orderId、amount、reason。\n\n状态枚举 `RefundState` 共 6 个取值。\n\n关联流程见 [[订单退款流程]]。',
    sourceType: 'manual',
    status: 'draft',
    tags: ['接口', '退款'],
    createdAt: '2026-06-22T14:00:00Z',
    updatedAt: '2026-06-22T14:00:00Z',
  },
  {
    id: 'wiki-retry-mw',
    title: 'RetryMiddleware 调试',
    content:
      '# RetryMiddleware 调试\n\n退款回调丢失根因：连接池 timeout 过短。\n\n参见 [[订单退款流程]] 与 [[退款接口说明]]。',
    sourceType: 'ai',
    status: 'published',
    tags: ['调试', '中间件'],
    createdAt: '2026-06-23T16:00:00Z',
    updatedAt: '2026-06-23T16:00:00Z',
  },
];

const MOCK_MASCOT_LIST: MascotInfo[] = [
  { id: 1, displayName: 'Boba', description: 'A tiny bubble tea cup mascot.' },
  { id: 2, displayName: 'Pixel Cat', description: 'A retro pixel-art cat.' },
  { id: 3, displayName: 'Robot', description: 'A friendly desktop robot.' },
  { id: 4, displayName: 'Ghost', description: 'A floating translucent ghost.' },
  { id: 5, displayName: 'Slime', description: 'A bouncy green slime.' },
  { id: 6, displayName: 'Wizard', description: 'A tiny wizard companion.' },
  { id: 7, displayName: 'Fox', description: 'A curious little fox.' },
  { id: 8, displayName: 'Panda', description: 'A sleepy panda buddy.' },
  { id: 9, displayName: 'Star', description: 'A twinkling star friend.' },
];

/** Mock 成就列表（Task 23.1） */
const MOCK_ACHIEVEMENTS = [
  { code: 'first_task', title: '初出茅庐', description: '完成第一个任务', icon: '🌱', unlocked: true, unlockedAt: '2026-06-26T10:00:00+08:00', progress: 1 },
  { code: 'streak_7', title: '一周坚持', description: '连续 7 天完成任务', icon: '🔥', unlocked: false, unlockedAt: null, progress: 0.43 },
  { code: 'pet_level_5', title: '宠物达人', description: '宠物升至 5 级', icon: '🐾', unlocked: false, unlockedAt: null, progress: 0.2 },
  { code: 'focus_10', title: '专注新手', description: '完成 10 次专注会话', icon: '🎯', unlocked: false, unlockedAt: null, progress: 0.3 },
  { code: 'tasks_50', title: '效率专家', description: '累计完成 50 个任务', icon: '⚡', unlocked: false, unlockedAt: null, progress: 0.12 },
  { code: 'night_owl', title: '夜猫子', description: '在 23:00-04:00 完成任务或专注', icon: '🦉', unlocked: false, unlockedAt: null, progress: 0 },
  { code: 'early_bird', title: '早起鸟', description: '在 05:00-08:00 完成任务或专注', icon: '🐦', unlocked: false, unlockedAt: null, progress: 0 },
  { code: 'all_rounded', title: '全面发展', description: '解锁以上全部成就', icon: '🏆', unlocked: false, unlockedAt: null, progress: 0.14 },
];

/**
 * 模拟 invoke：根据命令名返回对应的 mock 数据。
 * 所有命令返回 Promise，模拟 IPC 异步行为。
 */
export const invokeMock = async (command: string, args?: any): Promise<any> => {
  // 模拟 IPC 网络延迟，让 isLoading 状态可见
  await new Promise((r) => setTimeout(r, 60));

  switch (command) {
    case 'get_recorder_state':
      return 'Recording';

    case 'set_recorder_state':
      // 接收 { state }，模拟成功
      return null;

    case 'get_today_summary':
      return '今日重点在于确认订单系统退款状态枚举值，完成了与前端的接口联调。';

    case 'get_episodes_by_date':
      // 接收 { date }，返回当日 episodes（mock 始终返回今日 3 条）
      return MOCK_EPISODES;

    case 'get_settings':
      return { ...DEFAULT_SETTINGS };

    case 'update_settings':
      return null;

    case 'get_mascot_id':
      return 1;

    case 'set_mascot_id':
      return null;

    case 'list_mascots':
      return MOCK_MASCOT_LIST;

    case 'search_memories':
      // 接收 { query, dateRange }
      return MOCK_SEARCH_RESULTS;

    case 'generate_report':
      // 接收 { date, template }
      return { ...MOCK_REPORT, title: `今日工作日报 - ${args?.date ?? todayStr()}` };

    case 'save_to_wiki':
      // 接收 { episodeId, title, content, tags }
      return {
        ...MOCK_WIKI_PAGE,
        title: args?.title ?? '未命名',
        content: args?.content ?? '',
        tags: args?.tags ?? [],
        sourceEpisodeId: args?.episodeId,
      };

    case 'get_calendar_month': {
      // 接收 { year, month }，返回当月有数据的日子
      const y = args?.year ?? new Date().getFullYear();
      const m = args?.month ?? new Date().getMonth() + 1;
      const pad = (n: number) => String(n).padStart(2, '0');
      const now = new Date();
      const isCur = y === now.getFullYear() && m === now.getMonth() + 1;
      const base = [
        { d: 3, dur: 9000, sum: '需求评审与方案设计', rpt: true },
        { d: 8, dur: 7200, sum: '接口联调与 Bug 修复', rpt: true },
        { d: 12, dur: 5400, sum: '文档整理与 Wiki 沉淀', rpt: false },
        { d: 15, dur: 15400, sum: '退款流程重构', rpt: false },
        { d: 19, dur: 10800, sum: '会议沟通与排期', rpt: false },
        { d: 22, dur: 6800, sum: '性能优化与压测', rpt: false },
        { d: 26, dur: 14400, sum: '订单系统退款联调', rpt: false },
      ];
      const days = base.map((s) => ({
        date: `${y}-${pad(m)}-${pad(s.d)}`,
        hasData: true,
        durationSeconds: s.dur,
        summary: s.sum,
        hasReport: s.rpt,
      }));
      if (isCur) {
        days.push({
          date: `${y}-${pad(m)}-${pad(now.getDate())}`,
          hasData: true,
          durationSeconds: 14400,
          summary: '订单系统退款联调',
          hasReport: false,
        });
      }
      return days;
    }

    case 'get_insights': {
      const ts = new Date().toISOString();
      return [
        {
          id: 'ins-time-dist',
          type: 'time_distribution',
          title: '今日时间分布',
          description: '按应用聚合的累计工作时长（不含空闲与隐私时段）。',
          severity: 'info',
          createdAt: ts,
          metadata: {
            apps: [
              { app: 'VS Code', seconds: 5400 },
              { app: 'Chrome', seconds: 3600 },
              { app: '飞书', seconds: 2160 },
              { app: 'Terminal', seconds: 1440 },
              { app: 'Notion', seconds: 900 },
            ],
          },
        },
        {
          id: 'ins-deep-focus',
          type: 'deep_focus',
          title: '深度专注统计',
          description: '今日深度专注 3 次，累计 145 分钟，状态很棒！',
          severity: 'info',
          createdAt: ts,
          metadata: { count: 3, minutes: 145 },
        },
        {
          id: 'ins-frag',
          type: 'fragmented_switch',
          title: '信息流较为细碎',
          description:
            '刚刚的信息流有些碎，需要我帮你把这些临时沟通片段合并成一条“日常事务整理”吗？',
          severity: 'warning',
          createdAt: ts,
        },
        {
          id: 'ins-disturb',
          type: 'time_disturb',
          title: '时间扰动提醒',
          description:
            '14:30 前后出现多次即时消息打断，可在深度时段开启免打扰以减少切换。',
          severity: 'info',
          createdAt: ts,
        },
        {
          id: 'ins-open-todo',
          type: 'open_todo',
          title: '未完成线索',
          description: '以下事项尚未闭环，可择机跟进。',
          severity: 'info',
          createdAt: ts,
          metadata: {
            episodes: [
              {
                title: '推进订单退款字段确认',
                todos: ['补充退款回调的幂等校验', '更新订单系统 API 文档'],
              },
              { title: '测试验证与 Debug', todos: ['提交 PR 评审', '补充压测脚本'] },
            ],
          },
        },
      ];
    }

    case 'get_graph_data':
      return {
        nodes: [
          { id: 'ep-001', label: '推进订单退款字段确认', type: 'episode', color: '' },
          { id: 'ep-002', label: '测试验证与 Debug', type: 'episode', color: '' },
          { id: 'proj-order', label: '订单系统', type: 'project', color: '' },
          { id: 'person-zhang', label: '前端同事', type: 'person', color: '' },
          { id: 'time-today', label: '2026-06-26', type: 'time', color: '' },
          { id: 'wiki-refund', label: '订单退款流程', type: 'document', color: '' },
        ],
        edges: [
          { source: 'ep-001', target: 'proj-order', label: '属于' },
          { source: 'ep-001', target: 'person-zhang', label: '涉及' },
          { source: 'ep-001', target: 'time-today', label: '发生在' },
          { source: 'ep-002', target: 'proj-order', label: '属于' },
          { source: 'ep-002', target: 'time-today', label: '发生在' },
          { source: 'wiki-refund', target: 'ep-001', label: '来源' },
        ],
      };

    case 'get_episode_by_id': {
      const id = args?.id as string;
      const found = MOCK_EPISODES.find((e) => e.id === id);
      return found ?? null;
    }

    case 'update_episode_title_summary':
      // 接收 { id, title, summary }，mock 直接成功
      return null;

    case 'get_wiki_pages':
      return MOCK_WIKI_PAGES;

    case 'get_wiki_page':
      // 接收 { id }，返回匹配的 Wiki 页面；不存在返回 null
      return MOCK_WIKI_PAGES.find((p) => p.id === args?.id) ?? null;

    case 'get_review_queue':
      // wikiEligible 且 wikiStatus='eligible' 的 Episode
      return MOCK_EPISODES.filter(
        (e) => e.wikiEligible && e.wikiStatus === 'eligible',
      );

    case 'trigger_manual_capture':
      // Ghost Capture：返回 OCR 纯文本（与后端 Result<String, String> 对齐）
      return '识别到一段文字内容（mock）';

    // ===== Task 24: 数据导入/导出 + 用户偏好 + 音景 =====
    case 'export_data_json': {
      const bundle = {
        schema_version: 1,
        exported_at: new Date().toISOString(),
        tables: {
          tasks: [],
          pet_state: [],
          daily_stats: [],
          focus_sessions: [],
          achievements: [],
          soundscape_packs: [],
          pet_interaction_logs: [],
          user_preferences: [],
        },
      };
      return JSON.stringify(bundle, null, 2);
    }

    case 'export_tasks_csv':
      return 'id,title,description,status,priority,due_date,mood_tag,recurrence_rule,is_pinned,sort_order,subtasks,category,tags,created_at,updated_at\n';

    case 'import_data_json':
      // 接收 { jsonStr }，mock 返回空摘要
      return { imported: {}, total: 0 };

    case 'clear_all_data':
      return null;

    case 'get_preference':
      // 接收 { key }，mock 从 localStorage 读取（与前端 set_preference 路径一致）
      return typeof localStorage !== 'undefined'
        ? localStorage.getItem(`workmemory.pref.${args?.key}`)
        : null;

    case 'set_preference': {
      // 接收 { key, value }，mock 写入 localStorage（与前端 get_preference 路径一致）
      if (typeof localStorage !== 'undefined' && args?.key) {
        localStorage.setItem(`workmemory.pref.${args?.key}`, String(args?.value));
      }
      return null;
    }

    case 'get_all_soundscape_packs':
      return [];

    case 'toggle_soundscape_pack':
      // 接收 { id, enabled }，mock 直接成功
      return null;

    case 'get_all_achievements':
    case 'recalculate_achievements':
      return MOCK_ACHIEVEMENTS;

    case 'unlock_achievement':
      return MOCK_ACHIEVEMENTS.find((a) => a.code === args?.code) ?? MOCK_ACHIEVEMENTS[0];

    default:
      // 未知命令返回 null，避免阻塞 UI
      // eslint-disable-next-line no-console
      console.warn(`[invokeMock] 未实现的命令: ${command}`, args);
      return null;
  }
};
