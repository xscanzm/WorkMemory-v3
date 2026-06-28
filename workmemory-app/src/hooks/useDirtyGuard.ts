/**
 * 全局脏状态守卫 (审计意见 2.4)
 *
 * 严格遵循审计意见 2.4：未保存内容切换路由时拦截，避免静默丢弃编辑器内容。
 *
 * 设计要点：
 *   - dirtyRegistry 为模块级 Map，跨 hook 实例共享（多个编辑器可同时注册）
 *   - registerDirty / unregisterDirty 供编辑器组件挂载/卸载或内容变化时调用
 *   - checkDirty / getDirtyReasons 为独立函数，供路由守卫等非组件代码调用
 *   - clearAllDirty 供"丢弃并离开"场景在 proceed 前清空全部注册项
 */
import { useCallback, useState } from 'react';

type DirtyReason = string;

// 模块级注册表（跨 hook 实例持久化）
const dirtyRegistry = new Map<string, DirtyReason>();

export function useDirtyGuard() {
  const [, forceUpdate] = useState({});

  const registerDirty = useCallback(
    (key: string, reason: DirtyReason = '有未保存的更改') => {
      dirtyRegistry.set(key, reason);
      forceUpdate({});
    },
    [],
  );

  const unregisterDirty = useCallback((key: string) => {
    dirtyRegistry.delete(key);
    forceUpdate({});
  }, []);

  const isDirty = useCallback(() => dirtyRegistry.size > 0, []);

  const getDirtyReasons = useCallback(
    () => Array.from(dirtyRegistry.values()),
    [],
  );

  return { registerDirty, unregisterDirty, isDirty, getDirtyReasons };
}

/** 独立检查（供路由守卫等非组件代码使用） */
export function checkDirty(): boolean {
  return dirtyRegistry.size > 0;
}

/** 获取当前全部脏状态原因 */
export function getDirtyReasons(): string[] {
  return Array.from(dirtyRegistry.values());
}

/** 清空全部脏状态注册（"丢弃并离开"时调用） */
export function clearAllDirty(): void {
  dirtyRegistry.clear();
}
