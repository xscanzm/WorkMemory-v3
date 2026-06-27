/**
 * 任务表单 (TaskForm) - 任务新建/编辑模态
 *
 * - task 为 null 时为新建模式（调用 saveTask）；否则为编辑模式（调用 updateTask）
 * - 字段：标题、描述、状态、优先级、到期日、心情标签、分类、标签（逗号分隔）、是否置顶
 * - 校验标题非空；保存后关闭模态并 toast 反馈
 * - 通过 Portal 渲染到 document.body，遮罩 + 居中卡片，Escape / 点击遮罩关闭
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Task } from '../store/taskStore';
import { useTaskStore } from '../store/taskStore';
import { toast } from '../store/toastStore';

interface Props {
  open: boolean;
  task: Task | null;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: Task['status']; label: string }[] = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'todo', label: '待办' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'archived', label: '已归档' },
];

const PRIORITY_OPTIONS: { value: Task['priority']; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
];

interface FormState {
  title: string;
  description: string;
  status: Task['status'];
  priority: Task['priority'];
  dueDate: string;
  moodTag: string;
  category: string;
  tags: string;
  isPinned: boolean;
}

function toFormState(task: Task | null): FormState {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    status: task?.status ?? 'inbox',
    priority: task?.priority ?? 'none',
    dueDate: task?.dueDate ?? '',
    moodTag: task?.moodTag ?? '',
    category: task?.category ?? '',
    tags: task?.tags.join(', ') ?? '',
    isPinned: task?.isPinned ?? false,
  };
}

export default function TaskForm({ open, task, onClose }: Props): JSX.Element | null {
  const saveTask = useTaskStore((s) => s.saveTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const [form, setForm] = useState<FormState>(toFormState(task));

  // 打开或 task 变化时重置表单
  useEffect(() => {
    if (open) setForm(toFormState(task));
  }, [open, task]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const isEdit = task !== null;

  const update = (patch: Partial<FormState>): void => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) {
      toast.error('任务标题不能为空');
      return;
    }
    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (isEdit && task) {
      const updated: Task = {
        ...task,
        title,
        description: form.description,
        status: form.status,
        priority: form.priority,
        dueDate: form.dueDate || null,
        moodTag: form.moodTag || null,
        category: form.category,
        tags,
        isPinned: form.isPinned,
      };
      const ok = await updateTask(updated);
      if (ok) toast.success('任务已更新');
    } else {
      const saved = await saveTask({
        title,
        description: form.description,
        status: form.status,
        priority: form.priority,
        dueDate: form.dueDate || null,
        moodTag: form.moodTag || null,
        category: form.category,
        tags,
        isPinned: form.isPinned,
      });
      if (saved) toast.success('任务已创建');
    }
    onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? '编辑任务' : '新建任务'}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-overlay)',
          padding: 'var(--space-xl)',
          width: '90%',
          maxWidth: '480px',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--color-text-main)' }}>
          {isEdit ? '编辑任务' : '新建任务'}
        </h2>

        {/* 标题 */}
        <Field label="标题">
          <input
            type="text"
            value={form.title}
            onChange={(e) => update({ title: e.target.value })}
            autoFocus
            required
            style={inputStyle}
          />
        </Field>

        {/* 描述 */}
        <Field label="描述">
          <textarea
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </Field>

        <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
          <Field label="状态" style={{ flex: 1 }}>
            <select
              value={form.status}
              onChange={(e) => update({ status: e.target.value as Task['status'] })}
              style={inputStyle}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="优先级" style={{ flex: 1 }}>
            <select
              value={form.priority}
              onChange={(e) => update({ priority: e.target.value as Task['priority'] })}
              style={inputStyle}
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
          <Field label="到期日" style={{ flex: 1 }}>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => update({ dueDate: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="分类" style={{ flex: 1 }}>
            <input
              type="text"
              value={form.category}
              onChange={(e) => update({ category: e.target.value })}
              placeholder="如：工作"
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="心情标签">
          <input
            type="text"
            value={form.moodTag}
            onChange={(e) => update({ moodTag: e.target.value })}
            placeholder="如：专注"
            style={inputStyle}
          />
        </Field>

        <Field label="标签（逗号分隔）">
          <input
            type="text"
            value={form.tags}
            onChange={(e) => update({ tags: e.target.value })}
            placeholder="如：前端, 紧急"
            style={inputStyle}
          />
        </Field>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            fontSize: 13,
            color: 'var(--color-text-main)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={form.isPinned}
            onChange={(e) => update({ isPinned: e.target.checked })}
          />
          置顶
        </label>

        {/* 操作按钮 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--space-sm)',
            marginTop: 'var(--space-xs)',
          }}
        >
          <button type="button" onClick={onClose} style={cancelBtnStyle}>
            取消
          </button>
          <button type="submit" style={submitBtnStyle}>
            {isEdit ? '更新' : '保存'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/* ===== 子组件 & 样式 ===== */
function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}): JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-xs)',
        ...style,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--color-text-main)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
  boxSizing: 'border-box',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: 'var(--space-sm) var(--space-lg)',
  background: 'var(--color-surface-subtle)',
  color: 'var(--color-text-main)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: 13,
};

const submitBtnStyle: React.CSSProperties = {
  padding: 'var(--space-sm) var(--space-lg)',
  background: 'var(--color-primary)',
  color: 'var(--color-on-primary)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
