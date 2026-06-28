import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDebouncedValue, useDebouncedCallback, debounce } from '../debounce';
import { renderHook, act } from '@testing-library/react';

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('initial', 300));
    expect(result.current).toBe('initial');
  });

  it('updates after delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ab' });
    expect(result.current).toBe('a'); // not yet
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe('ab');
  });

  it('resets timer on rapid changes', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ab' });
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: 'abc' });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe('a'); // still not, timer reset
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe('abc');
  });
});

describe('debounce (pure fn)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('invokes after delay', () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d();
    expect(fn).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel prevents invocation', () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d();
    d.cancel();
    act(() => vi.advanceTimersByTime(300));
    expect(fn).not.toHaveBeenCalled();
  });
});
