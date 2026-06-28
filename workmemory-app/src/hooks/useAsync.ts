/**
 * 轻量异步数据获取 hook
 * 严格遵循审计意见 2.5：统一前端数据获取范式，统一 loading/error/data 状态
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseAsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface UseAsyncOptions {
  /** 是否在挂载时立即执行（默认 true） */
  immediate?: boolean;
  /** 依赖数组，变化时重新执行 */
  deps?: unknown[];
}

/**
 * useAsync: 统一管理异步数据获取的 loading/error/data 三态
 * @param asyncFn 异步函数
 * @param options { immediate: 是否立即执行, deps: 依赖 }
 */
export function useAsync<T>(
  asyncFn: () => Promise<T>,
  options: UseAsyncOptions = {},
) {
  const { immediate = true, deps = [] } = options;
  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    loading: immediate,
    error: null,
  });
  const asyncFnRef = useRef(asyncFn);
  asyncFnRef.current = asyncFn;
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const execute = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await asyncFnRef.current();
      if (mountedRef.current && requestId === requestIdRef.current) {
        setState({ data, loading: false, error: null });
      }
    } catch (err) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setState({ data: null, loading: false, error: err instanceof Error ? err : new Error(String(err)) });
      }
    }
  }, []);

  useEffect(() => {
    if (immediate) {
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, execute, reload: execute };
}
