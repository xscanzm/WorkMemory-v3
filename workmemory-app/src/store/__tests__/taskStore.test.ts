import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTaskStore, type Task } from '../taskStore';
import { useToastStore } from '../toastStore';

// taskStore 通过 `import { invoke } from '../src-tauri/api'` 调用 IPC，
// 这里 mock invoke 以模拟成功/失败场景（审计意见 2.3 回滚测试）。
// vi.mock 工厂会被提升到文件顶部，因此用 vi.hoisted 声明 mock 以确保可访问。
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('../../src-tauri/api', () => ({
  invoke: invokeMock,
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '1',
    title: 'original',
    description: '',
    status: 'inbox',
    priority: 'none',
    dueDate: null,
    moodTag: null,
    recurrenceRule: null,
    isPinned: false,
    sortOrder: 0,
    subtasks: [],
    category: '',
    tags: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('taskStore 乐观更新回滚 (审计意见 2.3)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useTaskStore.setState({ tasks: [], isLoading: false });
    useToastStore.setState({ toasts: [] });
    // toast.error 内部使用 setTimeout(3000) 自动消失，使用 fake timers 避免泄漏
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('updateTask 失败时回滚到 prevState', async () => {
    const original = makeTask({ id: '1', title: 'original' });
    useTaskStore.setState({ tasks: [original] });

    invokeMock.mockRejectedValueOnce(new Error('IPC failed'));

    const mutated = makeTask({ id: '1', title: 'mutated' });
    const ok = await useTaskStore.getState().updateTask(mutated);

    expect(ok).toBe(false);
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    // 回滚后 title 应恢复为 original
    expect(useTaskStore.getState().tasks[0].title).toBe('original');
  });

  it('updateTask 成功时保留乐观更新结果', async () => {
    const original = makeTask({ id: '1', title: 'original' });
    useTaskStore.setState({ tasks: [original] });

    invokeMock.mockResolvedValueOnce(undefined);

    const updated = makeTask({ id: '1', title: 'updated' });
    const ok = await useTaskStore.getState().updateTask(updated);

    expect(ok).toBe(true);
    expect(useTaskStore.getState().tasks[0].title).toBe('updated');
  });

  it('updateTask 失败时不影响其他任务', async () => {
    const t1 = makeTask({ id: '1', title: 'task1' });
    const t2 = makeTask({ id: '2', title: 'task2' });
    useTaskStore.setState({ tasks: [t1, t2] });

    invokeMock.mockRejectedValueOnce(new Error('IPC failed'));

    await useTaskStore.getState().updateTask(makeTask({ id: '1', title: 'mutated' }));

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe('task1');
    expect(tasks[1].title).toBe('task2');
  });

  it('deleteTask 失败时回滚到 prevState', async () => {
    const t1 = makeTask({ id: '1', title: 'task1' });
    const t2 = makeTask({ id: '2', title: 'task2' });
    useTaskStore.setState({ tasks: [t1, t2] });

    invokeMock.mockRejectedValueOnce(new Error('IPC failed'));

    const ok = await useTaskStore.getState().deleteTask('1');

    expect(ok).toBe(false);
    // 回滚后被删除的任务应恢复
    expect(useTaskStore.getState().tasks).toHaveLength(2);
    expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(['1', '2']);
  });

  it('deleteTask 成功时移除任务', async () => {
    const t1 = makeTask({ id: '1', title: 'task1' });
    const t2 = makeTask({ id: '2', title: 'task2' });
    useTaskStore.setState({ tasks: [t1, t2] });

    invokeMock.mockResolvedValueOnce(undefined);

    const ok = await useTaskStore.getState().deleteTask('1');

    expect(ok).toBe(true);
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTaskStore.getState().tasks[0].id).toBe('2');
  });

  it('updateTask 失败时触发 toast.error 提示', async () => {
    const original = makeTask({ id: '1', title: 'original' });
    useTaskStore.setState({ tasks: [original] });

    invokeMock.mockRejectedValueOnce(new Error('IPC failed'));

    await useTaskStore.getState().updateTask(makeTask({ id: '1', title: 'mutated' }));

    // toast.error 经由 useToastStore 注入到 toasts 列表
    const errorToasts = useToastStore
      .getState()
      .toasts.filter((t) => t.type === 'error');
    expect(errorToasts.length).toBeGreaterThan(0);
    expect(errorToasts.some((t) => t.message.includes('回滚'))).toBe(true);
  });
});
