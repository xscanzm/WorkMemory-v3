/**
 * 成就解锁特效弹窗 (AchievementUnlockModal) - audit-v4-hardening Task 17.1
 *
 * 基于 Radix Dialog 实现的专属成就解锁弹窗，带粒子动画与升级特效：
 *   - 全屏暗色 overlay + 480x360 中心弹窗
 *   - 顶部 80px 粒子爆发区（30 粒子，CSS keyframes，按 rarity 配色）
 *   - 成就图标 spring 缩放进入 + rarity 渐变背景
 *   - 标题发光（text-shadow 按 rarity 颜色）+ 描述 + XP 奖励徽章
 *   - 底部「太棒了！」关闭按钮 + 「查看全部成就」链接（→ /insights）
 *
 * 动画时序：overlay 0-200ms → 弹窗 spring 200-600ms → 粒子 400-1900ms
 *           → 图标 600-900ms → 标题/描述 800-1100ms → 按钮 1100-1300ms
 *
 * 键盘：Enter / Esc / Space 关闭（Esc 由 Radix 默认处理）
 *
 * 双模式：
 *   - 受控模式（测试用）：显式传入 achievement / open / onOpenChange
 *   - Store 模式（App.tsx）：无 props，从 achievementStore 读取 pendingUnlock，
 *     关闭时调用 clearPendingUnlock
 *
 * 尊重 prefers-reduced-motion：跳过粒子容器，动画降级为瞬时（CSS @media 覆盖）。
 */
import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { CSSProperties } from 'react';
import type { UnlockedAchievement } from '@/store/achievementStore';
import { useAchievementStore } from '@/store/achievementStore';
import './AchievementUnlockModal.css';

export interface AchievementUnlockModalProps {
  /** 受控模式：显式传入成就。省略则从 achievementStore 读取 pendingUnlock */
  achievement?: UnlockedAchievement | null;
  /** 受控模式：是否打开。省略则由 achievement 是否为 null 推导 */
  open?: boolean;
  /** 受控模式：开关回调。省略则调用 achievementStore.clearPendingUnlock */
  onOpenChange?: (open: boolean) => void;
}

/** 粒子数量（spec: 30） */
const PARTICLE_COUNT = 30;

/** 预计算 30 个粒子的扩散终点（围绕中心 360° 均匀分布，距离 60-100px） */
const PARTICLES: Array<{ tx: number; ty: number }> = Array.from(
  { length: PARTICLE_COUNT },
  (_, i) => {
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
    const distance = 60 + (i % 3) * 20;
    return {
      tx: Math.round(Math.cos(angle) * distance),
      ty: Math.round(Math.sin(angle) * distance),
    };
  },
);

/** 检测用户是否启用了 prefers-reduced-motion */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

export default function AchievementUnlockModal(
  props: AchievementUnlockModalProps,
): JSX.Element | null {
  // Store 模式默认值（受控模式下被 props 覆盖）
  const storePending = useAchievementStore((s) => s.pendingUnlock);
  const clearPending = useAchievementStore((s) => s.clearPendingUnlock);

  const achievement: UnlockedAchievement | null =
    props.achievement !== undefined ? props.achievement : storePending;
  const open: boolean = props.open !== undefined ? props.open : achievement !== null;
  const onOpenChange: (open: boolean) => void =
    props.onOpenChange ?? ((o: boolean) => {
      if (!o) clearPending();
    });

  const reducedMotion = usePrefersReducedMotion();

  // 无成就时不渲染（受控模式 achievement=null 或 store 模式 pendingUnlock=null）
  if (!achievement) return null;

  const { title, description, icon, rarity, xpReward } = achievement;
  const rarityClass = `aum-rarity-${rarity}`;

  // 弹窗关闭：调用 onOpenChange(false)
  const handleClose = (): void => onOpenChange(false);

  // 「查看全部成就」：导航到 /insights 并关闭弹窗（HashRouter → window.location.hash）
  const handleViewAll = (): void => {
    if (typeof window !== 'undefined') {
      window.location.hash = '#/insights';
    }
    handleClose();
  };

  // Enter / Space 关闭（Esc 由 Radix Dialog 默认处理）
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClose();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="aum-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            zIndex: 10100,
          }}
        />
        <Dialog.Content
          aria-label={`成就解锁：${title}`}
          className={`aum-content ${rarityClass}`}
          data-testid="achievement-modal"
          data-aum-rarity={rarity}
          data-aum-reduced-motion={reducedMotion ? 'true' : 'false'}
          onKeyDown={handleKeyDown}
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 480,
            height: 360,
            maxWidth: '92vw',
            maxHeight: '90vh',
            background: 'var(--color-surface, #FFFFFF)',
            borderRadius: 16,
            boxShadow: 'var(--shadow-overlay, 0 10px 15px -3px rgba(0,0,0,0.1))',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 10101,
          } as CSSProperties}
        >
          {/* ===== 顶部 80px 粒子动画区（reduced-motion 时不渲染） ===== */}
          {!reducedMotion && (
            <div
              className="aum-particles"
              data-testid="achievement-particles"
              aria-hidden
            >
              {PARTICLES.map((p, i) => (
                <span
                  key={i}
                  className="aum-particle"
                  style={
                    {
                      '--tx': `${p.tx}px`,
                      '--ty': `${p.ty}px`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          )}

          {/* ===== 主体内容 ===== */}
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--space-xl, 24px)',
              gap: 'var(--space-md, 12px)',
              textAlign: 'center',
            }}
          >
            {/* 成就图标：80x80 圆形，rarity 渐变背景，spring 进入 */}
            <div
              className="aum-icon"
              data-testid="achievement-icon"
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: 'var(--aum-gradient)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 40,
                lineHeight: 1,
                boxShadow: `0 0 24px var(--aum-color-soft)`,
                flexShrink: 0,
              }}
              aria-hidden
            >
              {icon || '🏅'}
            </div>

            {/* 稀有度标签 */}
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: 'var(--aum-color)',
                opacity: 0.9,
              }}
            >
              {rarityLabel(rarity)}
            </div>

            {/* 标题：24px 加粗 + rarity 发光 */}
            <Dialog.Title
              className="aum-title"
              data-testid="achievement-title"
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 700,
                color: 'var(--color-text-main, #1E2330)',
              }}
            >
              {title}
            </Dialog.Title>

            {/* 描述：14px，--text-secondary */}
            <Dialog.Description
              className="aum-desc"
              data-testid="achievement-description"
              style={{
                margin: 0,
                fontSize: 14,
                color: 'var(--color-text-muted, #6B7280)',
                lineHeight: 1.6,
                maxWidth: 380,
              }}
            >
              {description}
            </Dialog.Description>

            {/* XP 奖励徽章：右下角 */}
            {typeof xpReward === 'number' && (
              <div
                data-testid="achievement-xp-badge"
                style={{
                  position: 'absolute',
                  right: 'var(--space-lg, 16px)',
                  bottom: 'var(--space-lg, 16px)',
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-round, 9999px)',
                  background: 'var(--aum-color-soft)',
                  color: 'var(--aum-color)',
                  fontSize: 13,
                  fontWeight: 700,
                  border: `1px solid var(--aum-color)`,
                }}
              >
                +{xpReward} XP
              </div>
            )}
          </div>

          {/* ===== 底部按钮 ===== */}
          <div
            className="aum-footer"
            style={{
              position: 'relative',
              zIndex: 1,
              padding: 'var(--space-md, 12px) var(--space-xl, 24px)',
              borderTop: '1px solid var(--color-border, #E5E9F0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-sm, 8px)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={handleViewAll}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-primary, #2563EB)',
                fontSize: 13,
                cursor: 'pointer',
                padding: 0,
                textDecoration: 'underline',
              }}
            >
              查看全部成就
            </button>
            <Dialog.Close asChild>
              <button
                type="button"
                onClick={handleClose}
                style={{
                  padding: '8px 20px',
                  borderRadius: 'var(--radius-md, 8px)',
                  border: 'none',
                  background: 'var(--aum-color)',
                  color: '#FFFFFF',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                太棒了！
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 稀有度中文标签 */
function rarityLabel(rarity: UnlockedAchievement['rarity']): string {
  switch (rarity) {
    case 'legendary':
      return '传说';
    case 'epic':
      return '史诗';
    case 'rare':
      return '稀有';
    case 'common':
    default:
      return '普通';
  }
}
