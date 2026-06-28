/**
 * QuickCaptureView 测试 - audit-v4-hardening Task 12
 *
 * 覆盖：
 *   - 渲染 textarea 和按钮
 *   - Ctrl+Enter 提交触发 invoke('save_quick_thought')（含回退到 save_to_wiki）
 *   - 截图按钮点击触发 invoke('trigger_manual_capture') 并追加 OCR 文本
 *   - Esc 调用 invoke('hide_quick_capture')
 *   - 关闭按钮调用 invoke('hide_quick_capture')
 *   - window blur 事件触发 invoke('hide_quick_capture')
 *
 * Mock：
 *   - `@tauri-apps/api/core` 的 invoke（避免真实 IPC 调用）
 *   - test/setup.ts 已定义 window.__TAURI_INTERNALS__ 使 api.isTauri() 返回 true
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

// vi.mock 工厂会被提升到文件顶部，因此用 vi.hoisted 声明 mock 以确保可访问。
const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

import QuickCaptureView from '../QuickCaptureView';

describe('QuickCaptureView 快速捕获窗口', () => {
  beforeEach(() => {
    cleanup();
    mockInvoke.mockReset();
    // 默认所有 invoke 都成功
    mockInvoke.mockResolvedValue(undefined);
  });

  it('渲染 textarea 和按钮', () => {
    render(<QuickCaptureView />);
    expect(screen.getByLabelText('闪念内容')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('记录一个闪念…')).toBeInTheDocument();
    expect(screen.getByLabelText('提交')).toBeInTheDocument();
    expect(screen.getByLabelText('截图追加')).toBeInTheDocument();
    expect(screen.getByLabelText('关闭')).toBeInTheDocument();
  });

  it('Ctrl+Enter 提交触发 invoke(save_quick_thought)', async () => {
    const user = userEvent.setup();
    render(<QuickCaptureView />);
    const textarea = screen.getByLabelText('闪念内容');
    await user.type(textarea, '测试闪念');

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'save_quick_thought',
        expect.objectContaining({ content: '测试闪念', screenshot: null }),
      );
    });
  });

  it('后端无 save_quick_thought 时回退到 invoke(save_to_wiki)', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'save_quick_thought') {
        return Promise.reject(new Error('command not found'));
      }
      return Promise.resolve(undefined);
    });

    const user = userEvent.setup();
    render(<QuickCaptureView />);
    const textarea = screen.getByLabelText('闪念内容');
    await user.type(textarea, '回退测试');

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'save_to_wiki',
        expect.objectContaining({ content: '回退测试' }),
      );
    });
  });

  it('提交成功后清空 textarea 并调用 hide_quick_capture', async () => {
    const user = userEvent.setup();
    render(<QuickCaptureView />);
    const textarea = screen.getByLabelText('闪念内容') as HTMLTextAreaElement;
    await user.type(textarea, '提交后清空');

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('hide_quick_capture', undefined);
    });
    // 提交成功后 textarea 应被清空
    expect(textarea.value).toBe('');
  });

  it('空内容时 Ctrl+Enter 不触发提交', async () => {
    render(<QuickCaptureView />);
    const textarea = screen.getByLabelText('闪念内容');

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    // 等待可能的微任务刷新
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('截图按钮点击触发 invoke(trigger_manual_capture) 并追加 OCR 文本', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'trigger_manual_capture') {
        return Promise.resolve('OCR识别文本');
      }
      return Promise.resolve(undefined);
    });

    const user = userEvent.setup();
    render(<QuickCaptureView />);
    const textarea = screen.getByLabelText('闪念内容') as HTMLTextAreaElement;
    const btn = screen.getByLabelText('截图追加');

    await user.click(btn);

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('trigger_manual_capture', undefined);
    });
    expect(textarea.value).toContain('OCR识别文本');
  });

  it('Esc 调用 invoke(hide_quick_capture)', async () => {
    render(<QuickCaptureView />);
    const textarea = screen.getByLabelText('闪念内容');

    fireEvent.keyDown(textarea, { key: 'Escape' });

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('hide_quick_capture', undefined);
    });
  });

  it('关闭按钮点击调用 invoke(hide_quick_capture)', async () => {
    const user = userEvent.setup();
    render(<QuickCaptureView />);
    const btn = screen.getByLabelText('关闭');

    await user.click(btn);

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('hide_quick_capture', undefined);
    });
  });

  it('window blur 事件触发 invoke(hide_quick_capture)', async () => {
    render(<QuickCaptureView />);

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('hide_quick_capture', undefined);
    });
  });
});
