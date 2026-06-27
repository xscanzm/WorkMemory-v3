/**
 * 浮动操作按钮 (FAB) - 任务管理视图触发新建
 *
 * - 固定在视口右下角的圆形主色调按钮
 * - 悬停轻微放大反馈，Plus 图标 + aria-label
 */
import { Plus } from 'lucide-react';

interface Props {
  onClick: () => void;
}

export default function FAB({ onClick }: Props): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="新建任务"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: 'none',
        background: 'var(--color-primary)',
        color: 'var(--color-on-primary)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: 'var(--shadow-card)',
        cursor: 'pointer',
        zIndex: 100,
        padding: 0,
        transition: 'transform var(--duration-fast) var(--ease-out-expo)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.05)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      <Plus size={24} />
    </button>
  );
}
