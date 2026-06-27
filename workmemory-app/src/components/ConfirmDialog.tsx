/**
 * 通用确认对话框 (Portal 模态)
 *
 * - 通过 Portal 渲染到 document.body，遮罩 + 居中卡片
 * - 支持 danger 语义（确认按钮变红，用于删除等破坏性操作）
 * - Escape 键 / 点击遮罩触发 onCancel；点击卡片内容阻止冒泡
 * - 完全受控：open / onConfirm / onCancel 由调用方管理
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog(props: Props): JSX.Element | null {
  const {
    open,
    title,
    message,
    confirmText = '确认',
    cancelText = '取消',
    danger = false,
    onConfirm,
    onCancel,
  } = props;

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
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
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-overlay)',
          padding: 'var(--space-xl)',
          maxWidth: '400px',
          width: '90%',
        }}
      >
        <h3 id="confirm-dialog-title" style={{ fontSize: '16px', fontWeight: 600, marginBottom: 'var(--space-sm)' }}>
          {title}
        </h3>
        <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: 'var(--space-lg)', lineHeight: 1.6 }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: 'var(--space-sm) var(--space-lg)',
              background: 'var(--color-surface-subtle)',
              color: 'var(--color-text-main)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: 'var(--space-sm) var(--space-lg)',
              background: danger ? 'var(--color-danger)' : 'var(--color-primary)',
              color: danger ? 'var(--color-on-danger)' : 'var(--color-on-primary)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
