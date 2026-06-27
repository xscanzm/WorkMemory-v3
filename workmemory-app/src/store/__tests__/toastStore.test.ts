import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useToastStore, toast } from '../toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  it('showToast 添加通知到列表', () => {
    useToastStore.getState().showToast('测试消息', 'success');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].message).toBe('测试消息');
    expect(useToastStore.getState().toasts[0].type).toBe('success');
  });

  it('3 秒后自动消失', () => {
    useToastStore.getState().showToast('自动消失', 'info');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('dismissToast 手动移除', () => {
    useToastStore.getState().showToast('手动移除', 'error');
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().dismissToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('toast.success/error/info 便捷方法', () => {
    toast.success('成功');
    toast.error('失败');
    toast.info('信息');
    expect(useToastStore.getState().toasts).toHaveLength(3);
  });
});
