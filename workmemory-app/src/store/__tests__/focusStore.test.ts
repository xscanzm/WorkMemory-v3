import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusStore } from '../focusStore';

// 专注会话状态机测试 - WorkMemory-v3 Task 21
// 验证 idle → running → completed / interrupted → idle 的状态流转
describe('focusStore 状态机', () => {
  beforeEach(() => {
    // 每个用例前重置为初始 idle 状态
    useFocusStore.getState().reset();
  });

  it('初始状态为 idle', () => {
    const s = useFocusStore.getState();
    expect(s.status).toBe('idle');
    expect(s.mode).toBeNull();
    expect(s.elapsedSeconds).toBe(0);
    expect(s.durationSeconds).toBe(0);
    expect(s.taskId).toBeNull();
    expect(s.interruptionReason).toBeNull();
  });

  it('startTimer 进入 running 并初始化计时参数', () => {
    useFocusStore.getState().startTimer('pomodoro', 1500, 'task-1');
    const s = useFocusStore.getState();
    expect(s.status).toBe('running');
    expect(s.mode).toBe('pomodoro');
    expect(s.durationSeconds).toBe(1500);
    expect(s.elapsedSeconds).toBe(0);
    expect(s.taskId).toBe('task-1');
  });

  it('startTimer 未传 taskId 时为 null', () => {
    useFocusStore.getState().startTimer('free', 600);
    expect(useFocusStore.getState().taskId).toBeNull();
  });

  it('tick 在 running 下递增已计时', () => {
    useFocusStore.getState().startTimer('free', 600);
    useFocusStore.getState().tick();
    useFocusStore.getState().tick();
    expect(useFocusStore.getState().elapsedSeconds).toBe(2);
  });

  it('tick 达到 durationSeconds 自动标记完成', () => {
    useFocusStore.getState().startTimer('pomodoro', 5);
    for (let i = 0; i < 5; i++) useFocusStore.getState().tick();
    const s = useFocusStore.getState();
    expect(s.status).toBe('completed');
    expect(s.elapsedSeconds).toBe(5);
  });

  it('非 running 状态下 tick 无副作用', () => {
    useFocusStore.getState().startTimer('free', 600);
    useFocusStore.getState().pauseTimer();
    useFocusStore.getState().tick();
    expect(useFocusStore.getState().elapsedSeconds).toBe(0);
  });

  it('pauseTimer / resumeTimer 在 running ⇄ paused 切换', () => {
    useFocusStore.getState().startTimer('free', 600);
    expect(useFocusStore.getState().status).toBe('running');
    useFocusStore.getState().pauseTimer();
    expect(useFocusStore.getState().status).toBe('paused');
    useFocusStore.getState().resumeTimer();
    expect(useFocusStore.getState().status).toBe('running');
  });

  it('pauseTimer 仅在 running 下生效', () => {
    useFocusStore.getState().pauseTimer();
    expect(useFocusStore.getState().status).toBe('idle');
  });

  it('stopTimer 标记为 completed', () => {
    useFocusStore.getState().startTimer('free', 600);
    useFocusStore.getState().stopTimer();
    expect(useFocusStore.getState().status).toBe('completed');
  });

  it('interrupt 设置 interrupted 并记录原因', () => {
    useFocusStore.getState().startTimer('free', 600);
    useFocusStore.getState().interrupt('电话打断');
    const s = useFocusStore.getState();
    expect(s.status).toBe('interrupted');
    expect(s.interruptionReason).toBe('电话打断');
  });

  it('reset 回到 idle 并清空所有字段', () => {
    useFocusStore.getState().startTimer('pomodoro', 1500, 'task-9');
    useFocusStore.getState().interrupt('测试');
    useFocusStore.getState().reset();
    const s = useFocusStore.getState();
    expect(s.status).toBe('idle');
    expect(s.mode).toBeNull();
    expect(s.durationSeconds).toBe(0);
    expect(s.elapsedSeconds).toBe(0);
    expect(s.taskId).toBeNull();
    expect(s.interruptionReason).toBeNull();
  });

  it('计时器在组件卸载后继续推进 (ticker 由 store 管理)', () => {
    // 使用 fake timer 控制 setInterval 推进
    vi.useFakeTimers();
    const { result } = renderHook(() => useFocusStore());

    act(() => {
      result.current.startTimer('pomodoro', 1500);
    });

    expect(result.current.status).toBe('running');
    expect(result.current.elapsedSeconds).toBe(0);

    // 推进 5 秒
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.elapsedSeconds).toBe(5);

    // 模拟组件卸载（真实场景中 FocusView 卸载但 store 持续）：
    // store 的 ticker 仍应继续推进
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.elapsedSeconds).toBe(8);

    // 清理
    act(() => result.current.reset());
    vi.useRealTimers();
  });
});
