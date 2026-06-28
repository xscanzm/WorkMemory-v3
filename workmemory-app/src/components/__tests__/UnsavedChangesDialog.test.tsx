import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UnsavedChangesDialog } from '../UnsavedChangesDialog';

// 未保存更改确认对话框测试 - audit-v4-hardening Task 9 (审计意见 2.4)
// 基于 Radix UI Dialog，open=false 时不挂载 Portal 内容
describe('UnsavedChangesDialog 未保存更改确认对话框 (审计意见 2.4)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('open=false 时不渲染', () => {
    render(
      <UnsavedChangesDialog
        open={false}
        reasons={['编辑器未保存']}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText('未保存的更改')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '丢弃并离开' }),
    ).not.toBeInTheDocument();
  });

  it('open=true 时显示标题与原因', () => {
    render(
      <UnsavedChangesDialog
        open={true}
        reasons={['编辑器未保存']}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('未保存的更改')).toBeInTheDocument();
    expect(screen.getByText('编辑器未保存')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '丢弃并离开' }),
    ).toBeInTheDocument();
  });

  it('点击"取消"触发 onCancel', () => {
    const onCancel = vi.fn();
    render(
      <UnsavedChangesDialog
        open={true}
        reasons={['编辑器未保存']}
        onDiscard={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('点击"丢弃并离开"触发 onDiscard', () => {
    const onDiscard = vi.fn();
    render(
      <UnsavedChangesDialog
        open={true}
        reasons={['编辑器未保存']}
        onDiscard={onDiscard}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '丢弃并离开' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('显示多个 dirty reason（以；连接）', () => {
    render(
      <UnsavedChangesDialog
        open={true}
        reasons={['编辑器未保存', '表单未保存']}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText('编辑器未保存；表单未保存'),
    ).toBeInTheDocument();
  });

  it('reasons 为空时显示默认文案', () => {
    render(
      <UnsavedChangesDialog
        open={true}
        reasons={[]}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText('有未保存的更改，确定要离开吗？'),
    ).toBeInTheDocument();
  });

  it('Radix onOpenChange(false)（如 Esc）触发 onCancel', () => {
    const onCancel = vi.fn();
    render(
      <UnsavedChangesDialog
        open={true}
        reasons={['编辑器未保存']}
        onDiscard={vi.fn()}
        onCancel={onCancel}
      />,
    );
    // Radix Dialog.Content 监听 Esc 并触发 onOpenChange(false) → onCancel
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
