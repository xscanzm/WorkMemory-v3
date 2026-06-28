/**
 * CommandPalette 测试 - audit-v4-hardening Task 11
 *
 * 覆盖：
 *   - 默认不渲染（关闭状态）
 *   - 'open-command-palette' 事件唤出
 *   - 输入查询时显示快速操作和视图切换
 *   - ↑↓ 键切换选中项
 *   - Esc 关闭
 *   - 点击视图切换项触发 navigate
 *
 * Mock：
 *   - `@tauri-apps/api/core` 的 invoke（避免真实 IPC 调用）
 *   - `react-router-dom` 的 useNavigate（避免 Router 上下文依赖）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

// vi.mock 工厂会被提升到文件顶部，因此用 vi.hoisted 声明 mock 以确保可访问。
const { mockInvoke, mockNavigate } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import CommandPalette from '../CommandPalette';

describe('CommandPalette 命令面板', () => {
  beforeEach(() => {
    cleanup();
    mockInvoke.mockReset();
    mockNavigate.mockReset();
    // search_memories IPC 默认返回空数组（避免未处理 Promise 干扰测试）
    mockInvoke.mockResolvedValue([]);
  });

  it('默认不渲染（关闭状态）', () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog', { name: '命令面板' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('命令搜索')).not.toBeInTheDocument();
  });

  it('接收 open-command-palette 事件后打开', () => {
    render(<CommandPalette />);
    act(() => {
      window.dispatchEvent(new CustomEvent('open-command-palette'));
    });
    expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument();
    expect(screen.getByLabelText('命令搜索')).toBeInTheDocument();
  });

  it('打开后显示快速操作、视图切换、系统指令三个分组', () => {
    render(<CommandPalette />);
    act(() => {
      window.dispatchEvent(new CustomEvent('open-command-palette'));
    });
    expect(screen.getByText('快速操作')).toBeInTheDocument();
    expect(screen.getByText('视图切换')).toBeInTheDocument();
    expect(screen.getByText('系统指令')).toBeInTheDocument();
    // 快速操作项
    expect(screen.getByText('新建任务')).toBeInTheDocument();
    // 视图切换项
    expect(screen.getByText('跳转到今日')).toBeInTheDocument();
    // 系统指令项
    expect(screen.getByText('导出数据')).toBeInTheDocument();
  });

  it('输入查询时显示匹配的快速操作和视图切换', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    act(() => {
      window.dispatchEvent(new CustomEvent('open-command-palette'));
    });
    const input = screen.getByLabelText('命令搜索');
    await user.type(input, '任务');
    // "任务" 应同时匹配快速操作"新建任务"和视图切换"跳转到任务"
    // 命中字符会被 <mark> 高亮包裹导致 text 节点分裂，用 getByRole + name 正则匹配
    expect(screen.getByRole('option', { name: /新建任务/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /跳转到任务/ })).toBeInTheDocument();
  });

  it('↑↓ 键切换选中项', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    act(() => {
      window.dispatchEvent(new CustomEvent('open-command-palette'));
    });
    const input = screen.getByLabelText('命令搜索');
    input.focus();

    // 初始选中第 0 项（新建任务）
    const firstItem = screen.getByText('新建任务').closest('[role="option"]');
    expect(firstItem).toHaveAttribute('aria-selected', 'true');

    // 按 ↓ 切换到第 1 项，第 0 项取消选中
    await user.keyboard('{ArrowDown}');
    expect(firstItem).toHaveAttribute('aria-selected', 'false');

    // 按 ↑ 切回第 0 项，重新选中
    await user.keyboard('{ArrowUp}');
    expect(firstItem).toHaveAttribute('aria-selected', 'true');
  });

  it('Esc 关闭面板', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    act(() => {
      window.dispatchEvent(new CustomEvent('open-command-palette'));
    });
    expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument();

    const input = screen.getByLabelText('命令搜索');
    input.focus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: '命令面板' })).not.toBeInTheDocument();
  });

  it('点击视图切换项触发 navigate 并关闭面板', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    act(() => {
      window.dispatchEvent(new CustomEvent('open-command-palette'));
    });
    const item = screen.getByText('跳转到今日');
    await user.click(item);

    expect(mockNavigate).toHaveBeenCalledWith('/today');
    expect(screen.queryByRole('dialog', { name: '命令面板' })).not.toBeInTheDocument();
  });

  it('点击快速操作项派发对应事件并 navigate', async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    window.addEventListener('quick-new-task', handler);

    render(<CommandPalette />);
    act(() => {
      window.dispatchEvent(new CustomEvent('open-command-palette'));
    });
    const item = screen.getByText('新建任务');
    await user.click(item);

    expect(mockNavigate).toHaveBeenCalledWith('/tasks');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '命令面板' })).not.toBeInTheDocument();

    window.removeEventListener('quick-new-task', handler);
  });
});
