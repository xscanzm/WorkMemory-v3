/**
 * 洞察视图 (InsightsView) - 时间审计
 * 严格遵循 07_ROADMAP.md Checkpoint 2 与 05_INTERACTION.md §3 中性话术。
 *
 * - 顶部：日期选择器（默认今天）+ "刷新洞察"按钮
 * - 主体：2 列洞察卡片网格
 *   · time_distribution：按 app 聚合当日 duration 的横向条形图（纯 CSS，无图表库）
 *   · fragmented_switch（warning）：信息流细碎提醒，中性话术
 *   · open_todo（info）：列出 todos 非空的 episode 及其 todos
 *   · deep_focus（info）：深度专注统计
 *   · time_disturb（info）：时间扰动提醒
 * - 空状态：Lightbulb + "今天还没有洞察，开始工作后小记会帮你分析时间分布。"
 * 中性叙述，禁止"低效/摸鱼/浪费时间"等评判式表达。
 */
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Lightbulb, RefreshCw, Circle } from 'lucide-react';
import { api } from '@/src-tauri/api';
import { useAppStore } from '@/store/useAppStore';
import InsightCard from '@/components/InsightCard';
import type { Insight } from '@/types';

const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  gap: 'var(--space-lg)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-md)',
};

const dateInputStyle: CSSProperties = {
  height: 32,
  padding: '0 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  fontSize: 13,
  color: 'var(--color-text-main)',
  fontFamily: 'inherit',
};

const refreshBtnStyle: CSSProperties = {
  height: 32,
  padding: '0 12px',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-primary)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const gridStyle: CSSProperties = {
  flex: 1,
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-lg)',
  alignContent: 'start',
  overflow: 'auto',
};

/** 自定义卡片外壳：复用 InsightCard 视觉（左 3px 竖条 + surface + shadow） */
function CardShell({
  insight,
  children,
}: {
  insight: Insight;
  children: ReactNode;
}): JSX.Element {
  const barColor =
    insight.severity === 'warning'
      ? 'var(--color-warning)'
      : insight.severity === 'danger'
        ? 'var(--color-danger)'
        : 'var(--color-primary)';
  return (
    <article
      style={{
        position: 'relative',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-surface)',
        boxShadow: 'var(--shadow-card)',
        padding: 'var(--space-lg)',
        overflow: 'hidden',
      }}
    >
      <span
        aria-hidden
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: barColor }}
      />
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--color-text-main)',
          marginBottom: 'var(--space-md)',
        }}
      >
        {insight.title}
      </div>
      {children}
    </article>
  );
}

/** 秒 → "Xh Ym" / "Ym" */
function formatDuration(seconds: number): string {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * 解析 insight.metadata。
 * 后端 (Rust) 用 Option<String> 存 JSON，序列化后到前端是字符串；
 * Mock / 旧路径可能直接给对象。两种情况都兼容。
 */
function parseMeta(ins: Insight): Record<string, unknown> {
  if (!ins.metadata) return {};
  if (typeof ins.metadata === 'string') {
    try {
      return JSON.parse(ins.metadata) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return ins.metadata as Record<string, unknown>;
}

const centerStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-md)',
  color: 'var(--color-text-light)',
};

export default function InsightsView(): JSX.Element {
  const activeDate = useAppStore((s) => s.activeDate);
  const setActiveDate = useAppStore((s) => s.setActiveDate);

  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await api.getInsights(date);
      setInsights(res ?? []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[getInsights] 拉取失败', err);
      setInsights([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(activeDate);
  }, [activeDate, refreshKey, load]);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <input
          type="date"
          style={dateInputStyle}
          value={activeDate}
          onChange={(e) => setActiveDate(e.target.value)}
          aria-label="选择日期"
        />
        <button
          type="button"
          style={refreshBtnStyle}
          onClick={() => setRefreshKey((k) => k + 1)}
        >
          <RefreshCw size={14} />
          刷新洞察
        </button>
      </header>

      {loading ? (
        <div style={gridStyle}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 140, borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      ) : insights.length === 0 ? (
        <div style={centerStyle}>
          <Lightbulb size={40} color="var(--color-text-light)" />
          <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
            今天还没有洞察，开始工作后小记会帮你分析时间分布。
          </div>
        </div>
      ) : (
        <div style={gridStyle}>
          {insights.map((ins) => {
            if (ins.type === 'time_distribution') {
              return <TimeDistributionCard key={ins.id} insight={ins} />;
            }
            if (ins.type === 'fragmented_switch') {
              return <InsightCard key={ins.id} insight={ins} />;
            }
            if (ins.type === 'open_todo') {
              return <OpenTodoCard key={ins.id} insight={ins} />;
            }
            if (ins.type === 'deep_focus') {
              return <DeepFocusCard key={ins.id} insight={ins} />;
            }
            return <InsightCard key={ins.id} insight={ins} />;
          })}
        </div>
      )}
    </div>
  );
}

/** 时间分布横向条形图卡（纯 CSS） */
function TimeDistributionCard({ insight }: { insight: Insight }): JSX.Element {
  const meta = parseMeta(insight);
  const apps =
    (meta.apps as { app: string; seconds: number }[] | undefined) ?? [];
  const maxSeconds = apps.reduce((mx, a) => Math.max(mx, a.seconds || 0), 0) || 1;

  return (
    <CardShell insight={insight}>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }}>
        {insight.description}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {apps.map((a) => (
          <div key={a.app} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <span
              style={{
                width: 80,
                fontSize: 12,
                color: 'var(--color-text-main)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {a.app}
            </span>
            <div
              style={{
                flex: 1,
                height: 8,
                borderRadius: 'var(--radius-round)',
                background: 'var(--color-surface-subtle)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.round((a.seconds / maxSeconds) * 100)}%`,
                  height: '100%',
                  borderRadius: 'var(--radius-round)',
                  background:
                    'linear-gradient(90deg, var(--color-success), var(--color-memory))',
                }}
              />
            </div>
            <span
              style={{
                width: 56,
                textAlign: 'right',
                fontSize: 12,
                color: 'var(--color-text-muted)',
                flexShrink: 0,
              }}
            >
              {formatDuration(a.seconds)}
            </span>
          </div>
        ))}
        {apps.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-light)' }}>暂无时间分布数据。</div>
        ) : null}
      </div>
    </CardShell>
  );
}

/** 未完成线索卡：列出 todos 非空的 episode 及其 todos */
function OpenTodoCard({ insight }: { insight: Insight }): JSX.Element {
  const meta = parseMeta(insight);
  const eps =
    (meta.episodes as { title: string; todos: string[] }[] | undefined) ?? [];

  return (
    <CardShell insight={insight}>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }}>
        {insight.description}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {eps.map((ep, idx) => (
          <div key={idx}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-main)', marginBottom: 4 }}>
              {ep.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ep.todos.map((t, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}
                >
                  <Circle size={11} color="var(--color-text-light)" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {eps.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-light)' }}>暂无未完成线索。</div>
        ) : null}
      </div>
    </CardShell>
  );
}

/** 深度专注卡：标题 + 描述 + metadata.sessions 列表（app + 时长 + 开始时间） */
interface DeepFocusSession {
  app: string;
  seconds?: number;
  durationSeconds?: number;
  startTime?: string;
  start?: string;
}

function DeepFocusCard({ insight }: { insight: Insight }): JSX.Element {
  const meta = parseMeta(insight);
  const sessions = (meta.sessions as DeepFocusSession[] | undefined) ?? [];
  const totalSessions = typeof meta.count === 'number' ? meta.count : sessions.length;
  const totalMinutes = typeof meta.minutes === 'number' ? meta.minutes : null;

  return (
    <CardShell insight={insight}>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }}>
        {insight.description}
      </div>
      {(totalMinutes !== null || totalSessions > 0) && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-lg)',
            marginBottom: 'var(--space-md)',
            fontSize: 12,
            color: 'var(--color-text-light)',
          }}
        >
          {totalSessions > 0 && (
            <span>专注次数：{totalSessions}</span>
          )}
          {totalMinutes !== null && <span>累计：{formatDuration(totalMinutes * 60)}</span>}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {sessions.map((s, i) => {
          const sec = s.seconds ?? s.durationSeconds ?? 0;
          const start = s.startTime ?? s.start ?? '';
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-md)',
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-surface-subtle)',
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: 'var(--color-text-main)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.app}
              </span>
              {start && (
                <span style={{ fontSize: 12, color: 'var(--color-text-light)' }}>{start}</span>
              )}
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  flexShrink: 0,
                  minWidth: 48,
                  textAlign: 'right',
                }}
              >
                {formatDuration(sec)}
              </span>
            </div>
          );
        })}
        {sessions.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-light)' }}>暂无深度专注记录。</div>
        ) : null}
      </div>
    </CardShell>
  );
}
