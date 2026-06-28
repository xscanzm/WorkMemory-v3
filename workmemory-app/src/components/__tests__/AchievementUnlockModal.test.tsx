/**
 * AchievementUnlockModal 测试 - audit-v4-hardening Task 17
 *
 * 覆盖：
 *   - achievement 为 null 时不渲染
 *   - 渲染 achievement 时显示标题、描述、图标
 *   - 不同 rarity 显示对应颜色 class（aum-rarity-{rarity}）
 *   - 点击「太棒了！」关闭按钮触发 onOpenChange(false)
 *   - Enter 键关闭
 *   - 显示 XP 奖励徽章（+50 XP）
 *   - prefers-reduced-motion 时不渲染粒子容器
 *
 * Mock：
 *   - `@tauri-apps/api/core` 的 invoke（避免真实 IPC 调用）
 *   - `@tauri-apps/api/event` 的 listen（避免真实事件订阅）
 *   - window.matchMedia（jsdom 未实现，需手动注入）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AchievementUnlockModal from '../AchievementUnlockModal';
import type { UnlockedAchievement } from '@/store/achievementStore';
import {
  __resetAchievementStoreForTest,
  useAchievementStore,
} from '@/store/achievementStore';

// vi.mock 工厂会被提升到文件顶部，因此用 vi.hoisted 声明 mock 以确保可访问。
const { mockInvoke, mockListen } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}));

/** 构造测试用 UnlockedAchievement */
function makeAchievement(
  overrides: Partial<UnlockedAchievement> = {},
): UnlockedAchievement {
  return {
    id: 'first_task',
    title: '初出茅庐',
    description: '完成第一个任务',
    icon: '🌱',
    rarity: 'common',
    unlockedAt: '2026-06-28T10:00:00+08:00',
    xpReward: 50,
    ...overrides,
  };
}

/** 注入 window.matchMedia mock（jsdom 未实现），默认 matches=false */
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

describe('AchievementUnlockModal 成就解锁特效弹窗', () => {
  beforeEach(() => {
    cleanup();
    mockInvoke.mockReset();
    mockListen.mockReset();
    mockListen.mockImplementation(() => Promise.resolve(() => {}));
    installMatchMedia(false);
    __resetAchievementStoreForTest();
  });

  afterEach(() => {
    cleanup();
  });

  it('achievement 为 null 时不渲染', () => {
    render(
      <AchievementUnlockModal
        achievement={null}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId('achievement-modal'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('渲染 achievement 时显示标题、描述、图标', () => {
    const a = makeAchievement();
    render(
      <AchievementUnlockModal
        achievement={a}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('achievement-title')).toHaveTextContent('初出茅庐');
    expect(screen.getByTestId('achievement-description')).toHaveTextContent(
      '完成第一个任务',
    );
    // 图标渲染在 achievement-icon 容器内
    expect(screen.getByTestId('achievement-icon')).toHaveTextContent('🌱');
  });

  it('不同 rarity 显示对应颜色 class', () => {
    const cases: Array<{ rarity: UnlockedAchievement['rarity']; cls: string }> = [
      { rarity: 'common', cls: 'aum-rarity-common' },
      { rarity: 'rare', cls: 'aum-rarity-rare' },
      { rarity: 'epic', cls: 'aum-rarity-epic' },
      { rarity: 'legendary', cls: 'aum-rarity-legendary' },
    ];
    for (const { rarity, cls } of cases) {
      cleanup();
      render(
        <AchievementUnlockModal
          achievement={makeAchievement({ rarity })}
          open={true}
          onOpenChange={vi.fn()}
        />,
      );
      const modal = screen.getByTestId('achievement-modal');
      expect(modal.className).toContain(cls);
      expect(modal.getAttribute('data-aum-rarity')).toBe(rarity);
    }
  });

  it('点击「太棒了！」关闭按钮触发 onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    render(
      <AchievementUnlockModal
        achievement={makeAchievement()}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '太棒了！' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Enter 键关闭弹窗', () => {
    const onOpenChange = vi.fn();
    render(
      <AchievementUnlockModal
        achievement={makeAchievement()}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );
    const modal = screen.getByTestId('achievement-modal');
    fireEvent.keyDown(modal, { key: 'Enter' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Esc 键关闭弹窗（Radix Dialog 默认行为）', () => {
    const onOpenChange = vi.fn();
    render(
      <AchievementUnlockModal
        achievement={makeAchievement()}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('显示 XP 奖励徽章', () => {
    render(
      <AchievementUnlockModal
        achievement={makeAchievement({ xpReward: 50 })}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('achievement-xp-badge');
    expect(badge).toHaveTextContent('+50 XP');
  });

  it('xpReward 未提供时不渲染 XP 徽章', () => {
    const { xpReward: _omit, ...rest } = makeAchievement();
    void _omit;
    render(
      <AchievementUnlockModal
        achievement={rest as UnlockedAchievement}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('achievement-xp-badge')).not.toBeInTheDocument();
  });

  it('默认渲染粒子容器（30 粒子）', () => {
    render(
      <AchievementUnlockModal
        achievement={makeAchievement()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    const particles = screen.getByTestId('achievement-particles');
    const particleNodes = particles.querySelectorAll('.aum-particle');
    expect(particleNodes).toHaveLength(30);
  });

  it('prefers-reduced-motion 时不渲染粒子容器', () => {
    // 重新注入 matchMedia，返回 matches=true
    installMatchMedia(true);
    render(
      <AchievementUnlockModal
        achievement={makeAchievement()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('achievement-particles')).not.toBeInTheDocument();
    // 主体仍渲染
    expect(screen.getByTestId('achievement-title')).toHaveTextContent('初出茅庐');
  });

  it('Store 模式：无 props 时从 achievementStore 读取 pendingUnlock', () => {
    const a = makeAchievement({ title: '宠物达人', rarity: 'rare' });
    useAchievementStore.getState().setPendingUnlock(a);
    render(<AchievementUnlockModal />);
    expect(screen.getByTestId('achievement-title')).toHaveTextContent('宠物达人');
    expect(screen.getByTestId('achievement-modal').className).toContain(
      'aum-rarity-rare',
    );
  });
});
