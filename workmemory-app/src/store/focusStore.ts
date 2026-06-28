/**
 * 专注会话状态管理 (Zustand) - WorkMemory-v3 Task 6
 *
 * 纯前端状态机，支持 pomodoro / free 两种模式（Task 12/13 将接入后端持久化）。
 * tick() 由 store 内部 ticker（setInterval）驱动，组件卸载不影响计时推进。
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
    /** 最近一次专注会话的后端 id（Task 18 - SessionSummaryCard 数据来源） */
    lastSessionId: string | null;

    startTimer: (mode: FocusMode, durationSeconds: number, taskId?: string) => void;
    tick: () => void;
    pauseTimer: () => void;
    resumeTimer: () => void;
    stopTimer: () => void; // 标记完成
    interrupt: (reason: string) => void;
    reset: () => void;
    setLastSessionId: (id: string | null) => void;
}

// 模块级 ticker 句柄：interval id 与 UI 无关，不放入 state（不可序列化）
let tickerId: ReturnType<typeof setInterval> | null = null;

function startTicker(): void {
    if (tickerId !== null) return;
    tickerId = setInterval(() => {
        useFocusStore.getState().tick();
    }, 1000);
}

function stopTicker(): void {
    if (tickerId !== null) {
        clearInterval(tickerId);
        tickerId = null;
    }
}

export const useFocusStore = create<FocusState>((set, get) => ({
    mode: null,
    status: 'idle',
    durationSeconds: 0,
    elapsedSeconds: 0,
    taskId: null,
    interruptionReason: null,
    lastSessionId: null,

    startTimer: (mode, durationSeconds, taskId) => {
        set({
            mode,
            status: 'running',
            durationSeconds,
            elapsedSeconds: 0,
            taskId: taskId ?? null,
            interruptionReason: null,
        });
        startTicker();
    },

    setLastSessionId: (id) => {
        set({ lastSessionId: id });
    },

    tick: () => {
        const { status, elapsedSeconds, durationSeconds } = get();
        if (status !== 'running') return;
        const next = elapsedSeconds + 1;
        // 达到计划时长自动标记完成并停止 ticker
        if (durationSeconds > 0 && next >= durationSeconds) {
            set({ elapsedSeconds: durationSeconds, status: 'completed' });
            stopTicker();
        } else {
            set({ elapsedSeconds: next });
        }
    },

    pauseTimer: () => {
        if (get().status === 'running') {
            set({ status: 'paused' });
            stopTicker();
        }
    },

    resumeTimer: () => {
        if (get().status === 'paused') {
            set({ status: 'running' });
            startTicker();
        }
    },

    stopTimer: () => {
        set({ status: 'completed' });
        stopTicker();
    },

    interrupt: (reason) => {
        set({ status: 'interrupted', interruptionReason: reason });
        stopTicker();
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
        stopTicker();
    },
}));
