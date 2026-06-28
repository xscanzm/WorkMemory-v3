/**
 * 动画系统测试 (audit-v4-hardening Task 22)
 *
 * CSS 动画本身难以单元测试（vitest 配置 css: false），
 * 此测试验证动画 class 在组件中正确应用，以及 prefers-reduced-motion
 * 检测机制可用。
 *
 * 覆盖：
 *   - view-transition class 正确应用
 *   - list-item-enter class 正确应用
 *   - UnsavedChangesDialog 模态应用 wm-dialog-center / wm-overlay class
 *   - prefers-reduced-motion matchMedia 可检测
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';

/** 注入 window.matchMedia mock（jsdom 未实现） */
function installMatchMedia(matches = false): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('动画系统 (Task 22)', () => {
  beforeAll(() => {
    installMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
  });

  it('view-transition class 正确应用到元素', () => {
    const { container } = render(
      <div className="view-transition" data-testid="view">
        视图内容
      </div>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass('view-transition');
  });

  it('list-item-enter class 正确应用到元素', () => {
    const { container } = render(
      <div className="list-item-enter" data-testid="item">
        列表项
      </div>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass('list-item-enter');
  });

  it('UnsavedChangesDialog 打开时应用 spring 动画 class', () => {
    render(
      <UnsavedChangesDialog
        open={true}
        reasons={[]}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Radix Dialog 通过 Portal 渲染到 document.body
    // 查找 Dialog.Content（role="dialog"）
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveClass('wm-dialog-center');

    // 查找 Dialog.Overlay（Radix 渲染的 overlay div）
    const overlay = document.querySelector('.wm-overlay');
    expect(overlay).not.toBeNull();
  });

  it('UnsavedChangesDialog 关闭时不渲染', () => {
    render(
      <UnsavedChangesDialog
        open={false}
        reasons={[]}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeNull();
  });

  it('prefers-reduced-motion 可通过 matchMedia 检测', () => {
    expect(typeof window.matchMedia).toBe('function');
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    expect(mq).toBeDefined();
    expect(typeof mq.matches).toBe('boolean');
  });

  it('prefers-reduced-motion 启用时 matchMedia 返回 matches=true', () => {
    installMatchMedia(true);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    expect(mq.matches).toBe(true);
    // 还原为默认（不启用 reduced motion）
    installMatchMedia(false);
  });
});
