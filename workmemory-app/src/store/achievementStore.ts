/**
 * 成就解锁全局状态 (Zustand) - audit-v4-hardening Task 17.3
 *
 * 监听后端 `achievement-unlocked` Tauri 事件，持有最新一条待展示的解锁成就：
 *   - `pendingUnlock`：当前等待弹窗展示的解锁成就（null 表示无）
 *   - `setPendingUnlock`：事件到达时写入；多条到达则排队（这里简化为只保留最新一条，
 *     App 挂载一次 initAchievementListener 即订阅事件）
 *   - `clearPendingUnlock`：弹窗关闭时调用，清空 state
 *
 * 设计要点（Task 17.3 "取代普通 Toast"）：
 *   - 成就解锁通知走专属 `AchievementUnlockModal` 弹窗，**不再** 走 `toastStore` 的普通 toast。
 *   - 因此 HomeView 等调用 `recalculate_achievements` 的地方无需额外 toast，
 *     后端 emit 事件 → 本 store 接收 → Modal 展示，单一通知通道。
 */
import { create } from 'zustand';
import { listen } from '@/src-tauri/api';

/** 成就稀有度（与后端 AchievementRarity serde lowercase 对齐） */
export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

/** 解锁成就 DTO（与后端 UnlockedAchievementPayload camelCase 对齐） */
export interface UnlockedAchievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  rarity: AchievementRarity;
  unlockedAt: string;
  xpReward?: number;
}

interface AchievementState {
  /** 当前等待弹窗展示的解锁成就；null 时弹窗不渲染 */
  pendingUnlock: UnlockedAchievement | null;
  /** 写入待展示成就（事件到达时调用） */
  setPendingUnlock: (a: UnlockedAchievement) => void;
  /** 清空待展示成就（弹窗关闭时调用） */
  clearPendingUnlock: () => void;
}

export const useAchievementStore = create<AchievementState>((set) => ({
  pendingUnlock: null,
  setPendingUnlock: (a) => set({ pendingUnlock: a }),
  clearPendingUnlock: () => set({ pendingUnlock: null }),
}));

/** 已注册事件监听标志，避免重复订阅 */
let listenerRegistered = false;
let unlistenFn: (() => void) | null = null;

/**
 * 初始化 `achievement-unlocked` 事件监听（App 挂载时调用一次）。
 *
 * 事件 payload 形如 `{ id, title, description, icon, rarity, unlockedAt, xpReward }`，
 * 到达后写入 `pendingUnlock`，由 `AchievementUnlockModal` 订阅渲染。
 * 重复调用安全：已注册时直接返回。
 */
export async function initAchievementListener(): Promise<void> {
  if (listenerRegistered) return;
  listenerRegistered = true;
  try {
    unlistenFn = await listen('achievement-unlocked', (payload: unknown) => {
      const a = payload as UnlockedAchievement;
      if (!a || typeof a.id !== 'string') return;
      useAchievementStore.getState().setPendingUnlock(a);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[achievementStore] 监听 achievement-unlocked 失败', err);
    listenerRegistered = false;
  }
}

/** 仅测试用：重置监听注册标志与 store 状态 */
export function __resetAchievementStoreForTest(): void {
  if (unlistenFn) {
    unlistenFn();
    unlistenFn = null;
  }
  listenerRegistered = false;
  useAchievementStore.setState({ pendingUnlock: null });
}
