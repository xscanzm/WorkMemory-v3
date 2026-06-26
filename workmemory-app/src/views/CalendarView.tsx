/**
 * 日历视图 (CalendarView) - P1 历史反查与时间审计
 * 严格遵循 04_UI_SPEC.md §3.3 月历热力图规范。
 *
 * - 顶部：月份切换（‹ 2026年6月 ›）+ "今天"按钮
 * - 7×6 月历网格（CSS Grid 7 列）：日期数字 / 工作强度渐变微条 / 一句话总结缩写 / 日报✔徽章
 * - 右侧本页内嵌 Context 面板：点击网格静默刷新为当天 Summary + 前 3 条 Episode 简版 + 导出日报
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Check, FileText } from 'lucide-react';
import { api } from '@/src-tauri/api';
import { useAppStore } from '@/store/useAppStore';
import type { CalendarDay, CleanEpisode } from '@/types';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** YYYY-MM-DD */
function toDateStr(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

function todayStr(): string {
  const d = new Date();
  return toDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface GridCell {
  dateStr: string;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
  data?: CalendarDay;
}

/** 构建 6×7 = 42 格月历 */
function buildGrid(year: number, month: number, dayMap: Map<string, CalendarDay>): GridCell[] {
  const today = todayStr();
  const firstOfMonth = new Date(year, month - 1, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=日
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: GridCell[] = [];

  for (let i = 0; i < 42; i++) {
    const dayNumber = i - startWeekday + 1;
    if (dayNumber >= 1 && dayNumber <= daysInMonth) {
      const dateStr = toDateStr(year, month, dayNumber);
      cells.push({
        dateStr,
        dayNumber,
        inMonth: true,
        isToday: dateStr === today,
        data: dayMap.get(dateStr),
      });
    } else {
      // 溢出日：计算实际日期（上月末 / 下月初）
      const d = new Date(year, month - 1, dayNumber);
      const dateStr = toDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
      cells.push({
        dateStr,
        dayNumber: d.getDate(),
        inMonth: false,
        isToday: dateStr === today,
        data: dayMap.get(dateStr),
      });
    }
  }
  return cells;
}

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

const monthTitleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: 'var(--color-text-main)',
  minWidth: 120,
  textAlign: 'center',
};

const navBtnStyle: CSSProperties = {
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  transition: 'background var(--duration-fast) var(--ease-out-expo)',
};

const todayBtnStyle: CSSProperties = {
  marginLeft: 'var(--space-sm)',
  height: 32,
  padding: '0 12px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-primary)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  gap: 'var(--space-lg)',
  minHeight: 0,
};

const gridWrapStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-xs)',
};

const weekdayRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 6,
};

const weekdayCellStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--color-text-muted)',
  textAlign: 'center',
  padding: '4px 0',
};

const gridStyle: CSSProperties = {
  flex: 1,
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gridAutoRows: '1fr',
  gap: 6,
  minHeight: 0,
};

const cellStyle = (isToday: boolean, inMonth: boolean, selected: boolean): CSSProperties => ({
  position: 'relative',
  minHeight: 80,
  borderRadius: 'var(--radius-md)',
  border: isToday
    ? '2px solid var(--color-primary)'
    : selected
      ? '1px solid var(--color-primary)'
      : '1px solid var(--color-border)',
  background: selected ? 'var(--color-primary-soft)' : 'var(--color-surface)',
  padding: 6,
  cursor: 'pointer',
  opacity: inMonth ? 1 : 0.4,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  transition: 'background var(--duration-fast) var(--ease-out-expo)',
});

const dayNumberStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--color-text-main)',
  lineHeight: 1,
};

const summaryStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  lineHeight: 1.4,
};

const reportBadgeStyle: CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--color-text-light)',
};

const panelStyle: CSSProperties = {
  width: 300,
  flex: '0 0 300px',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  boxShadow: 'var(--shadow-card)',
  overflow: 'auto',
};

const panelHeaderStyle: CSSProperties = {
  padding: 'var(--space-lg)',
  borderBottom: '1px solid var(--color-border)',
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  letterSpacing: 0.4,
  marginBottom: 'var(--space-sm)',
};

export default function CalendarView(): JSX.Element {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [episodes, setEpisodes] = useState<CleanEpisode[]>([]);
  const [summary, setSummary] = useState('');
  const [panelLoading, setPanelLoading] = useState(false);

  const navigate = useNavigate();
  const setActiveDate = useAppStore((s) => s.setActiveDate);

  const dayMap = useMemo(() => {
    const m = new Map<string, CalendarDay>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  const maxDuration = useMemo(() => {
    return days.reduce((mx, d) => Math.max(mx, d.durationSeconds || 0), 0) || 1;
  }, [days]);

  const cells = useMemo(
    () => buildGrid(viewYear, viewMonth, dayMap),
    [viewYear, viewMonth, dayMap],
  );

  // 拉取当月数据
  const loadMonth = useCallback(async (y: number, m: number) => {
    setLoading(true);
    try {
      const res = await api.getCalendarMonth(y, m);
      setDays(res ?? []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[getCalendarMonth] 拉取失败', err);
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 拉取选中日的 Summary + Episodes
  const loadDayContext = useCallback(async (date: string) => {
    setPanelLoading(true);
    try {
      const [eps, sm] = await Promise.all([
        api.getEpisodesByDate(date),
        api.getTodaySummary(date),
      ]);
      setEpisodes(eps ?? []);
      setSummary(sm ?? '');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[loadDayContext] 拉取失败', err);
      setEpisodes([]);
      setSummary('');
    } finally {
      setPanelLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMonth(viewYear, viewMonth);
  }, [viewYear, viewMonth, loadMonth]);

  useEffect(() => {
    void loadDayContext(selectedDate);
  }, [selectedDate, loadDayContext]);

  const shiftMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  };

  const goToday = () => {
    const d = new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth() + 1);
    setSelectedDate(todayStr());
  };

  const handleCellClick = (cell: GridCell) => {
    setSelectedDate(cell.dateStr);
  };

  const handleExport = () => {
    setActiveDate(selectedDate);
    navigate('/reports', { state: { date: selectedDate } });
  };

  const selectedCell = dayMap.get(selectedDate);
  const selectedDateObj = new Date(selectedDate + 'T00:00:00');
  const selectedWeekday = Number.isNaN(selectedDateObj.getTime())
    ? ''
    : WEEKDAY_NAMES[selectedDateObj.getDay()];
  const selectedDay = selectedDate.split('-')[2];
  const selectedMon = selectedDate.split('-')[1];

  return (
    <div style={pageStyle}>
      {/* 月份切换 */}
      <header style={headerStyle}>
        <button
          type="button"
          aria-label="上一月"
          style={navBtnStyle}
          onClick={() => shiftMonth(-1)}
        >
          <ChevronLeft size={16} />
        </button>
        <div style={monthTitleStyle}>
          {viewYear}年{viewMonth}月
        </div>
        <button
          type="button"
          aria-label="下一月"
          style={navBtnStyle}
          onClick={() => shiftMonth(1)}
        >
          <ChevronRight size={16} />
        </button>
        <button type="button" style={todayBtnStyle} onClick={goToday}>
          今天
        </button>
      </header>

      <div style={bodyStyle}>
        {/* 月历网格 */}
        <div style={gridWrapStyle}>
          <div style={weekdayRowStyle}>
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} style={weekdayCellStyle}>
                {w}
              </div>
            ))}
          </div>
          <div style={gridStyle}>
            {loading
              ? Array.from({ length: 42 }).map((_, i) => (
                  <div
                    key={i}
                    className="skeleton"
                    style={{ borderRadius: 'var(--radius-md)', minHeight: 80 }}
                  />
                ))
              : cells.map((cell) => {
                  const dur = cell.data?.durationSeconds ?? 0;
                  const intensity = Math.min(1, dur / maxDuration);
                  return (
                    <div
                      key={cell.dateStr + '-' + cell.dayNumber}
                      style={cellStyle(
                        cell.isToday,
                        cell.inMonth,
                        cell.dateStr === selectedDate,
                      )}
                      onClick={() => handleCellClick(cell)}
                      onMouseEnter={(e) => {
                        if (cell.dateStr !== selectedDate) {
                          e.currentTarget.style.background =
                            'var(--color-surface-subtle)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (cell.dateStr !== selectedDate) {
                          e.currentTarget.style.background =
                            'var(--color-surface)';
                        }
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                        }}
                      >
                        <span style={dayNumberStyle}>{cell.dayNumber}</span>
                        {cell.data?.hasReport ? (
                          <span style={reportBadgeStyle} title="已生成日报">
                            <Check size={12} />
                          </span>
                        ) : null}
                      </div>
                      {intensity > 0 ? (
                        <div
                          style={{
                            height: 3,
                            width: `${Math.round(intensity * 100)}%`,
                            borderRadius: 'var(--radius-sm)',
                            background:
                              'linear-gradient(90deg, var(--color-success), var(--color-memory))',
                          }}
                        />
                      ) : null}
                      <div style={summaryStyle}>{cell.data?.summary ?? ''}</div>
                    </div>
                  );
                })}
          </div>
        </div>

        {/* 本页内嵌 Context 面板 */}
        <aside style={panelStyle} aria-label="单日上下文">
          <div style={panelHeaderStyle}>
            <div style={{ fontSize: 13, color: 'var(--color-text-light)', marginBottom: 4 }}>
              {selectedMon}月{selectedDay}日 · {selectedWeekday}
            </div>
            <div style={{ fontSize: 14, color: 'var(--color-text-main)', lineHeight: 1.6 }}>
              {panelLoading ? '加载中…' : summary || '当天暂无一句话总结。'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginTop: 8 }}>
              工作时长：
              {formatDuration(selectedCell?.durationSeconds ?? 0)}
              {selectedCell?.hasReport ? ' · 已生成日报' : ''}
            </div>
          </div>

          <div style={{ padding: 'var(--space-lg)' }}>
            <div style={sectionTitleStyle}>今日片段（前 3 条）</div>
            {panelLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="skeleton"
                    style={{ height: 56, borderRadius: 'var(--radius-sm)' }}
                  />
                ))}
              </div>
            ) : episodes.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-light)' }}>
                当天没有记录到的工作片段。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {episodes.slice(0, 3).map((ep) => (
                  <div
                    key={ep.id}
                    style={{
                      padding: 'var(--space-sm) var(--space-md)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-surface-subtle)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        alignItems: 'baseline',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--color-text-main)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {ep.title}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-light)', flexShrink: 0 }}>
                        {ep.startTime.slice(0, 5)}-{ep.endTime.slice(0, 5)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-muted)',
                        marginTop: 2,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {ep.summary}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleExport}
              style={{
                marginTop: 'var(--space-lg)',
                width: '100%',
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-primary-soft)',
                color: 'var(--color-primary)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <FileText size={14} />
              导出当日日报
            </button>
          </div>
        </aside>
      </div>
    </div>
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
