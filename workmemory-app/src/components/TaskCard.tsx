/**
 * 任务卡片 (TaskCard) - 任务管理视图单条任务展示
 *
 * - 展示标题、描述、优先级徽标、状态徽标（点击循环流转）、到期日、标签、置顶标记
 * - 编辑按钮触发外层打开 TaskForm；删除按钮弹出 ConfirmDialog 后调用 deleteTask
 * - 状态机：inbox → todo → in_progress → completed → archived（archived 为终态，不可再流转）
 */
import { useRef, useState } from 'react';
import { Pencil, Trash2, Pin, Check } from 'lucide-react';
import type { Task } from '../store/taskStore';
import { useTaskStore } from '../store/taskStore';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  task: Task;
  onEdit: (task: Task) => void;
}

// 状态流转顺序（archived 为终态）
const STATUS_ORDER: Task['status'][] = [
  'inbox',
  'todo',
  'in_progress',
  'completed',
  'archived',
];

/** Task 23.6：滑动手势触发阈值（px） */
const SWIPE_THRESHOLD = 80;

const STATUS_LABEL: Record<Task['status'], string> = {
  inbox: 'Inbox',
  todo: '待办',
  in_progress: '进行中',
  completed: '已完成',
  archived: '已归档',
};

// 优先级配色：urgent=红 high=橙 medium=蓝 low=灰 none=无
const PRIORITY_STYLE: Record<
  Task['priority'],
  { bg: string; color: string; label: string }
> = {
  urgent: { bg: 'var(--color-danger)', color: 'var(--color-on-danger)', label: '紧急' },
  high: { bg: 'var(--color-warning)', color: '#FFFFFF', label: '高' },
  medium: { bg: 'var(--color-primary)', color: 'var(--color-on-primary)', label: '中' },
  low: { bg: 'var(--color-text-muted)', color: '#FFFFFF', label: '低' },
  none: { bg: 'transparent', color: 'var(--color-text-light)', label: '无' },
};

export default function TaskCard({ task, onEdit }: Props): JSX.Element {
  const updateTask = useTaskStore((s) => s.updateTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Task 23.6：滑动手势状态
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const isArchived = task.status === 'archived';
  const priority = PRIORITY_STYLE[task.priority];

  // 点击状态徽标：流转到下一个状态（archived 不可流转）
  const handleStatusCycle = (): void => {
    if (isArchived) return;
    const idx = STATUS_ORDER.indexOf(task.status);
    const next = STATUS_ORDER[Math.min(idx + 1, STATUS_ORDER.length - 1)];
    if (next !== task.status) {
      void updateTask({ ...task, status: next });
    }
  };

  const handleDelete = (): void => {
    setConfirmOpen(false);
    void deleteTask(task.id);
  };

  // Task 23.6：右滑完成 / 左滑删除（已 completed/archived 不再滑完）
  const handleSwipeComplete = (): void => {
    if (task.status === 'completed' || task.status === 'archived') return;
    void updateTask({ ...task, status: 'completed' });
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    // 起点落在按钮（编辑/删除/状态徽标）上时不启动滑动，避免误触
    if ((e.target as HTMLElement).closest('button')) return;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    setSwiping(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    if (startXRef.current === null || startYRef.current === null) return;
    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;
    // 仅响应水平为主的滑动，垂直交给容器滚动
    if (Math.abs(dx) <= Math.abs(dy)) return;
    setOffsetX(dx);
  };

  const endSwipe = (e: React.PointerEvent): void => {
    if (startXRef.current === null) {
      setSwiping(false);
      return;
    }
    const dx = offsetX;
    startXRef.current = null;
    startYRef.current = null;
    setSwiping(false);
    setOffsetX(0);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointerId 可能已释放，忽略
    }
    if (dx >= SWIPE_THRESHOLD) {
      handleSwipeComplete();
    } else if (dx <= -SWIPE_THRESHOLD) {
      setConfirmOpen(true);
    }
  };

  return (
    <>
      <div
        style={{
          position: 'relative',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}
      >
        {/* 滑动揭示的动作提示背景 */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              paddingLeft: 'var(--space-lg)',
              background:
                offsetX > 0 ? 'rgba(34, 197, 94, 0.18)' : 'transparent',
              color: 'var(--color-success)',
            }}
          >
            {offsetX > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
                <Check size={14} /> 完成
              </span>
            )}
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingRight: 'var(--space-lg)',
              background:
                offsetX < 0 ? 'rgba(239, 68, 68, 0.18)' : 'transparent',
              color: 'var(--color-danger)',
            }}
          >
            {offsetX < 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
                删除 <Trash2 size={14} />
              </span>
            )}
          </div>
        </div>
      <article
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-lg)',
          boxShadow: 'var(--shadow-subtle)',
          transition: swiping
            ? 'none'
            : 'box-shadow var(--duration-fast) var(--ease-out-expo), transform var(--duration-fast) var(--ease-out-expo)',
          transform: `translateX(${offsetX}px)`,
          touchAction: 'pan-y',
          position: 'relative',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endSwipe}
        onPointerCancel={endSwipe}
        onMouseEnter={(e) => {
          if (!swiping) e.currentTarget.style.boxShadow = 'var(--shadow-card)';
        }}
        onMouseLeave={(e) => {
          if (!swiping) e.currentTarget.style.boxShadow = 'var(--shadow-subtle)';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-md)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 4 }}>
              {task.isPinned && (
                <Pin
                  size={14}
                  style={{ color: 'var(--color-warning)', flexShrink: 0 }}
                  aria-label="已置顶"
                />
              )}
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--color-text-main)',
                  margin: 0,
                  wordBreak: 'break-word',
                  textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                }}
              >
                {task.title}
              </h3>
            </div>
            {task.description && (
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-muted)',
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {task.description}
              </p>
            )}
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flexShrink: 0 }}>
            <button type="button" onClick={() => onEdit(task)} aria-label="编辑任务" style={iconBtn}>
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              aria-label="删除任务"
              style={iconBtn}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* 元信息行：优先级 / 状态 / 到期日 / 标签 / 分类 */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            marginTop: 'var(--space-md)',
          }}
        >
          {task.priority !== 'none' && (
            <span style={badge(priority.bg, priority.color)}>{priority.label}</span>
          )}

          <button
            type="button"
            onClick={handleStatusCycle}
            disabled={isArchived}
            aria-label={`切换状态，当前 ${STATUS_LABEL[task.status]}`}
            style={{
              ...badge('var(--color-surface-subtle)', 'var(--color-text-main)'),
              border: '1px solid var(--color-border)',
              cursor: isArchived ? 'default' : 'pointer',
              opacity: isArchived ? 0.7 : 1,
            }}
          >
            {STATUS_LABEL[task.status]}
          </button>

          {task.dueDate && (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              到期 {task.dueDate}
            </span>
          )}

          {task.tags.map((tag) => (
            <span key={tag} style={badge('var(--color-primary-soft)', 'var(--color-primary)')}>
              #{tag}
            </span>
          ))}

          {task.category && (
            <span style={{ fontSize: 12, color: 'var(--color-text-light)' }}>{task.category}</span>
          )}
        </div>
      </article>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="删除任务"
        message="确认删除此任务？"
        confirmText="删除"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

/* ===== 样式 ===== */
const iconBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  padding: 0,
};

function badge(bg: string, color: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 11,
    fontWeight: 500,
    padding: '2px 8px',
    borderRadius: 'var(--radius-round)',
    background: bg,
    color,
    lineHeight: 1.4,
  };
}
