/**
 * Toast 通知容器 (04_UI_SPEC.md 设计 Token)
 *
 * - 通过 Portal 渲染到 document.body，脱离主窗口三栏布局
 * - 毛玻璃 + 左侧 4px 语义色边框，3 秒自动消失（由 toastStore 控制）
 * - 暴露为默认导出 ToastContainer，在 MainLayout 末尾挂载一次
 */
import { createPortal } from 'react-dom';
import { useToastStore } from '../store/toastStore';
import type { ToastType } from '../store/toastStore';

const typeColor: Record<ToastType, string> = {
  success: 'var(--color-success)',
  error: 'var(--color-danger)',
  info: 'var(--color-primary)',
};

const typeIcon: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
};

export default function ToastContainer(): JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        bottom: 'var(--space-2xl)',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm)',
        zIndex: 10000,
        pointerEvents: 'none',
      }}
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            padding: 'var(--space-md) var(--space-lg)',
            background: 'var(--color-surface-glass-strong)',
            backdropFilter: 'var(--blur-acrylic)',
            WebkitBackdropFilter: 'var(--blur-acrylic)',
            border: '1px solid var(--color-border)',
            borderLeft: `4px solid ${typeColor[t.type]}`,
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-overlay)',
            color: 'var(--color-text-main)',
            fontSize: '14px',
            pointerEvents: 'auto',
            minWidth: '280px',
            maxWidth: '480px',
            animation: 'toast-in var(--duration-base) var(--ease-out-expo)',
          }}
        >
          <span style={{ color: typeColor[t.type], fontWeight: 600, fontSize: '16px' }} aria-hidden>
            {typeIcon[t.type]}
          </span>
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="关闭通知"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
