/**
 * 仪表盘首页 (HomeView) - 优化 7
 *
 * - 时间感知问候语（早/午/晚/深夜）
 * - 宠物小组件（SpriteAnimator 缩略 + 点击跳转 /pet，缺失资源 emoji 兜底）
 * - 今日统计条（完成任务数 / 专注时长 / 连续天数）
 * - 置顶任务列表（is_pinned=true，top 3）
 * - 最近任务列表（按 updatedAt 倒序，top 5）
 *
 * 数据来源：
 *   - useTaskStore.tasks（响应式订阅，挂载时 loadTasks）
 *   - usePetStore.petState（响应式订阅，挂载时 loadPetState）
 *   - invoke('get_today_stats')（后端 daily_stats，无 statsStore，直接调用）
 */
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke, isTauri } from '@/src-tauri/api';
import { useTaskStore, type Task } from '@/store/taskStore';
import { usePetStore, type PetState } from '@/store/petStore';
import { useAppStore } from '@/store/useAppStore';
import { useAsync } from '@/hooks/useAsync';
import MascotSprite from '@/components/mascot/MascotSprite';
import AIInsightCard from '@/components/AIInsightCard';
import StreakCalendar from '@/components/StreakCalendar';
import AchievementCard, { type Achievement } from '@/components/AchievementCard';
import { useI18n } from '@/i18n';

/** 今日统计 DTO（与后端 get_today_stats 返回值对齐，camelCase） */
interface DailyStats {
  date: string;
  tasksCompleted: number;
  totalFocusTime: number; // 分钟
  streakCount: number;
  createdAt: string;
  updatedAt: string;
}

/* ===== 时间与格式化工具 ===== */

/** 时段问候语（5-11 早 / 12-13 午 / 14-17 下午 / 18-22 晚 / 23-4 深夜） */
function getGreeting(hour: number): { text: string; icon: string } {
  if (hour >= 5 && hour <= 11) return { text: '早上好', icon: '☀️' };
  if (hour >= 12 && hour <= 13) return { text: '中午好', icon: '🌤️' };
  if (hour >= 14 && hour <= 17) return { text: '下午好', icon: '☕' };
  if (hour >= 18 && hour <= 22) return { text: '晚上好', icon: '🌙' };
  return { text: '夜深了，注意休息', icon: '🌙' };
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 格式化今日日期：今天是 YYYY年MM月DD日 周X */
function formatDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `今天是 ${y}年${m}月${d}日 ${WEEKDAYS[now.getDay()]}`;
}

/** 专注时长（分钟）格式化：Xh Ym 或 Ym */
function formatFocusTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** 相对时间："2小时前" / "5分钟前" / "刚刚" */
function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diffSec = Math.max(0, (Date.now() - ts) / 1000);
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}天前`;
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 任务 dueDate 截断为 YYYY-MM-DD 展示 */
function formatDueDate(iso: string): string {
  if (!iso) return '';
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

/** 任务状态 → 徽标（中文标签 + 前景/背景色，均使用 CSS 变量或语义色） */
function statusBadge(status: Task['status']): {
  label: string;
  color: string;
  bg: string;
} {
  switch (status) {
    case 'todo':
      return {
        label: '待办',
        color: 'var(--color-text-main)',
        bg: 'var(--color-surface-subtle)',
      };
    case 'in_progress':
      return {
        label: '进行中',
        color: 'var(--color-warning)',
        bg: 'rgba(245, 158, 11, 0.12)',
      };
    case 'completed':
      return {
        label: '已完成',
        color: 'var(--color-success)',
        bg: 'var(--color-success-soft)',
      };
    case 'archived':
      return {
        label: '已归档',
        color: 'var(--color-text-light)',
        bg: 'var(--color-surface-subtle)',
      };
    case 'inbox':
    default:
      return {
        label: '收件箱',
        color: 'var(--color-text-muted)',
        bg: 'var(--color-surface-subtle)',
      };
  }
}

/** 宠物 species → emoji 兜底（资源缺失时使用） */
function speciesToEmoji(species: string): string {
  const s = (species || '').toLowerCase();
  if (s.includes('cat') || s.includes('猫')) return '🐱';
  if (s.includes('dog') || s.includes('狗')) return '🐶';
  if (s.includes('fox') || s.includes('狐')) return '🦊';
  if (s.includes('panda') || s.includes('熊')) return '🐼';
  if (s.includes('robot') || s.includes('机器人')) return '🤖';
  if (s.includes('rabbit') || s.includes('兔')) return '🐰';
  return '🐾';
}

export default function HomeView(): JSX.Element {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);
  const petState = usePetStore((s) => s.petState);
  const mascotId = useAppStore((s) => s.mascotId);

  // 今日统计：统一通过 useAsync 获取（审计意见 2.5），loading/error/data 三态
  const { data: stats, error: statsError } = useAsync(
    () => invoke<DailyStats>('get_today_stats'),
    { deps: [] },
  );
  // 分析数据：连续天数 + 生产力评分（本周分析卡片使用）
  const [streak, setStreak] = useState<number>(0);
  const [productivityScore, setProductivityScore] = useState<number>(0);
  // 成就列表（Task 23.1）
  const [achievements, setAchievements] = useState<Achievement[]>([]);

  /** 拉取分析数据：连续打卡天数 + 生产力评分（best-effort，失败降级为 0） */
  const loadAnalytics = async (): Promise<void> => {
    try {
      const s = await invoke<number>('calculate_streak');
      setStreak(Number.isFinite(s) ? s : 0);
    } catch (err) {
      console.error('[HomeView] calculate_streak 失败', err);
      setStreak(0);
    }
    try {
      const score = await invoke<number>('productivity_score');
      setProductivityScore(Number.isFinite(score) ? score : 0);
    } catch (err) {
      console.error('[HomeView] productivity_score 失败', err);
      setProductivityScore(0);
    }
  };

  /** 拉取成就（先重算解锁条件，再展示，best-effort）
   *
   * Task 17.3：后端 recalculate_achievements 对新解锁成就 emit
   * 'achievement-unlocked' 事件 → achievementStore → AchievementUnlockModal 特效弹窗。
   * 成就解锁通知走专属弹窗，**不再** 走 toastStore 普通 toast（此处不调用 toast）。 */
  const loadAchievements = async (): Promise<void> => {
    try {
      const list = await invoke<Achievement[]>('recalculate_achievements');
      setAchievements(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('[HomeView] recalculate_achievements 失败', err);
      setAchievements([]);
    }
  };

  // 挂载时拉取任务 / 宠物 / 分析数据 / 成就（今日统计由 useAsync 自动获取）
  useEffect(() => {
    void useTaskStore.getState().loadTasks();
    void usePetStore.getState().loadPetState();
    void loadAnalytics();
    void loadAchievements();
  }, []);

  const greeting = useMemo(() => {
    const now = new Date();
    return { ...getGreeting(now.getHours()), date: formatDate(now) };
  }, []);

  // 置顶任务：isPinned === true，取前 3
  const pinnedTasks = useMemo(() => {
    return tasks.filter((t) => t.isPinned === true).slice(0, 3);
  }, [tasks]);

  // 最近任务：按 updatedAt 倒序，取前 5
  const recentTasks = useMemo(() => {
    return [...tasks]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 5);
  }, [tasks]);

  return (
    <div
      style={{
        padding: 'var(--space-xl)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-lg)',
      }}
    >
      {/* 1. 时间感知问候语 */}
      <section aria-label="问候语">
        <div
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: 'var(--color-text-main)',
          }}
        >
          <span style={{ marginRight: 8 }}>{greeting.icon}</span>
          {greeting.text}
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--color-text-muted)',
            marginTop: 4,
          }}
        >
          {greeting.date}
        </div>
      </section>

      {/* 2. 宠物小组件（点击跳转 /pet） */}
      <PetCard
        petState={petState}
        mascotId={mascotId}
        onClick={() => navigate('/pet')}
      />

      {/* 3. 今日统计条 */}
      <StatsRow stats={stats} hasError={!!statsError} />

      {/* 4. 本周分析（AI 见解 + 打卡热力图） */}
      <section aria-label="本周分析" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <AIInsightCard
          stats={stats}
          streak={streak}
          productivityScore={productivityScore}
        />
        <StreakCalendar />
      </section>

      {/* 4.5 成就墙（Task 23.1） */}
      <AchievementSection achievements={achievements} />

      {/* 5. 置顶任务列表 */}
      <TaskListSection
        title="📌 置顶任务"
        tasks={pinnedTasks}
        emptyText="暂无置顶任务"
        showDueDate
      />

      {/* 6. 最近任务列表 */}
      <TaskListSection
        title="最近任务"
        tasks={recentTasks}
        emptyText="暂无任务，去任务页创建吧"
        showRelativeTime
      />
    </div>
  );
}

/* ===== 宠物小组件 ===== */
interface PetCardProps {
  petState: PetState | null;
  mascotId: number;
  onClick: () => void;
}

function PetCard({ petState, mascotId, onClick }: PetCardProps): JSX.Element {
  const [hovered, setHovered] = useState(false);

  const cardStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-lg)',
    padding: 'var(--space-lg) var(--space-xl)',
    background: 'var(--color-surface-glass)',
    backdropFilter: 'var(--blur-acrylic)',
    WebkitBackdropFilter: 'var(--blur-acrylic)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: hovered ? 'var(--shadow-overlay)' : 'var(--shadow-card)',
    transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
    cursor: 'pointer',
    transition:
      'box-shadow var(--duration-fast) var(--ease-out-expo), transform var(--duration-fast) var(--ease-out-expo)',
  };

  const handleKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKey}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={cardStyle}
      aria-label={petState ? `查看宠物 ${petState.species}` : '领养宠物'}
    >
      {petState ? (
        <>
          <PetAvatar mascotId={mascotId} species={petState.species} />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-sm)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-sm)',
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'var(--color-text-main)',
                }}
              >
                {petState.species || '小伙伴'}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--color-primary)',
                  background: 'var(--color-primary-soft)',
                  padding: '1px 8px',
                  borderRadius: 'var(--radius-round)',
                }}
              >
                Lv.{petState.level}
              </span>
              {petState.mood && (
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  心情：{petState.mood}
                </span>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                maxWidth: 320,
              }}
            >
              <MiniBar label="饱腹" value={petState.hunger} />
              <MiniBar label="精力" value={petState.energy} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              fontSize: 40,
              width: 64,
              textAlign: 'center',
              color: 'var(--color-text-light)',
              flexShrink: 0,
            }}
            aria-hidden
          >
            🐾
          </div>
          <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
            点击领养你的小伙伴
          </div>
        </>
      )}
    </div>
  );
}

/* ===== 宠物头像（MascotSprite + emoji 兜底） ===== */
function PetAvatar({
  mascotId,
  species,
}: {
  mascotId: number;
  species: string;
}): JSX.Element {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    'loading',
  );

  useEffect(() => {
    let cancelled = false;
    // 复用 MascotSprite 的资源路径逻辑：Tauri 走 asset://，Web 走 /pet/<id>/
    const url = isTauri()
      ? `asset://localhost/pet/${mascotId}/spritesheet.webp`
      : `/pet/${mascotId}/spritesheet.webp`;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setStatus('loaded');
    };
    img.onerror = () => {
      if (!cancelled) setStatus('error');
    };
    img.src = url;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [mascotId]);

  if (status === 'loaded') {
    return (
      <div
        style={{
          width: 58,
          height: 62,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <MascotSprite mascotId={mascotId} state="idle" scale={0.3} />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div
        style={{
          width: 58,
          height: 62,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 40,
          flexShrink: 0,
        }}
        aria-hidden
      >
        {speciesToEmoji(species)}
      </div>
    );
  }
  // loading 占位，保持布局稳定
  return <div style={{ width: 58, height: 62, flexShrink: 0 }} aria-hidden />;
}

/* ===== 迷你进度条 ===== */
function MiniBar({ label, value }: { label: string; value: number }): JSX.Element {
  const v = Math.max(
    0,
    Math.min(100, Number.isFinite(value) ? value : 0),
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
      <span
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          width: 28,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 4,
          background: 'var(--color-border)',
          borderRadius: 'var(--radius-round)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${v}%`,
            height: '100%',
            background: 'var(--color-primary)',
            borderRadius: 'var(--radius-round)',
            transition: 'width var(--duration-base) var(--ease-out-expo)',
          }}
        />
      </div>
    </div>
  );
}

/* ===== 今日统计条 ===== */
function StatsRow({
  stats,
  hasError,
}: {
  stats: DailyStats | null;
  hasError: boolean;
}): JSX.Element {
  const tasksCompleted = stats && !hasError ? stats.tasksCompleted : null;
  const focusTime = stats && !hasError ? stats.totalFocusTime : null;
  const streak = stats && !hasError ? stats.streakCount : null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 'var(--space-md)',
      }}
    >
      <StatCard
        value={tasksCompleted === null ? '—' : String(tasksCompleted)}
        label="完成任务数"
      />
      <StatCard
        value={focusTime === null ? '—' : formatFocusTime(focusTime)}
        label="专注时长"
      />
      <StatCard
        value={streak === null ? '—' : `${streak}天`}
        label="连续天数"
      />
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-md) var(--space-lg)',
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 2,
      }}
    >
      <span
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--color-primary)',
          lineHeight: 1.2,
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        {label}
      </span>
    </div>
  );
}

/* ===== 成就墙（Task 23.1） ===== */
function AchievementSection({
  achievements,
}: {
  achievements: Achievement[];
}): JSX.Element {
  const { t } = useI18n();
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  return (
    <section
      aria-label={t('achievement.title')}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-lg) var(--space-xl)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-md)',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-main)' }}>
          🏆 {t('achievement.title')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {t('achievement.unlocked.count', { unlocked: unlockedCount, total: achievements.length })}
        </div>
      </div>
      {achievements.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {t('achievement.empty')}
        </div>
      ) : (
        <div
          role="list"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 'var(--space-sm)',
          }}
        >
          {achievements.map((a) => (
            <AchievementCard key={a.code} achievement={a} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ===== 任务列表区块（置顶 / 最近复用） ===== */
interface TaskListSectionProps {
  title: string;
  tasks: Task[];
  emptyText: string;
  showDueDate?: boolean;
  showRelativeTime?: boolean;
}

function TaskListSection(props: TaskListSectionProps): JSX.Element {
  const { title, tasks, emptyText, showDueDate, showRelativeTime } = props;
  return (
    <section
      aria-label={title}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-lg) var(--space-xl)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--color-text-main)',
          marginBottom: 'var(--space-md)',
        }}
      >
        {title}
      </div>
      {tasks.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {emptyText}
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-sm)',
          }}
        >
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              showDueDate={showDueDate}
              showRelativeTime={showRelativeTime}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskRow({
  task,
  showDueDate,
  showRelativeTime,
}: {
  task: Task;
  showDueDate?: boolean;
  showRelativeTime?: boolean;
}): JSX.Element {
  const badge = statusBadge(task.status);
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-md)',
        padding: '6px 0',
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          color: 'var(--color-text-main)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {task.title || '未命名任务'}
      </span>
      <span
        style={{
          fontSize: 11,
          color: badge.color,
          background: badge.bg,
          padding: '1px 8px',
          borderRadius: 'var(--radius-round)',
          flexShrink: 0,
        }}
      >
        {badge.label}
      </span>
      {showDueDate && task.dueDate && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            flexShrink: 0,
            minWidth: 72,
            textAlign: 'right',
          }}
        >
          {formatDueDate(task.dueDate)}
        </span>
      )}
      {showRelativeTime && task.updatedAt && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            flexShrink: 0,
            minWidth: 72,
            textAlign: 'right',
          }}
        >
          {formatRelativeTime(task.updatedAt)}
        </span>
      )}
    </li>
  );
}
