import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAsync } from '../useAsync';

// useAsync 统一异步数据获取范式测试 - audit-v4-hardening Task 10
// 覆盖 loading/error/data 三态、reload、竞态守卫、卸载安全、execute 返回 Promise
describe('useAsync 异步数据获取 (审计意见 2.5)', () => {
  it('初次加载 loading=true，成功后返回 data 并 loading=false', async () => {
    const asyncFn = vi.fn(async () => 'hello');
    const { result } = renderHook(() => useAsync(asyncFn));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBe('hello');
    expect(result.current.error).toBeNull();
  });

  it('失败后设置 error 且 loading=false', async () => {
    const asyncFn = vi.fn(async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useAsync(asyncFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.data).toBeNull();
  });

  it('reload() 重新触发请求', async () => {
    let count = 0;
    const asyncFn = vi.fn(async () => `result-${++count}`);
    const { result } = renderHook(() => useAsync(asyncFn));

    await waitFor(() => expect(result.current.data).toBe('result-1'));
    expect(asyncFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.reload();
    });

    expect(asyncFn).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe('result-2');
  });

  it('竞态条件：快速连续 reload，仅最后一次结果生效', async () => {
    const deferreds: Array<{ resolve: (v: string) => void }> = [];
    const asyncFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          deferreds.push({ resolve });
        }),
    );
    const { result } = renderHook(() => useAsync(asyncFn));

    // mount 触发第 1 次 → deferreds[0]，requestId=1
    await waitFor(() => expect(deferreds).toHaveLength(1));

    // 触发 reload → deferreds[1]，requestId=2（不 await，deferred 不自动 resolve）
    act(() => {
      result.current.reload();
    });
    await waitFor(() => expect(deferreds).toHaveLength(2));

    // 先 resolve 第一次（过期）→ requestId 守卫应忽略
    await act(async () => {
      deferreds[0].resolve('stale');
      await Promise.resolve();
    });
    expect(result.current.data).toBeNull();

    // 再 resolve 第二次（最新）→ 生效
    await act(async () => {
      deferreds[1].resolve('latest');
      await Promise.resolve();
    });
    expect(result.current.data).toBe('latest');
  });

  it('组件卸载后 setState 不触发警告', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolveLater!: (v: string) => void;
    const asyncFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLater = resolve;
        }),
    );
    const { unmount } = renderHook(() => useAsync(asyncFn));

    unmount();
    // 卸载后再 resolve，mountedRef=false 应阻止 setState
    resolveLater('after-unmount');
    await act(async () => {
      await Promise.resolve();
    });

    // 不应有 React 卸载后 setState 相关警告
    const unmountWarnings = consoleSpy.mock.calls.filter(
      ([msg]) =>
        typeof msg === 'string' &&
        /unmounted|state update on an unmounted|Can't perform a React state update/i.test(
          msg,
        ),
    );
    expect(unmountWarnings).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it('execute 函数返回 Promise', async () => {
    const asyncFn = vi.fn(async () => 42);
    const { result } = renderHook(() =>
      useAsync(asyncFn, { immediate: false }),
    );

    let ret: Promise<void> | undefined;
    act(() => {
      ret = result.current.execute();
    });
    expect(ret).toBeInstanceOf(Promise);

    await act(async () => {
      await ret;
    });
    expect(result.current.data).toBe(42);
  });
});
