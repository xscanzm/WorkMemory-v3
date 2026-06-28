/**
 * TasksView 批量多选测试 - audit-v4-hardening Task 21 (optional)
 *
 * 覆盖：
 *   - Ctrl+Click toggle 单个选中 → BatchToolbar 显示"已选 N 项"
 *   - Shift+Click 范围选择（从上次点击项到当前项）
 *   - 点击"批量完成"触发 invoke('batch_update_tasks', { completed: true })
 *   - 点击"清空选择"清空 selectedIds
 *   - 全选复选框选中所有任务
 *
 * Mock：
 *   - `@tauri-apps/api/core` 的 invoke（避免真实 IPC 调用）
 *   - test/setup.ts 已定义 window.__TAURI_INTERNALS__ 使 api.isTauri() 返回 true
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// vi.mock 工厂会被提升到文件顶部，因此用 vi.hoisted 声明 mock 以确保可访问。
const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

import TasksView from '../TasksView';
import type { Task } from '../../store/taskStore';

// 构造 3 条测试任务
function makeTask(id: string, title: string): Task {
  return {
    id,
    title,
    description: '',
    status: 'todo',
    priority: 'none',
    dueDate: null,
    moodTag: null,
    recurrenceRule: null,
    isPinned: false,
    sortOrder: 0,
    subtasks: [],
    category: '',
    tags: [],
    createdAt: '2026-06-28T10:00:00+08:00',
    updatedAt: '2026-06-28T10:00:00+08:00',
  };
}

const MOCK_TASKS: Task[] = [
  makeTask('task-001', '任务 Alpha'),
  makeTask('task-002', '任务 Beta'),
  makeTask('task-003', '任务 Gamma'),
];

describe('TasksView 批量多选 (Task 21)', () => {
  beforeEach(() => {
    cleanup();
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'get_all_tasks') return Promise.resolve(MOCK_TASKS);
      if (cmd === 'batch_update_tasks' || cmd === 'batch_delete_tasks') {
        const ids = args?.taskIds;
        return Promise.resolve(Array.isArray(ids) ? ids.length : 0);
      }
      return Promise.resolve(undefined);
    });
  });

  it('Ctrl+Click toggle 单个选中后显示 BatchToolbar "已选 1 项"', async () => {
    render(<TasksView />);

    // 等待任务加载
    const firstTask = await screen.findByText('任务 Alpha');
    expect(firstTask).toBeInTheDocument();

    // 初始无 BatchToolbar
    expect(screen.queryByTestId('batch-selected-count')).not.toBeInTheDocument();

    // Ctrl+Click 第一条任务
    fireEvent.click(firstTask, { ctrlKey: true });

    // BatchToolbar 出现，显示"已选 1 项"
    await waitFor(() => {
      expect(screen.getByTestId('batch-selected-count')).toHaveTextContent(
        '已选 1 项',
      );
    });
  });

  it('Shift+Click 范围选择（从第一项到第三项全选）', async () => {
    render(<TasksView />);

    const firstTask = await screen.findByText('任务 Alpha');
    // 先 Ctrl+Click 第一项作为锚点
    fireEvent.click(firstTask, { ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByTestId('batch-selected-count')).toHaveTextContent(
        '已选 1 项',
      );
    });

    // Shift+Click 第三项 → 范围选择 1-3
    const thirdTask = await screen.findByText('任务 Gamma');
    fireEvent.click(thirdTask, { shiftKey: true });

    await waitFor(() => {
      expect(screen.getByTestId('batch-selected-count')).toHaveTextContent(
        '已选 3 项',
      );
    });
  });

  it('点击"批量完成"触发 invoke(batch_update_tasks, { completed: true })', async () => {
    render(<TasksView />);

    const firstTask = await screen.findByText('任务 Alpha');
    fireEvent.click(firstTask, { ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByTestId('batch-selected-count')).toBeInTheDocument();
    });

    // 点击"批量完成"按钮
    const completeBtn = screen.getByRole('button', { name: '批量完成' });
    fireEvent.click(completeBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'batch_update_tasks',
        expect.objectContaining({
          taskIds: expect.arrayContaining(['task-001']),
          updates: expect.objectContaining({ completed: true }),
        }),
      );
    });
  });

  it('点击"清空选择"清空 selectedIds 并隐藏 BatchToolbar', async () => {
    render(<TasksView />);

    const firstTask = await screen.findByText('任务 Alpha');
    fireEvent.click(firstTask, { ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByTestId('batch-selected-count')).toBeInTheDocument();
    });

    // 点击清空按钮
    fireEvent.click(screen.getByRole('button', { name: '清空选择' }));

    await waitFor(() => {
      expect(screen.queryByTestId('batch-selected-count')).not.toBeInTheDocument();
    });
  });

  it('全选复选框选中所有任务后显示"已选 3 项"', async () => {
    render(<TasksView />);

    const firstTask = await screen.findByText('任务 Alpha');
    fireEvent.click(firstTask, { ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByTestId('batch-selected-count')).toBeInTheDocument();
    });

    // 点击全选复选框
    const checkbox = screen.getByLabelText('全选或取消全选');
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.getByTestId('batch-selected-count')).toHaveTextContent(
        '已选 3 项',
      );
    });
  });

  it('点击"批量删除"弹出二次确认对话框', async () => {
    render(<TasksView />);

    const firstTask = await screen.findByText('任务 Alpha');
    fireEvent.click(firstTask, { ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByTestId('batch-selected-count')).toBeInTheDocument();
    });

    // 点击"批量删除"按钮 → 应弹出 ConfirmDialog
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }));

    await waitFor(() => {
      expect(screen.getByText('批量删除任务')).toBeInTheDocument();
    });
  });
});
