import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useDirtyGuard,
  checkDirty,
  getDirtyReasons,
  clearAllDirty,
} from '../useDirtyGuard';

// 全局脏状态守卫测试 - audit-v4-hardening Task 9 (审计意见 2.4)
// 模块级 dirtyRegistry 跨 hook 实例共享，每个用例前必须 clearAllDirty 复位
describe('useDirtyGuard 全局脏状态守卫 (审计意见 2.4)', () => {
  beforeEach(() => {
    clearAllDirty();
  });

  it('registerDirty 后 checkDirty() 返回 true', () => {
    const { result } = renderHook(() => useDirtyGuard());
    act(() => {
      result.current.registerDirty('editor-1', '编辑器有未保存更改');
    });
    expect(checkDirty()).toBe(true);
    expect(result.current.isDirty()).toBe(true);
  });

  it('unregisterDirty 后 checkDirty() 返回 false', () => {
    const { result } = renderHook(() => useDirtyGuard());
    act(() => {
      result.current.registerDirty('editor-1');
    });
    expect(checkDirty()).toBe(true);
    act(() => {
      result.current.unregisterDirty('editor-1');
    });
    expect(checkDirty()).toBe(false);
    expect(result.current.isDirty()).toBe(false);
  });

  it('getDirtyReasons() 返回所有注册原因', () => {
    const { result } = renderHook(() => useDirtyGuard());
    act(() => {
      result.current.registerDirty('editor-1', '编辑器未保存');
      result.current.registerDirty('form-1', '表单未保存');
    });
    expect(getDirtyReasons()).toEqual(['编辑器未保存', '表单未保存']);
    expect(result.current.getDirtyReasons()).toEqual([
      '编辑器未保存',
      '表单未保存',
    ]);
  });

  it('clearAllDirty() 清空所有注册项', () => {
    const { result } = renderHook(() => useDirtyGuard());
    act(() => {
      result.current.registerDirty('a', 'A');
      result.current.registerDirty('b', 'B');
    });
    expect(checkDirty()).toBe(true);
    clearAllDirty();
    expect(checkDirty()).toBe(false);
    expect(getDirtyReasons()).toEqual([]);
  });

  it('多个 key 同时注册时全部生效，移除中间项不影响其余', () => {
    const { result } = renderHook(() => useDirtyGuard());
    act(() => {
      result.current.registerDirty('k1', '原因1');
      result.current.registerDirty('k2', '原因2');
      result.current.registerDirty('k3', '原因3');
    });
    expect(getDirtyReasons()).toHaveLength(3);
    act(() => {
      result.current.unregisterDirty('k2');
    });
    expect(getDirtyReasons()).toEqual(['原因1', '原因3']);
    expect(checkDirty()).toBe(true);
  });

  it('useDirtyGuard() hook 返回的 register/unregister 跨实例共享注册表', () => {
    const { result: r1 } = renderHook(() => useDirtyGuard());
    const { result: r2 } = renderHook(() => useDirtyGuard());
    act(() => {
      r1.current.registerDirty('shared', '共享原因');
    });
    // r2 也能看到（模块级注册表跨实例持久化）
    expect(r2.current.isDirty()).toBe(true);
    expect(r2.current.getDirtyReasons()).toContain('共享原因');
    act(() => {
      r2.current.unregisterDirty('shared');
    });
    expect(r1.current.isDirty()).toBe(false);
  });

  it('registerDirty 未传 reason 时使用默认文案', () => {
    const { result } = renderHook(() => useDirtyGuard());
    act(() => {
      result.current.registerDirty('editor-1');
    });
    expect(getDirtyReasons()).toEqual(['有未保存的更改']);
  });
});
