/**
 * 未保存更改确认对话框 (审计意见 2.4)
 *
 * 路由切换前若存在 dirty 状态则弹出，用户可选择"丢弃并离开"或"取消"。
 * 基于 Radix UI Dialog（已在 deps 中）。
 */
import * as Dialog from '@radix-ui/react-dialog';

interface UnsavedChangesDialogProps {
  open: boolean;
  reasons: string[];
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({
  open,
  reasons,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps): JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="wm-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
          }}
        />
        <Dialog.Content
          className="wm-dialog-center"
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%,-50%)',
            background: 'var(--color-surface)',
            padding: 24,
            borderRadius: 12,
            zIndex: 1001,
            maxWidth: 400,
          }}
        >
          <Dialog.Title
            style={{ margin: 0, marginBottom: 12, fontSize: 16, fontWeight: 600 }}
          >
            未保存的更改
          </Dialog.Title>
          <Dialog.Description
            style={{
              marginBottom: 16,
              color: 'var(--color-text-muted)',
              fontSize: 14,
            }}
          >
            {reasons.length > 0
              ? reasons.join('；')
              : '有未保存的更改，确定要离开吗？'}
          </Dialog.Description>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '8px 16px',
                border: '1px solid var(--color-border)',
                background: 'transparent',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={onDiscard}
              style={{
                padding: '8px 16px',
                border: 'none',
                background: 'var(--color-danger, #ef4444)',
                color: 'white',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              丢弃并离开
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
