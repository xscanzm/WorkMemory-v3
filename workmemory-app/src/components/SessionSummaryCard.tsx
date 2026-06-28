/**
 * 专注结束总结卡片 (audit-v4-hardening Task 18 / 04_UI_SPEC.md §3.7)
 *
 * 专注会话完成时弹出的总结模态，基于 Radix Dialog 实现：
 *   - Header：「专注结束」标题 + 关闭按钮
 *   - 核心指标卡片（4 个并排）：计划时长 / 实际专注 / 暂停次数 / 暂停总时长
 *   - 应用时长分布（横向条形图，按 duration 降序，最多 5 个）
 *   - 注意力流失点（时间轴列表，无流失点时显示鼓励文案）
 *   - 关联任务（任务标题 + 完成状态徽章）
 *   - 解锁成就（成就 ID 列表）
 *   - 底部按钮：「继续专注」（关闭并重置）+ 「查看完整洞察」（导航 /insights）
 *
 * 数据加载：useAsync hook 监听 sessionId 变化，invoke('get_session_summary')。
 */
import { useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { X, Clock, Pause, BarChart3, AlertTriangle, CheckCircle2, Trophy } from 'lucide-react';
import { invoke } from '@/src-tauri/api';
import { useAsync } from '@/hooks/useAsync';

/** 单个应用时长占比切片（与后端 models.rs::AppTimeSlice 对齐，camelCase） */
interface AppTimeSlice {
  appName: string;
  durationSeconds: number;
  percentage: number;
}

/** 注意力流失点（与后端 models.rs::AttentionLossPoint 对齐） */
interface AttentionLossPoint {
  timestamp: string;
  reason: string;
  durationSeconds: number;
}

/** 关联任务信息（与后端 models.rs::RelatedTaskInfo 对齐） */
interface RelatedTaskInfo {
  taskId: string;
  taskTitle: string;
  completed: boolean;
}

/** 专注会话总结（与后端 models.rs::SessionSummary 对齐，camelCase） */
interface SessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  plannedDurationSeconds: number;
  actualFocusSeconds: number;
  pauseCount: number;
  pauseTotalSeconds: number;
  appDistribution: AppTimeSlice[];
  attentionLossPoints: AttentionLossPoint[];
  relatedTask: RelatedTaskInfo | null;
  achievementsUnlocked: string[];
}

export interface SessionSummaryCardProps {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 秒数 → HH:MM:SS */
function formatHMS(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** ISO 时间字符串 → HH:MM */
function formatHHMM(iso: string): string {
  if (!iso) return '--:--';
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : iso;
}

/** 按应用名 hash 生成稳定的 HSL 颜色 */
function appColor(appName: string): string {
  let hash = 0;
  for (let i = 0; i < appName.length; i++) {
    hash = (hash * 31 + appName.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

const METRIC_CARDS: Array<{
  key: 'planned' | 'actual' | 'pauseCount' | 'pauseTotal';
  label: string;
  icon: React.ReactNode;
}> = [
  { key: 'planned', label: '计划时长', icon: <Clock size={14} /> },
  { key: 'actual', label: '实际专注', icon: <CheckCircle2 size={14} /> },
  { key: 'pauseCount', label: '暂停次数', icon: <Pause size={14} /> },
  { key: 'pauseTotal', label: '暂停总时长', icon: <Pause size={14} /> },
];

export default function SessionSummaryCard(
  props: SessionSummaryCardProps,
): JSX.Element | null {
  const { sessionId, open, onOpenChange } = props;
  const navigate = useNavigate();

  const fetchSummary = useCallback(async (): Promise<SessionSummary> => {
    if (!sessionId) {
      throw new Error('缺少 sessionId');
    }
    return invoke<SessionSummary>('get_session_summary', { sessionId });
  }, [sessionId]);

  const { data, loading, error } = useAsync<SessionSummary>(fetchSummary, {
    immediate: open && !!sessionId,
    deps: [sessionId, open],
  });

  const handleContinue = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleViewInsights = useCallback(() => {
    onOpenChange(false);
    navigate('/insights');
  }, [navigate, onOpenChange]);

  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="wm-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 10000,
          }}
        />
        <Dialog.Content
          className="wm-dialog-center"
          aria-label="专注结束总结"
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '90vw',
            maxWidth: 640,
            maxHeight: '80vh',
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-overlay)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 10001,
          }}
        >
          {/* ===== Header ===== */}
          <Dialog.Title asChild>
            <header
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                background: 'var(--color-surface)',
                borderBottom: '1px solid var(--color-border)',
                padding: 'var(--space-md) var(--space-lg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-sm)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <Trophy size={18} style={{ color: 'var(--color-primary)' }} />
                <span
                  data-testid="session-summary-title"
                  style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-main)' }}
                >
                  专注结束
                </span>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="关闭"
                  style={iconBtnStyle}
                >
                  <X size={18} />
                </button>
              </Dialog.Close>
            </header>
          </Dialog.Title>

          {/* ===== Body（垂直滚动） ===== */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 'var(--space-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-lg)',
            }}
          >
            {loading && (
              <div style={emptyTextStyle} data-testid="session-summary-loading">
                正在生成专注总结…
              </div>
            )}
            {error && !loading && (
              <div style={{ ...emptyTextStyle, color: 'var(--color-danger)' }}>
                加载失败：{error.message}
              </div>
            )}
            {data && !loading && (
              <>
                {/* 核心指标卡片（4 列 grid） */}
                <section aria-label="核心指标" data-testid="session-summary-metrics">
                  <SectionLabel icon={<BarChart3 size={14} />} text="核心指标" />
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: 'var(--space-sm)',
                      marginTop: 'var(--space-sm)',
                    }}
                  >
                    {METRIC_CARDS.map((card) => {
                      const value =
                        card.key === 'planned'
                          ? formatHMS(data.plannedDurationSeconds)
                          : card.key === 'actual'
                            ? formatHMS(data.actualFocusSeconds)
                            : card.key === 'pauseCount'
                              ? String(data.pauseCount)
                              : formatHMS(data.pauseTotalSeconds);
                      return (
                        <div
                          key={card.key}
                          data-testid={`metric-${card.key}`}
                          style={metricCardStyle}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11,
                              color: 'var(--color-text-muted)',
                            }}
                          >
                            {card.icon}
                            {card.label}
                          </div>
                          <div
                            style={{
                              fontSize: 18,
                              fontWeight: 700,
                              color: 'var(--color-text-main)',
                              marginTop: 4,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {value}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* 应用时长分布（横向条形图） */}
                <section aria-label="应用时长分布" data-testid="session-summary-apps">
                  <SectionLabel icon={<BarChart3 size={14} />} text="应用时长分布" />
                  {data.appDistribution.length === 0 ? (
                    <div style={{ ...emptyTextStyle, marginTop: 'var(--space-sm)' }}>
                      本次专注未记录到应用活动
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-sm)',
                        marginTop: 'var(--space-sm)',
                      }}
                    >
                      {data.appDistribution.map((slice) => (
                        <div
                          key={slice.appName}
                          data-testid={`app-slice-${slice.appName}`}
                          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: 12,
                              color: 'var(--color-text-main)',
                            }}
                          >
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: 10,
                                  height: 10,
                                  borderRadius: 2,
                                  background: appColor(slice.appName),
                                  flexShrink: 0,
                                }}
                              />
                              {slice.appName}
                            </span>
                            <span
                              style={{
                                color: 'var(--color-text-muted)',
                                fontVariantNumeric: 'tabular-nums',
                                flexShrink: 0,
                              }}
                            >
                              {formatHMS(slice.durationSeconds)} · {slice.percentage.toFixed(1)}%
                            </span>
                          </div>
                          <div
                            style={{
                              height: 24,
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--color-surface-subtle)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${Math.max(2, slice.percentage)}%`,
                                borderRadius: 'var(--radius-sm)',
                                background: appColor(slice.appName),
                                transition: 'width 0.3s ease-out',
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* 注意力流失点（时间轴列表） */}
                <section
                  aria-label="注意力流失点"
                  data-testid="session-summary-attention-loss"
                >
                  <SectionLabel icon={<AlertTriangle size={14} />} text="注意力流失点" />
                  {data.attentionLossPoints.length === 0 ? (
                    <div
                      style={{
                        ...emptyTextStyle,
                        marginTop: 'var(--space-sm)',
                        color: 'var(--color-success)',
                      }}
                    >
                      本次专注非常专注！
                    </div>
                  ) : (
                    <div
                      style={{
                        marginTop: 'var(--space-sm)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-xs)',
                      }}
                    >
                      {data.attentionLossPoints.map((point, idx) => (
                        <div
                          key={`${point.timestamp}-${idx}`}
                          data-testid={`attention-loss-${idx}`}
                          style={attentionLossRowStyle}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--color-text-muted)',
                              fontVariantNumeric: 'tabular-nums',
                              flexShrink: 0,
                              minWidth: 56,
                            }}
                          >
                            {formatHHMM(point.timestamp)}
                          </span>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '2px 8px',
                              fontSize: 11,
                              fontWeight: 600,
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--color-warning)',
                              color: 'var(--color-on-primary)',
                            }}
                          >
                            {point.reason}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--color-text-muted)',
                              marginLeft: 'auto',
                            }}
                          >
                            {formatHMS(point.durationSeconds)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* 关联任务 */}
                {data.relatedTask && (
                  <section aria-label="关联任务" data-testid="session-summary-task">
                    <SectionLabel icon={<CheckCircle2 size={14} />} text="关联任务" />
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 'var(--space-sm)',
                        marginTop: 'var(--space-sm)',
                        padding: 'var(--space-sm) var(--space-md)',
                        background: 'var(--color-surface-subtle)',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          color: 'var(--color-text-main)',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {data.relatedTask.taskTitle}
                      </span>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 'var(--radius-md)',
                          background: data.relatedTask.completed
                            ? 'var(--color-success-soft)'
                            : 'var(--color-surface)',
                          color: data.relatedTask.completed
                            ? 'var(--color-success)'
                            : 'var(--color-text-muted)',
                          border: data.relatedTask.completed
                            ? 'none'
                            : '1px solid var(--color-border)',
                          flexShrink: 0,
                        }}
                      >
                        {data.relatedTask.completed ? '已完成' : '未完成'}
                      </span>
                    </div>
                  </section>
                )}

                {/* 解锁成就 */}
                {data.achievementsUnlocked.length > 0 && (
                  <section aria-label="解锁成就" data-testid="session-summary-achievements">
                    <SectionLabel icon={<Trophy size={14} />} text="解锁成就" />
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'var(--space-xs)',
                        marginTop: 'var(--space-sm)',
                      }}
                    >
                      {data.achievementsUnlocked.map((id) => (
                        <span
                          key={id}
                          data-testid={`achievement-${id}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--color-primary-soft)',
                            color: 'var(--color-primary)',
                          }}
                        >
                          <Trophy size={12} />
                          {id}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          {/* ===== Footer ===== */}
          <footer
            style={{
              borderTop: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              padding: 'var(--space-md) var(--space-lg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 'var(--space-sm)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              aria-label="继续专注"
              onClick={handleContinue}
              style={footerBtnStyle(false)}
            >
              继续专注
            </button>
            <button
              type="button"
              aria-label="查看完整洞察"
              onClick={handleViewInsights}
              style={footerBtnStyle(true)}
            >
              查看完整洞察
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ===== 子组件 ===== */
function SectionLabel({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        letterSpacing: 0.3,
      }}
    >
      <span style={{ display: 'inline-flex', color: 'var(--color-primary)' }}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

/* ===== 样式 ===== */
const emptyTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-light)',
};

const metricCardStyle: React.CSSProperties = {
  background: 'var(--color-surface-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-sm) var(--space-sm)',
  display: 'flex',
  flexDirection: 'column',
};

const attentionLossRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-sm)',
  padding: 'var(--space-xs) var(--space-sm)',
  background: 'var(--color-surface-subtle)',
  borderRadius: 'var(--radius-md)',
};

const iconBtnStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
};

function footerBtnStyle(primary: boolean): React.CSSProperties {
  return {
    height: 34,
    padding: '0 var(--space-md)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: primary ? 'none' : '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: primary ? 'var(--color-primary)' : 'var(--color-surface)',
    color: primary ? 'var(--color-on-primary)' : 'var(--color-text-main)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
