/**
 * 情绪徽章 (MoodBadge) - Task 16.2
 *
 * - 根据 mood 字符串显示对应 emoji + 中文标签
 * - 背景色按情绪语义着色（绿/黄/灰/红/紫）
 * - 与 pet_engine::infer_mood 的 7 种 mood 对齐：
 *   ecstatic / happy / content / neutral / sad / angry / sleeping
 * - 未知 mood 兜底为 neutral
 */
import type { CSSProperties } from 'react';

interface MoodMeta {
  emoji: string;
  label: string;
  bg: string;
  color: string;
}

/** mood → 视觉元数据映射 */
const MOOD_META: Record<string, MoodMeta> = {
  ecstatic: {
    emoji: '🤩',
    label: '狂喜',
    bg: 'var(--color-success-soft)',
    color: 'var(--color-success)',
  },
  happy: {
    emoji: '😊',
    label: '开心',
    bg: 'var(--color-success-soft)',
    color: 'var(--color-success)',
  },
  content: {
    emoji: '🙂',
    label: '满足',
    bg: 'var(--color-secondary-soft)',
    color: 'var(--color-secondary)',
  },
  neutral: {
    emoji: '😐',
    label: '平静',
    bg: 'var(--color-surface-subtle)',
    color: 'var(--color-text-muted)',
  },
  sad: {
    emoji: '😢',
    label: '低落',
    bg: 'var(--color-warning)',
    color: 'var(--color-on-primary)',
  },
  angry: {
    emoji: '😠',
    label: '生气',
    bg: 'var(--color-danger)',
    color: 'var(--color-on-danger)',
  },
  sleeping: {
    emoji: '😴',
    label: '休息',
    bg: 'var(--color-private-soft)',
    color: 'var(--color-private)',
  },
};

const badgeStyle = (meta: MoodMeta): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-xs)',
  padding: '2px var(--space-sm)',
  borderRadius: 'var(--radius-round)',
  background: meta.bg,
  color: meta.color,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
});

interface MoodBadgeProps {
  /** 情绪标识：ecstatic/happy/content/neutral/sad/angry/sleeping */
  mood: string;
}

export default function MoodBadge({ mood }: MoodBadgeProps): JSX.Element {
  const meta = MOOD_META[mood] ?? MOOD_META.neutral;
  const label = `${meta.label} ${mood}`;
  return (
    <span
      style={badgeStyle(meta)}
      role="status"
      aria-label={`宠物情绪：${label}`}
      title={label}
    >
      <span aria-hidden>{meta.emoji}</span>
      <span>{meta.label}</span>
    </span>
  );
}
