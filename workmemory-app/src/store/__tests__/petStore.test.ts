import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePetStore, type PetState } from '../petStore';
import { useToastStore } from '../toastStore';

// petStore 宠物状态与乐观更新回滚测试 - audit-v4-hardening Task 8 (审计意见 2.3)
// petStore 通过 `import { invoke } from '../src-tauri/api'` 调用 IPC，
// 这里 mock invoke 以模拟成功/失败场景。toast 经由 useToastStore 注入，
// 用 fake timers 避免 toast 的 setTimeout(3000) 跨用例泄漏。
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('../../src-tauri/api', () => ({
  invoke: invokeMock,
}));

function makePet(overrides: Partial<PetState> = {}): PetState {
  return {
    id: 'pet-1',
    species: 'cat',
    level: 1,
    xp: 0,
    hunger: 50,
    energy: 50,
    happiness: 50,
    cleanliness: 50,
    bondLevel: 1,
    mood: 'happy',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('petStore 宠物状态与回滚 (审计意见 2.3)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    usePetStore.setState({
      petState: null,
      isLoading: false,
      levelupSignal: 0,
    });
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('feed 成功后更新 petState', async () => {
    const prev = makePet({ hunger: 50 });
    usePetStore.setState({ petState: prev });
    const next = makePet({ hunger: 80 });
    invokeMock.mockResolvedValueOnce(next);

    await usePetStore.getState().feed();

    expect(usePetStore.getState().petState).toEqual(next);
  });

  it('feed 失败后回滚到 prevState 并 toast.error', async () => {
    const prev = makePet({ hunger: 50 });
    usePetStore.setState({ petState: prev });
    invokeMock.mockRejectedValueOnce(new Error('IPC failed'));

    await usePetStore.getState().feed();

    expect(usePetStore.getState().petState).toEqual(prev);
    const errorToasts = useToastStore
      .getState()
      .toasts.filter((t) => t.type === 'error');
    expect(errorToasts.length).toBeGreaterThan(0);
    expect(errorToasts.some((t) => t.message.includes('回滚'))).toBe(true);
  });

  it('play 成功后更新 petState', async () => {
    usePetStore.setState({ petState: makePet({ happiness: 50 }) });
    const next = makePet({ happiness: 70 });
    invokeMock.mockResolvedValueOnce(next);

    await usePetStore.getState().play();

    expect(usePetStore.getState().petState).toEqual(next);
  });

  it('rest 成功后更新 petState', async () => {
    usePetStore.setState({ petState: makePet({ energy: 30 }) });
    const next = makePet({ energy: 90 });
    invokeMock.mockResolvedValueOnce(next);

    await usePetStore.getState().rest();

    expect(usePetStore.getState().petState).toEqual(next);
  });

  it('clean 成功后更新 petState', async () => {
    usePetStore.setState({ petState: makePet({ cleanliness: 20 }) });
    const next = makePet({ cleanliness: 100 });
    invokeMock.mockResolvedValueOnce(next);

    await usePetStore.getState().clean();

    expect(usePetStore.getState().petState).toEqual(next);
  });

  it('play/rest/clean 失败后均回滚到 prevState', async () => {
    const prev = makePet();
    usePetStore.setState({ petState: prev });
    invokeMock.mockRejectedValue(new Error('IPC failed'));

    await usePetStore.getState().play();
    expect(usePetStore.getState().petState).toEqual(prev);
    await usePetStore.getState().rest();
    expect(usePetStore.getState().petState).toEqual(prev);
    await usePetStore.getState().clean();
    expect(usePetStore.getState().petState).toEqual(prev);
  });

  it('多次操作后状态累积为最新后端返回', async () => {
    usePetStore.setState({ petState: makePet({ hunger: 10 }) });
    invokeMock.mockResolvedValueOnce(makePet({ hunger: 30 }));
    await usePetStore.getState().feed();
    invokeMock.mockResolvedValueOnce(makePet({ hunger: 60 }));
    await usePetStore.getState().feed();
    invokeMock.mockResolvedValueOnce(makePet({ hunger: 90 }));
    await usePetStore.getState().feed();

    expect(usePetStore.getState().petState?.hunger).toBe(90);
  });

  it('边界：后端返回 0/100 极值时原样反映（不在前端二次夹紧）', async () => {
    usePetStore.setState({ petState: makePet({ hunger: 50 }) });

    invokeMock.mockResolvedValueOnce(
      makePet({ hunger: 100, energy: 100, happiness: 100, cleanliness: 100 }),
    );
    await usePetStore.getState().feed();
    const upper = usePetStore.getState().petState!;
    expect(upper.hunger).toBe(100);
    expect(upper.energy).toBe(100);
    expect(upper.happiness).toBe(100);
    expect(upper.cleanliness).toBe(100);

    invokeMock.mockResolvedValueOnce(
      makePet({ hunger: 0, energy: 0, happiness: 0, cleanliness: 0 }),
    );
    await usePetStore.getState().feed();
    const lower = usePetStore.getState().petState!;
    expect(lower.hunger).toBe(0);
    expect(lower.energy).toBe(0);
  });

  it('检测到 level 升级时递增 levelupSignal 并 toast 升级提示 (Task 23.3)', async () => {
    usePetStore.setState({ petState: makePet({ level: 1 }), levelupSignal: 0 });
    invokeMock.mockResolvedValueOnce(makePet({ level: 2 }));

    await usePetStore.getState().feed();

    expect(usePetStore.getState().levelupSignal).toBe(1);
    expect(usePetStore.getState().petState?.level).toBe(2);
    const successToasts = useToastStore
      .getState()
      .toasts.filter((t) => t.type === 'success');
    expect(successToasts.some((t) => t.message.includes('升级'))).toBe(true);
  });

  it('level 未变化时不递增 levelupSignal', async () => {
    usePetStore.setState({ petState: makePet({ level: 3 }), levelupSignal: 0 });
    invokeMock.mockResolvedValueOnce(makePet({ level: 3 }));

    await usePetStore.getState().feed();

    expect(usePetStore.getState().levelupSignal).toBe(0);
  });

  it('loadPetState 成功后加载 petState', async () => {
    const pet = makePet({ hunger: 42 });
    invokeMock.mockResolvedValueOnce(pet);

    await usePetStore.getState().loadPetState();

    expect(usePetStore.getState().petState).toEqual(pet);
    expect(usePetStore.getState().isLoading).toBe(false);
  });

  it('loadPetState 在宠物未初始化（NotFound）时静默保持 null', async () => {
    invokeMock.mockRejectedValueOnce(new Error('NotFound'));
    usePetStore.setState({ petState: null });

    await usePetStore.getState().loadPetState();

    expect(usePetStore.getState().petState).toBeNull();
    expect(usePetStore.getState().isLoading).toBe(false);
    expect(
      useToastStore.getState().toasts.filter((t) => t.type === 'error'),
    ).toHaveLength(0);
  });
});
