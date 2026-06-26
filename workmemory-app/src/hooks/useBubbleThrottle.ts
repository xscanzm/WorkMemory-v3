/**
 * 气泡频控算法 (05_INTERACTION.md §2.3)
 *
 * 维护内存状态：
 * - hourlyCount: 当前小时已推送次数
 * - dismissedCategories: 当日已关闭的类别 Set
 * - totalDismissedToday: 当日累计关闭次数
 *
 * 三条规则（严格遵循 §2.3）：
 * 1. 当日累计关闭 ≥3 次 → 当日全禁
 * 2. 当日已关闭同类 → 同类禁推
 * 3. 当前小时已推送 ≥1 次 → 每小时 ≤1 次
 *
 * 时间切换重置：
 * - resetHourly：跨小时（整点）→ hourlyCount = 0
 * - resetDaily：跨日（0 点）→ dismissedCategories 清空、totalDismissedToday = 0
 *
 * 注：6 秒淡出由调用方控制；本 hook 只负责"是否允许弹出"判定。
 */
import { useCallback, useEffect, useRef } from 'react';

export interface BubbleThrottle {
  canShowBubble: (category: string) => boolean;
  onBubbleDismissed: (category: string) => void;
}

/** 格式化为本地日期 YYYY-MM-DD */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useBubbleThrottle(): BubbleThrottle {
  // 频控计数全部使用 ref（不触发重渲染，跨渲染稳定）
  const hourlyCountRef = useRef(0);
  const dismissedCategoriesRef = useRef<Set<string>>(new Set());
  const totalDismissedTodayRef = useRef(0);

  // 跟踪上一次检查的小时与日期，用于检测时间切换
  const lastHourRef = useRef<number>(new Date().getHours());
  const lastDateRef = useRef<string>(formatLocalDate(new Date()));

  /** 跨小时重置：hourlyCount = 0 */
  const resetHourly = useCallback(() => {
    hourlyCountRef.current = 0;
  }, []);

  /** 跨日重置：清空 dismissedCategories、totalDismissedToday = 0 */
  const resetDaily = useCallback(() => {
    dismissedCategoriesRef.current = new Set();
    totalDismissedTodayRef.current = 0;
  }, []);

  // 每分钟检查一次是否跨小时 / 跨日
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const hour = now.getHours();
      const dateStr = formatLocalDate(now);

      if (hour !== lastHourRef.current) {
        resetHourly();
        lastHourRef.current = hour;
      }
      if (dateStr !== lastDateRef.current) {
        resetDaily();
        lastDateRef.current = dateStr;
      }
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, [resetHourly, resetDaily]);

  /**
   * 判定某类气泡是否可以弹出。
   * 通过时同时累加 hourlyCount（占用本小时额度）。
   */
  const canShowBubble = useCallback((category: string): boolean => {
    // 1. 当日累计关闭 ≥3 次 → 当日全禁
    if (totalDismissedTodayRef.current >= 3) return false;
    // 2. 当日已关闭同类 → 同类禁推
    if (dismissedCategoriesRef.current.has(category)) return false;
    // 3. 当前小时已推送 ≥1 次 → 每小时 ≤1 次
    if (hourlyCountRef.current >= 1) return false;
    // 占用本小时额度
    hourlyCountRef.current += 1;
    return true;
  }, []);

  /**
   * 用户主动 × 关闭气泡时调用：
   * - 该类别加入 dismissedCategories（当日同类禁推）
   * - totalDismissedToday++（累加当日关闭次数）
   * - hourlyCount 不变（关闭不退还小时额度）
   */
  const onBubbleDismissed = useCallback((category: string) => {
    dismissedCategoriesRef.current.add(category);
    totalDismissedTodayRef.current += 1;
  }, []);

  return { canShowBubble, onBubbleDismissed };
}

export default useBubbleThrottle;
