/**
 * 连续打卡日历热力图 (StreakCalendar) - Task 16.1
 *
 * - 展示最近 14 天的任务完成热力图，7 列网格（每行一周）
 * - 数据来源：invoke('get_weekly_stats')（最近 7 天 daily_stats）
 * - 颜色强度按 tasksCompleted：0=浅灰 / 1-2=0.3 / 3-4=0.6 / 5+=1.0
 * - 每个格子带 aria-label（日期 + 完成数）满足 WCAG 2.1 AA
 * - 后端未就绪或无数据时降级为空网格占位
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { invoke } from '@/src-tauri/api';

/** 与后端 DailyStats (camelCase) 对齐 */
interface DailyStats {
  date: string;
  tasksCompleted: number;
  totalFocusTime: number;
  streakCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 颜色强度档位：根据完成任务数选择 opacity */
function intensityOpacity(tasks: number): { bg: string; opacity: number } {
  if (tasks <= 0) return { bg: 'var(--color-surface-subtle)', opacity: 1 };
  if (tasks <= 2) return { bg: 'var(--color-primary)', opacity: 0.3 };
  if (tasks <= 4) return { bg: 'var(--color-primary)', opacity: 0.6 };
  return { bg: 'var(--color-primary)', opacity: 1 };
}

/** 格式化日期为 MM-DD（用于格子内的次要文字） */
function formatShortDate(iso: string): string {
  if (!iso || iso.length < 10) return '';
  return iso.slice(5, 10); // YYYY-MM-DD → MM-DD
}

/** 生成最近 n 天的日期字符串数组（YYYY-MM-DD），按时间正序（旧 → 新） */
function lastNDates(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

const wrapperStyle: CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-lg) var(--space-xl)',
  boxShadow: 'var(--shadow-card)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  marginBottom: 'var(--space-md)',
};

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--color-text-main)',
};

const legendStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-xs)',
  fontSize: 11,
  color: 'var(--color-text-muted)',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 'var(--space-xs)',
};

const weekdayRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 'var(--space-xs)',
  marginBottom: 'var(--space-xs)',
};

const weekdayCellStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--color-text-light)',
  textAlign: 'center',
  height: 14,
};

const errorStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-muted)',
  padding: 'var(--space-md) 0',
  textAlign: 'center',
};

export default function StreakCalendar(): JSX.Element {
  const [stats, setStats] = useState<DailyStats[]>([]);
  const [hasError, setHasError] = useState(false);

  /** 拉取最近 7 天 daily_stats（周报数据源） */
  const loadWeeklyStats = async (): Promise<void> => {
    try {
      const data = await invoke<DailyStats[]>('get_weekly_stats');
      setStats(Array.isArray(data) ? data : []);
      setHasError(false);
    } catch (err) {
      // 后端未就绪或调用失败时静默降级为空网格
      console.error('[StreakCalendar] get_weekly_stats 失败', err);
      setStats([]);
      setHasError(true);
    }
  };

  useEffect(() => {
    void loadWeeklyStats();
  }, []);

  // 构建 date → tasksCompleted 映射，便于 O(1) 查询
  const statsMap = new Map<string, number>();
  for (const s of stats) {
    statsMap.set(s.date, s.tasksCompleted);
  }

  // 最近 14 天日期（按旧→新顺序，便于从左到右渲染）
  const dates = lastNDates(14);

  return (
    <section aria-label="连续打卡日历" style={wrapperStyle}>
      <div style={headerStyle}>
        <span style={titleStyle}>📅 本周打卡</span>
        <div style={legendStyle} aria-hidden>
          <span>少</span>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: 'var(--color-surface-subtle)',
              border: '1px solid var(--color-border)',
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: 'var(--color-primary)',
              opacity: 0.3,
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: 'var(--color-primary)',
              opacity: 0.6,
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: 'var(--color-primary)',
              opacity: 1,
            }}
          />
          <span>多</span>
        </div>
      </div>

      {/* 周一至周日表头（与 lastNDates 14 天对齐：14 天 = 2 整周） */}
      <div style={weekdayRowStyle} aria-hidden>
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} style={weekdayCellStyle}>
            {w}
          </div>
        ))}
      </div>

      {hasError && stats.length === 0 ? (
        <div style={errorStyle}>暂无打卡数据，完成第一个任务开始记录</div>
      ) : (
        <div style={gridStyle} role="grid" aria-label="最近 14 天打卡热力图">
          {dates.map((date) => {
            const tasks = statsMap.get(date) ?? 0;
            const { bg, opacity } = intensityOpacity(tasks);
            const label = `${date}，完成 ${tasks} 个任务`;
            return (
              <div
                key={date}
                role="gridcell"
                aria-label={label}
                title={label}
                style={{
                  aspectRatio: '1 / 1',
                  minHeight: 28,
                  borderRadius: 'var(--radius-sm)',
                  background: bg,
                  opacity,
                  border: '1px solid var(--color-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  color:
                    tasks > 0
                      ? 'var(--color-on-primary)'
                      : 'var(--color-text-light)',
                  fontWeight: 600,
                  userSelect: 'none',
                }}
              >
                {formatShortDate(date)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
