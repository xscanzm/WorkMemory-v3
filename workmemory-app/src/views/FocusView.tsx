/**
 * 专注视图 (FocusView) - Task 12/13
 *
 * - 模式：番茄钟（25/50 分钟可选）/ 自由计时（自定义分钟数，正向计时）
 * - 大圆环 SVG 进度（番茄钟显示剩余比例，自由计时无固定上限仅显示 elapsed）
 * - 计时显示 MM:SS（番茄钟倒计、自由计时正计）
 * - 控制：开始 / 暂停 / 继续 / 完成 / 中断（中断弹小输入框填写原因）
 * - 任务关联：可选下拉选择 useTaskStore 中的任务（绑定 taskId）
 * - 今日会话列表：挂载与每次完成后刷新 get_today_focus_sessions
 *
 * 状态机：useFocusStore.startTimer/tick/pauseTimer/resumeTimer/stopTimer/interrupt/reset
 * tick 由本组件的 setInterval 在 status === 'running' 时驱动。
 * 后端会话 id 在开始时 invoke('start_focus_session') 拿到后存入 ref，
 * 完成/中断时带上 actualDuration 调用对应命令。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { invoke } from '@/src-tauri/api';
import { useFocusStore } from '@/store/focusStore';
import { useTaskStore } from '@/store/taskStore';
import { toast } from '@/store/toastStore';
import SoundscapeMixer from '@/components/SoundscapeMixer';

/** 专注会话 DTO（与后端 models.rs::FocusSession 对齐，camelCase） */
interface FocusSession {
  id: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number;
  type: string; // 'pomodoro' | 'free'
  taskId: string | null;
  interrupted: boolean;
  interruptionReason: string;
  createdAt: string;
}

type Mode = 'pomodoro' | 'free';

/** 番茄钟可选时长（分钟） */
const POMODORO_OPTIONS = [25, 50];
/** 自由计时默认分钟数 */
const FREE_DEFAULT_MINUTES = 15;
/** 自由计时上限（分钟），避免输入过大 */
const FREE_MAX_MINUTES = 240;

/** 秒数 → MM:SS */
function formatMMSS(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** ISO 时间字符串 → HH:MM（用于会话列表展示） */
function formatHHMM(iso: string): string {
  // chrono 输出的 RFC3339 形如 2026-06-27T10:30:45.123+08:00，截取时分
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : iso;
}

/** 秒数 → 中文可读时长（如 25 分钟 / 1 小时 5 分钟） */
function formatDurationCN(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} 小时` : `${h} 小时 ${rest} 分钟`;
}

/* ===== SVG 进度环常量 ===== */
const RING_SIZE = 220;
const RING_RADIUS = 96;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ≈ 603.19

/* ===== 样式 ===== */
const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-lg)',
  height: '100%',
  minHeight: 0,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-md)',
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--color-text-main)',
  margin: 0,
};

const modeRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--space-sm)',
};

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  gap: 'var(--space-xl)',
  alignItems: 'flex-start',
  flexShrink: 0,
};

const ringWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--space-md)',
};

const controlsPanelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-md)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-lg)',
};

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-xs)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-muted)',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  color: 'var(--color-text-main)',
  background: 'var(--color-surface-subtle)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
  boxSizing: 'border-box',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  color: 'var(--color-text-main)',
  background: 'var(--color-surface-subtle)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
  boxSizing: 'border-box',
};

const controlsRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-sm)',
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--color-on-primary)',
    background: disabled ? 'var(--color-border)' : 'var(--color-primary)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function ghostBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 500,
    color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-main)',
    background: 'var(--color-surface-subtle)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function dangerBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--color-on-primary)',
    background: disabled ? 'var(--color-border)' : 'var(--color-danger)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--color-on-primary)' : 'var(--color-text-muted)',
    background: active ? 'var(--color-primary)' : 'var(--color-surface)',
    border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
  };
}

const listSectionStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-md)',
  overflow: 'auto',
};

const listCardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'var(--space-md) var(--space-lg)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
};

const listEmptyStyle: React.CSSProperties = {
  padding: 'var(--space-2xl) var(--space-lg)',
  textAlign: 'center',
  color: 'var(--color-text-muted)',
  fontSize: 13,
};

const soundscapeSectionStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-sm)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-md) var(--space-lg)',
};

const soundscapeToggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-sm)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  color: 'var(--color-text-main)',
  fontSize: 14,
  fontWeight: 600,
};

const soundscapeBodyStyle: React.CSSProperties = {
  paddingTop: 'var(--space-sm)',
  borderTop: '1px solid var(--color-border)',
};

const badgeBase: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 'var(--radius-md)',
};

export default function FocusView(): JSX.Element {
  const status = useFocusStore((s) => s.status);
  const elapsedSeconds = useFocusStore((s) => s.elapsedSeconds);
  const durationSeconds = useFocusStore((s) => s.durationSeconds);
  const storeMode = useFocusStore((s) => s.mode);
  const startTimer = useFocusStore((s) => s.startTimer);
  const tick = useFocusStore((s) => s.tick);
  const pauseTimer = useFocusStore((s) => s.pauseTimer);
  const resumeTimer = useFocusStore((s) => s.resumeTimer);
  const stopTimer = useFocusStore((s) => s.stopTimer);
  const interruptStore = useFocusStore((s) => s.interrupt);
  const reset = useFocusStore((s) => s.reset);

  const tasks = useTaskStore((s) => s.tasks);
  const loadTasks = useTaskStore((s) => s.loadTasks);

  // 配置态：模式 + 番茄时长 + 自由分钟 + 任务绑定
  const [mode, setMode] = useState<Mode>('pomodoro');
  const [pomoMinutes, setPomoMinutes] = useState<number>(POMODORO_OPTIONS[0]);
  const [freeMinutes, setFreeMinutes] = useState<number>(FREE_DEFAULT_MINUTES);
  const [taskId, setTaskId] = useState<string>('');

  // 运行态：后端 sessionId + 是否已记录完成（防止 auto-complete 与手动完成重复 invoke）
  const sessionIdRef = useRef<string | null>(null);
  const recordedRef = useRef<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  // 中断原因输入
  const [interruptOpen, setInterruptOpen] = useState<boolean>(false);
  const [reason, setReason] = useState<string>('');

  // 今日会话
  const [sessions, setSessions] = useState<FocusSession[]>([]);

  // 音景面板折叠态（默认折叠，避免抢占专注主体注意力）
  const [soundscapeOpen, setSoundscapeOpen] = useState<boolean>(false);

  // 挂载时加载任务与今日会话
  useEffect(() => {
    void loadTasks();
    void refreshSessions();
  }, [loadTasks]);

  /** 拉取今日专注会话列表 */
  async function refreshSessions(): Promise<void> {
    try {
      const list = await invoke<FocusSession[]>('get_today_focus_sessions');
      setSessions(list);
    } catch (err) {
      console.error('[FocusView] 拉取今日会话失败', err);
      // 不打扰用户：静默失败
    }
  }

  /** setInterval 驱动 tick：仅在 running 时推进 */
  useEffect(() => {
    if (status !== 'running') return;
    const id = window.setInterval(() => {
      tick();
    }, 1000);
    return () => window.clearInterval(id);
  }, [status, tick]);

  /**
   * 监听 status → 'completed'：番茄钟到点自动完成 或 用户点完成。
   * 用 recordedRef 防止对同一 sessionId 重复调用后端 complete。
   */
  useEffect(() => {
    if (status !== 'completed') return;
    const sid = sessionIdRef.current;
    if (sid === null || recordedRef.current) return;
    void handleCompleteBackend(sid, elapsedSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  /** 计划时长（秒）：番茄钟用 pomoMinutes，自由计时用 0（表示无上限正向计时） */
  const plannedSeconds = useMemo(() => {
    if (mode === 'pomodoro') return pomoMinutes * 60;
    return 0; // free 模式 store 不自动完成
  }, [mode, pomoMinutes]);

  /** 显示秒数：番茄钟倒计、自由计时正计 */
  const displaySeconds = mode === 'pomodoro' && durationSeconds > 0
    ? Math.max(0, durationSeconds - elapsedSeconds)
    : elapsedSeconds;

  /** 进度环比例 [0,1]：番茄钟按 elapsed/duration，自由计时恒 0（无固定上限） */
  const progress = mode === 'pomodoro' && durationSeconds > 0
    ? Math.min(1, elapsedSeconds / durationSeconds)
    : 0;
  const ringOffset = RING_CIRCUMFERENCE * (1 - progress);

  /** 开始：先 invoke 后端落库拿到 sessionId，再启动本地计时 */
  async function handleStart(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const sessionType = mode; // 'pomodoro' | 'free'
      const sid = await invoke<FocusSession>('start_focus_session', {
        sessionType,
        taskId: taskId || null,
        plannedDuration: plannedSeconds,
      }).then((s) => s.id);
      sessionIdRef.current = sid;
      recordedRef.current = false;
      // 自由计时传 durationSeconds=0（store 不会自动完成）
      startTimer(mode, plannedSeconds, taskId || undefined);
    } catch (err) {
      console.error('[FocusView] 开始专注失败', err);
      toast.error('开始专注失败');
    } finally {
      setBusy(false);
    }
  }

  /** 后端完成：调用 complete_focus_session，刷新列表与本地状态 */
  async function handleCompleteBackend(sid: string, actualDuration: number): Promise<void> {
    recordedRef.current = true;
    setBusy(true);
    try {
      await invoke('complete_focus_session', {
        sessionId: sid,
        actualDuration,
      });
      toast.success('专注完成，已记录');
      await refreshSessions();
    } catch (err) {
      console.error('[FocusView] 完成专注失败', err);
      // 宠物未初始化时后端用 let _ = 忽略；若仍失败多为 DB 错误，提示用户
      toast.error('保存专注会话失败');
    } finally {
      setBusy(false);
      sessionIdRef.current = null;
      reset();
    }
  }

  /** 手动完成按钮：触发 store.stopTimer() → status='completed' → useEffect 处理后端 */
  function handleCompleteClick(): void {
    if (sessionIdRef.current === null) return;
    stopTimer();
  }

  /** 中断：提交原因，调用后端 interrupt，刷新列表 */
  async function handleInterruptSubmit(): Promise<void> {
    const sid = sessionIdRef.current;
    const r = reason.trim();
    if (sid === null) return;
    if (!r) {
      toast.info('请填写中断原因');
      return;
    }
    setBusy(true);
    try {
      await invoke('interrupt_focus_session', {
        sessionId: sid,
        actualDuration: elapsedSeconds,
        reason: r,
      });
      interruptStore(r);
      recordedRef.current = true;
      toast.info('专注已中断');
      setInterruptOpen(false);
      setReason('');
      await refreshSessions();
    } catch (err) {
      console.error('[FocusView] 中断专注失败', err);
      toast.error('中断专注失败');
    } finally {
      setBusy(false);
      sessionIdRef.current = null;
      reset();
    }
  }

  /** 取消中断输入：关闭输入框，不改变运行态 */
  function handleInterruptCancel(): void {
    setInterruptOpen(false);
    setReason('');
  }

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isIdle = status === 'idle';
  const inProgress = isRunning || isPaused;

  return (
    <div style={pageStyle}>
      {/* 头部：标题 + 模式切换 */}
      <header style={headerStyle}>
        <h1 style={titleStyle}>专注</h1>
        <div style={modeRowStyle}>
          <button
            type="button"
            aria-label="选择番茄钟模式"
            style={chipStyle(mode === 'pomodoro')}
            disabled={inProgress}
            onClick={() => setMode('pomodoro')}
          >
            番茄钟
          </button>
          <button
            type="button"
            aria-label="选择自由计时模式"
            style={chipStyle(mode === 'free')}
            disabled={inProgress}
            onClick={() => setMode('free')}
          >
            自由计时
          </button>
          {mode === 'pomodoro' && (
            <>
              <span style={{ ...labelStyle, marginLeft: 'var(--space-sm)' }}>时长</span>
              {POMODORO_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-label={`设置番茄钟时长为 ${m} 分钟`}
                  style={chipStyle(pomoMinutes === m)}
                  disabled={inProgress}
                  onClick={() => setPomoMinutes(m)}
                >
                  {m} 分钟
                </button>
              ))}
            </>
          )}
        </div>
      </header>

      {/* 主体：圆环 + 控制 + 任务选择 */}
      <div style={bodyStyle}>
        <div style={ringWrapStyle}>
          <svg width={RING_SIZE} height={RING_SIZE} viewBox="0 0 220 220" aria-hidden="true">
            {/* 背景圆 */}
            <circle
              cx={110}
              cy={110}
              r={RING_RADIUS}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={10}
            />
            {/* 进度圆（顺时针，从 12 点起） */}
            <circle
              cx={110}
              cy={110}
              r={RING_RADIUS}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={ringOffset}
              transform="rotate(-90 110 110)"
              style={{ transition: 'stroke-dashoffset 0.3s linear' }}
            />
            {/* 中心文字 */}
            <text
              x={110}
              y={110}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={36}
              fontWeight={700}
              fill="var(--color-text-main)"
            >
              {formatMMSS(displaySeconds)}
            </text>
            <text
              x={110}
              y={150}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={11}
              fill="var(--color-text-muted)"
            >
              {mode === 'pomodoro' ? '番茄钟' : '自由计时'}
              {storeMode ? ` · ${Math.floor(elapsedSeconds / 60)} 分钟已过` : ''}
            </text>
          </svg>
        </div>

        <div style={controlsPanelStyle}>
          {/* 任务关联 */}
          <div style={fieldRowStyle}>
            <label htmlFor="focus-task-select" style={labelStyle}>
              关联任务（可选）
            </label>
            <select
              id="focus-task-select"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              disabled={inProgress}
              style={selectStyle}
            >
              <option value="">不关联</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title || '(未命名任务)'}
                </option>
              ))}
            </select>
          </div>

          {/* 自由计时分钟输入 */}
          {mode === 'free' && (
            <div style={fieldRowStyle}>
              <label htmlFor="focus-free-minutes" style={labelStyle}>
                目标分钟数（仅作参考，正向计时）
              </label>
              <input
                id="focus-free-minutes"
                type="number"
                min={1}
                max={FREE_MAX_MINUTES}
                value={freeMinutes}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0 && v <= FREE_MAX_MINUTES) {
                    setFreeMinutes(Math.floor(v));
                  }
                }}
                disabled={inProgress}
                style={inputStyle}
              />
            </div>
          )}

          {/* 中断原因输入框（条件渲染） */}
          {interruptOpen && inProgress && (
            <div style={fieldRowStyle}>
              <label htmlFor="focus-interrupt-reason" style={labelStyle}>
                中断原因
              </label>
              <input
                id="focus-interrupt-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例如：电话打断 / 临时会议"
                style={inputStyle}
                autoFocus
              />
              <div style={controlsRowStyle}>
                <button
                  type="button"
                  aria-label="确认中断专注"
                  style={dangerBtnStyle(busy)}
                  disabled={busy}
                  onClick={() => void handleInterruptSubmit()}
                >
                  确认中断
                </button>
                <button
                  type="button"
                  aria-label="取消中断"
                  style={ghostBtnStyle(false)}
                  onClick={handleInterruptCancel}
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* 控制按钮组：按状态决定可见性 */}
          <div style={controlsRowStyle}>
            {isIdle && (
              <button
                type="button"
                aria-label="开始专注"
                style={primaryBtnStyle(busy)}
                disabled={busy}
                onClick={() => void handleStart()}
              >
                开始
              </button>
            )}
            {isRunning && (
              <button
                type="button"
                aria-label="暂停专注计时"
                style={ghostBtnStyle(false)}
                onClick={pauseTimer}
              >
                暂停
              </button>
            )}
            {isPaused && (
              <button
                type="button"
                aria-label="继续专注计时"
                style={primaryBtnStyle(false)}
                onClick={resumeTimer}
              >
                继续
              </button>
            )}
            {inProgress && (
              <>
                <button
                  type="button"
                  aria-label="完成专注会话"
                  style={primaryBtnStyle(busy)}
                  disabled={busy}
                  onClick={handleCompleteClick}
                >
                  完成
                </button>
                <button
                  type="button"
                  aria-label="中断专注会话"
                  style={dangerBtnStyle(false)}
                  disabled={interruptOpen}
                  onClick={() => setInterruptOpen(true)}
                >
                  中断
                </button>
              </>
            )}
          </div>

          {/* 状态提示 */}
          {!isIdle && !inProgress && (
            <div style={{ ...labelStyle, color: 'var(--color-text-muted)' }}>
              会话已结束
            </div>
          )}
        </div>
      </div>

      {/* 今日会话列表 */}
      <section style={listSectionStyle}>
        <div style={{ ...titleStyle, fontSize: 14 }}>今日会话</div>
        {sessions.length === 0 ? (
          <div style={listEmptyStyle}>今天还没有专注会话，点击「开始」进入专注</div>
        ) : (
          sessions.map((s) => (
            <div key={s.id} style={listCardStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 13, color: 'var(--color-text-main)', fontWeight: 600 }}>
                  {formatHHMM(s.startTime)}
                  <span style={{ marginLeft: 'var(--space-sm)', color: 'var(--color-text-muted)' }}>
                    {formatDurationCN(s.durationSeconds)}
                  </span>
                </div>
                {s.interrupted && s.interruptionReason && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    中断原因：{s.interruptionReason}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                <span
                  style={{
                    ...badgeBase,
                    background: s.type === 'pomodoro' ? 'var(--color-primary-soft)' : 'var(--color-surface-subtle)',
                    color: s.type === 'pomodoro' ? 'var(--color-primary)' : 'var(--color-text-main)',
                  }}
                >
                  {s.type === 'pomodoro' ? '番茄钟' : '自由'}
                </span>
                {s.interrupted ? (
                  <span
                    style={{
                      ...badgeBase,
                      background: 'var(--color-warning)',
                      color: 'var(--color-on-primary)',
                    }}
                  >
                    已中断
                  </span>
                ) : (
                  <span
                    style={{
                      ...badgeBase,
                      background: 'var(--color-success-soft)',
                      color: 'var(--color-success)',
                    }}
                  >
                    已完成
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      {/* 音景混音器（折叠态默认收起，展开后渲染 SoundscapeMixer） */}
      <section style={soundscapeSectionStyle}>
        <button
          type="button"
          aria-label={soundscapeOpen ? '收起音景面板' : '展开音景面板'}
          aria-expanded={soundscapeOpen}
          style={soundscapeToggleStyle}
          onClick={() => setSoundscapeOpen((v) => !v)}
        >
          <span>音景</span>
          {soundscapeOpen ? (
            <ChevronUp size={16} aria-hidden="true" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" />
          )}
        </button>
        {soundscapeOpen && (
          <div style={soundscapeBodyStyle}>
            <SoundscapeMixer />
          </div>
        )}
      </section>
    </div>
  );
}
