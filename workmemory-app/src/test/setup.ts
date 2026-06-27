import '@testing-library/jest-dom';
// 全局 mock Tauri invoke（组件测试中避免真实 IPC 调用）
import { vi } from 'vitest';

// Mock Tauri 环境检测
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: { invoke: vi.fn() },
  writable: true,
});
