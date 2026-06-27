/**
 * 成就卡片 (AchievementCard) - Task 23.1
 *
 * - 已解锁：金色边框 + 彩色图标 + 解锁时间
 * - 未解锁：灰色降级 + 进度条（progress 0-1）
 * - 单条成就展示，可被 HomeView 成就区域复用渲染为网格
 */
import type { CSSProperties } from 'react';

export interface Achievement {
  code: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlockedAt: string | null;
  /** 0.0-1.0，已解锁恒为 1 */
  progress: number;
}

export interface AchievementCardProps {
  achievement: Achievement;
}

export default function AchievementCard({
  achievement,
}: AchievementCardProps): JSX.Element {
  const { icon, title, description, unlocked, progress } = achievement;
  const pct = Math.max(0, Math.min(1, progress));

  const cardStyle: CSSProperties = unlocked
    ? {
        ...baseStyle,
        borderColor: 'var(--color-warning, #F59E0B)',
        borderWidth: 2,
        background:
          'linear-gradient(135deg, rgba(245,158,11,0.10), var(--color-surface))',
        boxShadow: '0 0 0 1px rgba(245,158,11,0.25), var(--shadow-card)',
      }
    : {
        ...baseStyle,
        opacity: 0.75,
        background: 'var(--color-surface-subtle)',
      };

  return (
    <div
      role="listitem"
      aria-label={`${title} ${unlocked ? '已解锁' : '未解锁'}`}
      style={cardStyle}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <span
          aria-hidden
          style={{
            fontSize: 28,
            filter: unlocked ? 'none' : 'grayscale(1)',
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          {icon || '🏅'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: unlocked
                ? 'var(--color-text-main)'
                : 'var(--color-text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </span>
            {unlocked && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--color-on-warning, #FFFFFF)',
                  background: 'var(--color-warning, #F59E0B)',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-round)',
                  flexShrink: 0,
                }}
              >
                ✓
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {description}
          </div>
        </div>
      </div>

      {/* 进度条：未解锁且 progress < 1 时显示 */}
      {!unlocked && pct < 1 && (
        <div style={{ marginTop: 'var(--space-sm)' }}>
          <div
            style={{
              width: '100%',
              height: 4,
              background: 'var(--color-border)',
              borderRadius: 'var(--radius-round)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct * 100}%`,
                height: '100%',
                background: 'var(--color-primary)',
                borderRadius: 'var(--radius-round)',
                transition: 'width var(--duration-base) var(--ease-out-expo)',
              }}
            />
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--color-text-light)',
              marginTop: 2,
              textAlign: 'right',
            }}
          >
            {Math.round(pct * 100)}%
          </div>
        </div>
      )}
    </div>
  );
}

const baseStyle: CSSProperties = {
  padding: 'var(--space-md)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  transition:
    'box-shadow var(--duration-fast) var(--ease-out-expo), transform var(--duration-fast) var(--ease-out-expo)',
};
