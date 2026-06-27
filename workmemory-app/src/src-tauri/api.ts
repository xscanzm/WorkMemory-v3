/**
 * WorkMemory 统一 IPC 封装 (07_ROADMAP.md §5)
 *
 * - Tauri 桌面环境：通过 `@tauri-apps/api/core` 的 `invoke` 调用 Rust 后端。
 * - Web 开发环境：降级到 `./mock.ts` 的 Mock 挡板。
 *
 * 通过 `isTauri()` 在运行时判断，业务层无需感知运行环境。
 */
import type {
  AppSetting,
  CalendarDay,
  CleanEpisode,
  GraphData,
  Insight,
  MascotInfo,
  RecorderState,
  SearchResult,
  WikiPage,
  WorkReport,
} from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/toastStore';
import { invokeMock } from './mock';

/**
 * 是否运行在 Tauri 桌面环境。
 * Tauri 2.x 会在 window 上注入 `__TAURI_INTERNALS__`。
 */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * 统一 invoke：Tauri 环境调用真实后端，Web 环境调用 Mock。
 */
export async function invoke<T>(command: string, args?: object): Promise<T> {
  if (isTauri()) {
    const m = await import('@tauri-apps/api/core');
    return m.invoke<T>(command, args);
  }
  return invokeMock(command, args) as Promise<T>;
}

/**
 * 统一事件监听：Tauri 环境使用 `@tauri-apps/api/event`，Web 环境返回 noop unlisten。
 * @returns unlisten 函数，调用后取消监听
 */
export async function listen(
  event: string,
  handler: (payload: any) => void,
): Promise<() => void> {
  if (isTauri()) {
    const m = await import('@tauri-apps/api/event');
    return m.listen<any>(event, (e) => handler(e.payload));
  }
  // Web 环境无事件，返回 noop unlisten
  return () => {};
}

// ===== 具体业务 API 封装 =====

export async function getRecorderState(): Promise<RecorderState> {
  return invoke<RecorderState>('get_recorder_state');
}

/**
 * 手动快速捕捉（Ghost Capture）：返回 OCR 识别出的纯文本。
 * 对应后端 `trigger_manual_capture` IPC 命令。
 */
export async function triggerManualCapture(): Promise<string> {
  return invoke<string>('trigger_manual_capture');
}

export async function setRecorderState(state: RecorderState): Promise<void> {
  await invoke<void>('set_recorder_state', { state });
}

export async function getTodaySummary(date?: string): Promise<string> {
  return invoke<string>('get_today_summary', { date });
}

export async function getEpisodesByDate(date: string): Promise<CleanEpisode[]> {
  return invoke<CleanEpisode[]>('get_episodes_by_date', { date });
}

export async function getEpisodeById(id: string): Promise<CleanEpisode | null> {
  return invoke<CleanEpisode | null>('get_episode_by_id', { id });
}

/**
 * 用户手动编辑 Episode 标题与摘要（持久化到 clean_episodes 表）。
 * 对应后端 `update_episode_title_summary` IPC 命令。
 */
export async function updateEpisodeTitleSummary(
  id: string,
  title: string,
  summary: string,
): Promise<void> {
  await invoke<void>('update_episode_title_summary', { id, title, summary });
}

export async function searchMemories(
  query: string,
  dateRange?: { from: string; to: string },
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('search_memories', { query, dateRange });
}

export async function generateReport(
  date: string,
  template: WorkReport['template'],
): Promise<WorkReport> {
  return invoke<WorkReport>('generate_report', { date, template });
}

export async function saveToWiki(
  episodeId: string,
  title: string,
  content: string,
  tags: string[],
): Promise<WikiPage> {
  return invoke<WikiPage>('save_to_wiki', { episodeId, title, content, tags });
}

/**
 * 获取全部 Wiki 页面 (04_UI_SPEC.md §3.5)。
 */
export async function getWikiPages(): Promise<WikiPage[]> {
  return invoke<WikiPage[]>('get_wiki_pages');
}

/**
 * 获取单条 Wiki 页面，不存在返回 null。
 */
export async function getWikiPage(id: string): Promise<WikiPage | null> {
  return invoke<WikiPage | null>('get_wiki_page', { id });
}

/**
 * 获取 Review Queue：wikiEligible 且 wikiStatus='eligible' 的 Episode 列表
 * (09_PRODUCT_ACCEPTANCE_LEDGER.md 用例 7)。
 */
export async function getReviewQueue(): Promise<CleanEpisode[]> {
  return invoke<CleanEpisode[]>('get_review_queue');
}

export async function getSettings(): Promise<AppSetting> {
  return invoke<AppSetting>('get_settings');
}

export async function updateSettings(settings: AppSetting): Promise<void> {
  await invoke<void>('update_settings', { settings });
}

export async function getMascotId(): Promise<number> {
  return invoke<number>('get_mascot_id');
}

export async function setMascotId(id: number): Promise<void> {
  await invoke<void>('set_mascot_id', { id });
}

export async function listMascots(): Promise<MascotInfo[]> {
  return invoke<MascotInfo[]>('list_mascots');
}

/**
 * 初始化全局 Tauri 事件监听，更新 useAppStore。
 * 应在 App 挂载时调用一次。
 */
export async function initListeners(): Promise<void> {
  const store = useAppStore.getState();

  // 录制状态变化 → 同步到 store
  await listen('recorder-state-changed', (state: RecorderState) => {
    store.setRecorderState(state);
  });

  // 捕获到新片段 → 触发今日数据刷新（具体 UI 刷新由 Task 11 实现）
  await listen('segment-captured', () => {
    // TODO(Task 11): 增量插入到 episodes 时间线，这里先重新拉取
    void refreshTodayEpisodes();
  });

  // 蒸馏完成 → 重新拉取今日 episodes
  await listen('distill-completed', () => {
    void refreshTodayEpisodes();
  });

  // 隐私模式触发 → 切换 store 状态
  await listen('privacy-triggered', () => {
    store.setRecorderState('PrivacyMode');
  });

  // 报告就绪 → MascotWindow 单独监听以播 jump 动画，此处仅记录
  await listen('report-ready', () => {
    // 由 MascotWindow 监听同事件播 jump 一次性动画
  });
}

/** 拉取并刷新当前 activeDate 的 episodes */
async function refreshTodayEpisodes(): Promise<void> {
  const store = useAppStore.getState();
  try {
    const episodes = await getEpisodesByDate(store.activeDate);
    store.setEpisodes(episodes);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[refreshTodayEpisodes] 拉取失败', err);
    toast.error('刷新今日数据失败');
  }
}

export async function getCalendarMonth(
  year: number,
  month: number,
): Promise<CalendarDay[]> {
  return invoke<CalendarDay[]>('get_calendar_month', { year, month });
}

export async function getInsights(date: string): Promise<Insight[]> {
  return invoke<Insight[]>('get_insights', { date });
}

export async function getGraphData(): Promise<GraphData> {
  return invoke<GraphData>('get_graph_data');
}

// ===== Task 24: 数据导入/导出 + 用户偏好 + 音景管理 =====

/** 音景包 DTO（与后端 models.rs::SoundscapePack 对齐，camelCase） */
export interface SoundscapePack {
  id: string;
  name: string;
  description: string;
  layers: string[];
  enabled: boolean;
  createdAt: string;
}

/** 导入摘要：每张表成功插入的行数 + 总数 */
export interface ImportSummary {
  imported: Record<string, number>;
  total: number;
}

/** 导出全部业务表为 JSON 字符串 (Task 24.2) */
export async function exportDataJson(): Promise<string> {
  return invoke<string>('export_data_json');
}

/** 导出 tasks 表为 CSV 字符串 (Task 24.2) */
export async function exportTasksCsv(): Promise<string> {
  return invoke<string>('export_tasks_csv');
}

/** 导入 JSON 字符串到数据库，返回每表插入行数摘要 (Task 24.3) */
export async function importDataJson(jsonStr: string): Promise<ImportSummary> {
  return invoke<ImportSummary>('import_data_json', { jsonStr });
}

/** 清空全部业务数据（破坏性操作，前端需 ConfirmDialog 二次确认） */
export async function clearAllData(): Promise<void> {
  await invoke<void>('clear_all_data');
}

/** 读取用户偏好；不存在返回 null */
export async function getPreference(key: string): Promise<string | null> {
  return invoke<string | null>('get_preference', { key });
}

/** 写入（upsert）用户偏好 */
export async function setPreference(key: string, value: string): Promise<void> {
  await invoke<void>('set_preference', { key, value });
}

/** 获取所有音景包（含禁用，用于设置页管理） */
export async function getAllSoundscapePacks(): Promise<SoundscapePack[]> {
  return invoke<SoundscapePack[]>('get_all_soundscape_packs');
}

/** 启用 / 禁用指定音景包 */
export async function toggleSoundscapePack(
  id: string,
  enabled: boolean,
): Promise<void> {
  await invoke<void>('toggle_soundscape_pack', { id, enabled });
}

/**
 * 发送系统通知 (Task 24.4)
 * 仅在 Tauri 环境下调用 @tauri-apps/plugin-notification 的 sendNotification。
 * 非 Tauri 环境降级为 noop（toast 仍会显示）。
 */
export async function sendSystemNotification(
  title: string,
  body: string,
): Promise<void> {
  if (!isTauri()) return;
  try {
    const m = await import('@tauri-apps/plugin-notification');
    // 部分平台首次需要请求权限；忽略拒绝错误（toast 已覆盖通知场景）
    try {
      const granted = await m.isPermissionGranted();
      if (!granted) {
        await m.requestPermission();
      }
    } catch {
      // 权限请求失败不阻断，仍尝试发送
    }
    await m.sendNotification({ title, body });
  } catch (err) {
    // 系统通知失败不影响业务，仅记录
    // eslint-disable-next-line no-console
    console.warn('[sendSystemNotification] 失败', err);
  }
}

/**
 * 统一对外暴露的 api 对象。
 */
export const api = {
  isTauri,
  invoke,
  listen,
  initListeners,
  getRecorderState,
  triggerManualCapture,
  setRecorderState,
  getTodaySummary,
  getEpisodesByDate,
  getEpisodeById,
  updateEpisodeTitleSummary,
  searchMemories,
  generateReport,
  saveToWiki,
  getWikiPages,
  getWikiPage,
  getReviewQueue,
  getSettings,
  updateSettings,
  getMascotId,
  setMascotId,
  listMascots,
  getCalendarMonth,
  getInsights,
  getGraphData,
  // Task 24
  exportDataJson,
  exportTasksCsv,
  importDataJson,
  clearAllData,
  getPreference,
  setPreference,
  getAllSoundscapePacks,
  toggleSoundscapePack,
  sendSystemNotification,
};
