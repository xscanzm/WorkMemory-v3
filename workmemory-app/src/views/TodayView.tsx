/**
 * 今日视图 (TodayView) - 04_UI_SPEC.md §3.1
 *
 * - 顶部 SummaryBar：毛玻璃大圆角卡片，展示 todaySummary，支持内联编辑 + "用户已改写"徽标
 * - 无 AI 降级：settings 无 API Key 时显示"📊 今日活动线索统计" + Bullet 统计
 * - Episode Timeline：TimelineRail 包裹 MemoryCard 列表
 * - 加载中：3-5 个骨架卡片
 * - 空状态：MascotSprite(sleep) + 文案 + "恢复记录"按钮
 * - 初始加载 getEpisodesByDate，监听 distill-completed 重新加载
 * - 整体用 Radix ScrollArea 包裹
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { Edit3, Check, X, Sparkles } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { api, listen } from '@/src-tauri/api';
import type { AppSetting, CleanEpisode } from '@/types';
import MemoryCard from '@/components/MemoryCard';
import TimelineRail from '@/components/TimelineRail';
import MascotSprite from '@/components/mascot/MascotSprite';

/** 扩展 AppSetting，容纳 openai_api_key（KV 扩展字段） */
type AppSettingExt = AppSetting & { openai_api_key?: string };

/* ===== 时间工具 ===== */
function parseTimeToSec(t: string): number {
  const [h = 0, m = 0, s = 0] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}
function fmtHM(t: string): string {
  const [h, m] = t.split(':');
  return `${h}:${m}`;
}
function durationMinutes(start: string, end: string): number {
  return Math.max(0, Math.round((parseTimeToSec(end) - parseTimeToSec(start)) / 60));
}
function nowSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

export default function TodayView(): JSX.Element {
  const activeDate = useAppStore((s) => s.activeDate);
  const episodesFromStore = useAppStore((s) => s.episodes);
  const setEpisodes = useAppStore((s) => s.setEpisodes);
  const todaySummary = useAppStore((s) => s.todaySummary);
  const setTodaySummary = useAppStore((s) => s.setTodaySummary);
  const settings = useAppStore((s) => s.settings);
  const mascotId = useAppStore((s) => s.mascotId);

  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // 初始加载 episodes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getEpisodesByDate(activeDate)
      .then((list) => {
        if (!cancelled) setEpisodes(list ?? []);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[TodayView] getEpisodesByDate 失败', err);
        if (!cancelled) setEpisodes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDate, setEpisodes, reloadKey]);

  // 监听 distill-completed 重新加载
  useEffect(() => {
    let unlisten = () => {};
    listen('distill-completed', () => {
      setReloadKey((k) => k + 1);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten();
  }, []);

  // 初始加载 todaySummary（仅 AI 模式且 store 为空时）
  const hasApiKey = !!((settings as AppSettingExt | null)?.openai_api_key);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const loadedSummaryForDate = useRef<string>('');
  useEffect(() => {
    if (!hasApiKey) return;
    if (todaySummary) return;
    if (loadedSummaryForDate.current === activeDate) return;
    loadedSummaryForDate.current = activeDate;
    setSummaryLoading(true);
    api
      .getTodaySummary(activeDate)
      .then((s) => {
        if (typeof s === 'string') setTodaySummary(s);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[TodayView] getTodaySummary 失败', err);
      })
      .finally(() => setSummaryLoading(false));
  }, [activeDate, hasApiKey, todaySummary, setTodaySummary]);

  // 当前激活的 episode（时间覆盖"现在"）
  const activeEpisodeId = useMemo(() => {
    const now = nowSec();
    for (const ep of episodesFromStore) {
      if (parseTimeToSec(ep.startTime) <= now && now <= parseTimeToSec(ep.endTime)) {
        return ep.id;
      }
    }
    return null;
  }, [episodesFromStore]);

  const episodes = episodesFromStore;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <ScrollArea.Root style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <ScrollArea.Viewport style={{ width: '100%', height: '100%' }}>
          <div
            style={{
              padding: '4px 4px var(--space-2xl) 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-xl)',
            }}
          >
            <SummaryBar
              hasApiKey={hasApiKey}
              summary={todaySummary}
              summaryLoading={summaryLoading}
              episodes={episodes}
              date={activeDate}
              onSave={(text) => setTodaySummary(text)}
            />

            {loading ? (
              <TimelineRail>
                {[0, 1, 2, 3].map((i) => (
                  <MemoryCard
                    key={i}
                    episode={PLACEHOLDER_EPISODE}
                    isLoading
                  />
                ))}
              </TimelineRail>
            ) : episodes.length === 0 ? (
              <EmptyState mascotId={mascotId} />
            ) : (
              <TimelineRail>
                {episodes.map((ep) => (
                  <MemoryCard
                    key={ep.id}
                    episode={ep}
                    appName={ep.project}
                    isPrivate={ep.isPrivate}
                    isActive={ep.id === activeEpisodeId}
                    onToggleImportant={(id) => {
                      // P0：仅本地反馈，持久化由后端集成后接入
                      // eslint-disable-next-line no-console
                      console.debug('[toggle important]', id);
                    }}
                    onSaveToWiki={(id) => {
                      void api
                        .saveToWiki(id, '', '', [])
                        .catch((e) => console.error('[saveToWiki]', e));
                    }}
                    onEditTitle={(id, title, summary) => {
                      // P0：本地立即更新 store，后端 updateEpisodeTitleSummary 接入后替换
                      setEpisodes(
                        episodes.map((e) =>
                          e.id === id ? { ...e, title, summary } : e,
                        ),
                      );
                    }}
                  />
                ))}
              </TimelineRail>
            )}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar
          orientation="vertical"
          style={{
            width: 6,
            background: 'transparent',
            borderRadius: 3,
            padding: 2,
          }}
        >
          <ScrollArea.Thumb
            style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 3 }}
          />
        </ScrollArea.Scrollbar>
        <ScrollArea.Corner />
      </ScrollArea.Root>
    </div>
  );
}

/* ===== SummaryBar ===== */
interface SummaryBarProps {
  hasApiKey: boolean;
  summary: string;
  summaryLoading: boolean;
  episodes: CleanEpisode[];
  date: string;
  onSave: (text: string) => void;
}

function SummaryBar(props: SummaryBarProps): JSX.Element {
  const { hasApiKey, summary, summaryLoading, episodes, date, onSave } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary);
  const [rewritten, setRewritten] = useState(false);

  useEffect(() => {
    setDraft(summary);
  }, [summary]);

  const commit = () => {
    const next = draft.trim();
    onSave(next);
    setEditing(false);
    setRewritten(true);
  };
  const cancel = () => {
    setDraft(summary);
    setEditing(false);
  };

  const barStyle: React.CSSProperties = {
    background: 'var(--color-surface-glass)',
    backdropFilter: 'var(--blur-acrylic)',
    WebkitBackdropFilter: 'var(--blur-acrylic)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-lg) var(--space-xl)',
    boxShadow: 'var(--shadow-card)',
  };

  // 无 AI 降级：统计模式
  if (!hasApiKey) {
    const stats = buildFallbackStats(episodes, date);
    return (
      <section style={barStyle} aria-label="今日活动线索统计">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--color-text-main)',
            marginBottom: 'var(--space-sm)',
          }}
        >
          <span>📊 今日活动线索统计</span>
        </div>
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 13,
            color: 'var(--color-text-muted)',
            lineHeight: 1.7,
          }}
        >
          {stats.map((line, i) => (
            <li key={i} style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--color-primary)' }}>•</span>
              <span style={{ wordBreak: 'break-word' }}>{line}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  // AI 模式
  return (
    <section style={barStyle} aria-label="今日总结">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-lg)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              marginBottom: 6,
              fontSize: 12,
              color: 'var(--color-text-light)',
            }}
          >
            <Sparkles size={14} style={{ color: 'var(--color-primary)' }} />
            <span>今日一句话总结</span>
            {rewritten && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--color-primary)',
                  background: 'var(--color-primary-soft)',
                  padding: '1px 8px',
                  borderRadius: 'var(--radius-round)',
                  fontWeight: 600,
                }}
              >
                用户已改写
              </span>
            )}
          </div>

          {editing ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              style={{
                width: '100%',
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--color-primary)',
                lineHeight: 1.6,
                border: '1px solid var(--color-primary)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 10px',
                outline: 'none',
                resize: 'vertical',
                background: 'var(--color-surface)',
                fontFamily: 'inherit',
              }}
            />
          ) : (
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--color-primary)',
                lineHeight: 1.6,
                wordBreak: 'break-word',
                minHeight: 24,
              }}
            >
              {summaryLoading
                ? '正在生成今日总结…'
                : summary || '点击右侧编辑，写下你今天的重点。'}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {editing ? (
            <>
              <button type="button" onClick={commit} style={iconBtn(true)} title="保存">
                <Check size={16} />
              </button>
              <button type="button" onClick={cancel} style={iconBtn(false)} title="取消">
                <X size={16} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(summary);
                setEditing(true);
              }}
              title="编辑总结"
              aria-label="编辑总结"
              style={iconBtn(false)}
            >
              <Edit3 size={16} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function iconBtn(primary: boolean): React.CSSProperties {
  return {
    width: 30,
    height: 30,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: primary ? 'var(--color-primary)' : 'var(--color-surface)',
    color: primary ? '#FFFFFF' : 'var(--color-text-muted)',
    cursor: 'pointer',
    transition:
      'background var(--duration-fast) var(--ease-out-expo), color var(--duration-fast) var(--ease-out-expo)',
  };
}

/* ===== 无 AI 降级统计（05_INTERACTION.md §4.1 格式） ===== */
function buildFallbackStats(episodes: CleanEpisode[], date: string): string[] {
  if (episodes.length === 0) {
    return [`今日 ${date} 暂无活动记录。`];
  }
  const totalMin = episodes.reduce(
    (acc, e) => acc + durationMinutes(e.startTime, e.endTime),
    0,
  );
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;

  // 活跃时间窗：最早开始 - 最晚结束
  const starts = episodes.map((e) => parseTimeToSec(e.startTime));
  const ends = episodes.map((e) => parseTimeToSec(e.endTime));
  const earliest = Math.min(...starts);
  const latest = Math.max(...ends);
  const fmt = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // 主导应用（用时最长的 episode 的 project）
  const dominant =
    [...episodes].sort(
      (a, b) =>
        durationMinutes(b.startTime, b.endTime) -
        durationMinutes(a.startTime, a.endTime),
    )[0]?.project ?? '未知应用';

  const lines: string[] = [
    `今日电脑运行了 ${hours} 小时 ${mins} 分。活跃时间集中在 ${fmt(earliest)}-${fmt(latest)} (${dominant})。`,
    `共记录 ${episodes.length} 段工作记忆。`,
  ];
  // 取前 3 条标题作为线索
  const top = episodes.slice(0, 3);
  for (const ep of top) {
    const dur = durationMinutes(ep.startTime, ep.endTime);
    lines.push(`${fmtHM(ep.startTime)}-${fmtHM(ep.endTime)} ${ep.title}（${dur}min）`);
  }
  return lines;
}

/* ===== 空状态 ===== */
function EmptyState({ mascotId }: { mascotId: number }): JSX.Element {
  const setRecorderState = useAppStore((s) => s.setRecorderState);
  const [starting, setStarting] = useState(false);

  const handleResume = async () => {
    setStarting(true);
    try {
      await api.setRecorderState('Recording');
      setRecorderState('Recording');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[setRecorderState] 失败', err);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-2xl) var(--space-lg)',
        gap: 'var(--space-lg)',
        textAlign: 'center',
      }}
    >
      <MascotSprite mascotId={mascotId} state="sleep" scale={1.5} />
      <div
        style={{
          fontSize: 14,
          color: 'var(--color-text-muted)',
          maxWidth: 420,
          lineHeight: 1.7,
        }}
      >
        今天电脑还没有产生记忆。开始工作后，小记会在本地自动帮你整理工作线索。
      </div>
      <button
        type="button"
        onClick={handleResume}
        disabled={starting}
        style={{
          padding: '8px 20px',
          fontSize: 13,
          fontWeight: 600,
          color: '#FFFFFF',
          background: 'var(--color-primary)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          cursor: starting ? 'not-allowed' : 'pointer',
          opacity: starting ? 0.6 : 1,
          boxShadow: 'var(--shadow-card)',
          transition:
            'transform var(--duration-fast) var(--ease-out-expo), opacity var(--duration-fast) var(--ease-out-expo)',
        }}
        onMouseEnter={(e) => {
          if (!starting) e.currentTarget.style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        {starting ? '恢复中…' : '恢复记录'}
      </button>
    </div>
  );
}

/** 骨架卡片使用的占位 episode（仅 isLoading 时使用，不会展示内容） */
const PLACEHOLDER_EPISODE: CleanEpisode = {
  id: '__placeholder__',
  date: '',
  hourBucket: '',
  startTime: '00:00:00',
  endTime: '00:00:00',
  title: '',
  summary: '',
  memoryKind: 'work',
  project: '',
  entities: [],
  topics: [],
  materials: [],
  outputs: [],
  todos: [],
  blockers: [],
  segmentIds: [],
  evidenceRefs: [],
  sourceQuality: 'low',
  confidence: 0,
  wikiEligible: false,
  wikiStatus: 'none',
  isPrivate: false,
};
