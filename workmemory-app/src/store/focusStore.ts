/**
 * 专注会话状态管理 (Zustand) - WorkMemory-v3 Task 6
 *
 * 纯前端状态机，支持 pomodoro / free 两种模式（Task 12/13 将接入后端持久化）。
 * tick() 由 FocusView 组件的 setInterval 驱动（Task 13）。
 *
 * 状态流转：
 *   idle → running → (paused ⇄ running) → completed / interrupted → idle(reset)
 */
import { create } from 'zustand';

type FocusMode = 'pomodoro' | 'free';
type FocusStatus = 'idle' | 'running' | 'paused' | 'completed' | 'interrupted';

interface FocusState {
    mode: FocusMode | null;
    status: FocusStatus;
    durationSeconds: number; // 计划总时长
    elapsedSeconds: number;  // 已计时
    taskId: string | null;
    interruptionReason: string | null;

    startTimer: (mode: FocusMode, durationSeconds: number, taskId?: string) => void;
    tick: () => void;
    pauseTimer: () => void;
    resumeTimer: () => void;
    stopTimer: () => void; // 标记完成
    interrupt: (reason: string) => void;
    reset: () => void;
}

export const useFocusStore = create<FocusState>((set, get) => ({
    mode: null,
    status: 'idle',
    durationSeconds: 0,
    elapsedSeconds: 0,
    taskId: null,
    interruptionReason: null,

    startTimer: (mode, durationSeconds, taskId) => {
        set({
            mode,
            status: 'running',
            durationSeconds,
            elapsedSeconds: 0,
            taskId: taskId ?? null,
            interruptionReason: null,
        });
    },

    tick: () => {
        const { status, elapsedSeconds, durationSeconds } = get();
        if (status !== 'running') return;
        const next = elapsedSeconds + 1;
        // 达到计划时长自动标记完成
        if (durationSeconds > 0 && next >= durationSeconds) {
            set({ elapsedSeconds: durationSeconds, status: 'completed' });
        } else {
            set({ elapsedSeconds: next });
        }
    },

    pauseTimer: () => {
        if (get().status === 'running') {
            set({ status: 'paused' });
        }
    },

    resumeTimer: () => {
        if (get().status === 'paused') {
            set({ status: 'running' });
        }
    },

    stopTimer: () => {
        set({ status: 'completed' });
    },

    interrupt: (reason) => {
        set({ status: 'interrupted', interruptionReason: reason });
    },

    reset: () => {
        set({
            mode: null,
            status: 'idle',
            durationSeconds: 0,
            elapsedSeconds: 0,
            taskId: null,
            interruptionReason: null,
        });
    },
}));
