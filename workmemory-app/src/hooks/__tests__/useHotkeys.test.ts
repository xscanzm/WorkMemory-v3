import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHotkeys, useHotkeyEvent } from '../useHotkeys';

// 全局快捷键监听矩阵测试 - audit-v4-hardening Task 13
// 覆盖 Ctrl+K/N/S/F + Esc 派发事件、macOS Cmd 兼容、单独修饰键不触发、卸载清理
describe('useHotkeys 全局快捷键监听矩阵', () => {
  it('Ctrl+K 派发 open-command-palette 事件并 preventDefault', () => {
    const handler = vi.fn();
    window.addEventListener('open-command-palette', handler);
    const { unmount } = renderHook(() => useHotkeys());

    const event = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: 'k',
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    window.removeEventListener('open-command-palette', handler);
    unmount();
  });

  it('Ctrl+N 派发 quick-new-task 事件并 preventDefault', () => {
    const handler = vi.fn();
    window.addEventListener('quick-new-task', handler);
    const { unmount } = renderHook(() => useHotkeys());

    const event = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: 'n',
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    window.removeEventListener('quick-new-task', handler);
    unmount();
  });

  it('Ctrl+F 派发 focus-search 事件并 preventDefault', () => {
    const handler = vi.fn();
    window.addEventListener('focus-search', handler);
    const { unmount } = renderHook(() => useHotkeys());

    const event = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: 'f',
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    window.removeEventListener('focus-search', handler);
    unmount();
  });

  it('Ctrl+S 在 INPUT 内仍派发 save-current 事件并 preventDefault', () => {
    const handler = vi.fn();
    window.addEventListener('save-current', handler);
    const { unmount } = renderHook(() => useHotkeys());

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: 's',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    window.removeEventListener('save-current', handler);
    document.body.removeChild(input);
    unmount();
  });

  it('Esc 派发 close-modal 事件', () => {
    const handler = vi.fn();
    window.addEventListener('close-modal', handler);
    const { unmount } = renderHook(() => useHotkeys());

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener('close-modal', handler);
    unmount();
  });

  it('macOS Cmd+K 也派发 open-command-palette', () => {
    const handler = vi.fn();
    window.addEventListener('open-command-palette', handler);
    const { unmount } = renderHook(() => useHotkeys());

    const event = new KeyboardEvent('keydown', {
      metaKey: true,
      key: 'k',
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    window.removeEventListener('open-command-palette', handler);
    unmount();
  });

  it('单独按下 Ctrl（无其他键）不触发任何事件', () => {
    const paletteHandler = vi.fn();
    const newTaskHandler = vi.fn();
    const saveHandler = vi.fn();
    const searchHandler = vi.fn();
    const closeModalHandler = vi.fn();

    window.addEventListener('open-command-palette', paletteHandler);
    window.addEventListener('quick-new-task', newTaskHandler);
    window.addEventListener('save-current', saveHandler);
    window.addEventListener('focus-search', searchHandler);
    window.addEventListener('close-modal', closeModalHandler);

    const { unmount } = renderHook(() => useHotkeys());

    window.dispatchEvent(
      new KeyboardEvent('keydown', { ctrlKey: true, key: 'Control', cancelable: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', { metaKey: true, key: 'Meta', cancelable: true }),
    );

    expect(paletteHandler).not.toHaveBeenCalled();
    expect(newTaskHandler).not.toHaveBeenCalled();
    expect(saveHandler).not.toHaveBeenCalled();
    expect(searchHandler).not.toHaveBeenCalled();
    expect(closeModalHandler).not.toHaveBeenCalled();

    window.removeEventListener('open-command-palette', paletteHandler);
    window.removeEventListener('quick-new-task', newTaskHandler);
    window.removeEventListener('save-current', saveHandler);
    window.removeEventListener('focus-search', searchHandler);
    window.removeEventListener('close-modal', closeModalHandler);
    unmount();
  });

  it('组件卸载后移除监听器', () => {
    const handler = vi.fn();
    window.addEventListener('open-command-palette', handler);
    const { unmount } = renderHook(() => useHotkeys());

    unmount();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { ctrlKey: true, key: 'k', cancelable: true }),
    );
    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener('open-command-palette', handler);
  });

  it('useHotkeyEvent 辅助 hook 订阅事件并在卸载时清理', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useHotkeyEvent('open-command-palette', handler),
    );

    window.dispatchEvent(new CustomEvent('open-command-palette'));
    expect(handler).toHaveBeenCalledTimes(1);

    unmount();

    window.dispatchEvent(new CustomEvent('open-command-palette'));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
