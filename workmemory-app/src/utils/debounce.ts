/**
 * 通用防抖工具
 * 严格遵循审计意见 2.2：高频 IPC 接口 300ms 防抖
 */

import { useEffect, useRef, useState } from 'react';

/** 防抖 hook：返回防抖后的值 */
export function useDebouncedValue<T>(value: T, delayMs: number = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}

/** 防抖回调 hook：返回防抖后的回调函数 */
export function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delayMs: number = 300,
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return ((...args: Parameters<T>) => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => callbackRef.current(...args), delayMs);
  }) as T;
}

/** 纯函数防抖（非 hook 版本，用于非组件场景） */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number = 300,
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = ((...args: Parameters<T>) => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delayMs);
  }) as T & { cancel: () => void };

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}
