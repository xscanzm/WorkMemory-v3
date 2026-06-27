/**
 * Toast 通知全局状态 (Zustand)
 * 供组件（Toast.tsx）与非组件代码（如 api.ts / view 的 catch 块）统一调用。
 * 3 秒后自动消失；同时暴露 toast.success/error/info 便捷方法。
 */
import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
}

interface ToastState {
  toasts: ToastItem[];
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: (id: string) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (message, type = 'info') => {
    const id = `toast-${++counter}-${Date.now()}`;
    const item: ToastItem = { id, message, type, createdAt: Date.now() };
    set((s) => ({ toasts: [...s.toasts, item] }));
    // 3 秒后自动消失
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// 便捷方法：供非组件代码（如 api.ts catch 块）直接调用
export const toast = {
  success: (msg: string) => useToastStore.getState().showToast(msg, 'success'),
  error: (msg: string) => useToastStore.getState().showToast(msg, 'error'),
  info: (msg: string) => useToastStore.getState().showToast(msg, 'info'),
};
