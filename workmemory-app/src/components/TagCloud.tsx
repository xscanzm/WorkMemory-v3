/**
 * TagCloud - 标签云组件 (audit-v4-hardening Task 15)
 *
 * 将全部 TagInfo 以云形布局展示：
 *   - 字号根据 count 在 [MIN_FONT, MAX_FONT] 区间线性缩放
 *   - 字色根据 color 字段（用户自定义色）；未设置时使用 --color-text-main
 *   - 点击标签触发 onTagClick，弹出操作菜单
 *   - 合并模式下支持多选（点击切换选中态，selectedTags 受控）
 *
 * 禁止 Tailwind，全部 CSS 变量。
 */
import type { CSSProperties, MouseEvent } from 'react';
import type { TagInfo } from '@/types';

interface TagCloudProps {
  tags: TagInfo[];
  /** 受控：合并模式下被选中的标签名集合 */
  selectedTags?: string[];
  /** 合并模式开关：开启后点击标签切换选中而非触发 onTagClick */
  mergeMode?: boolean;
  /** 非合并模式下点击标签回调 */
  onTagClick?: (tag: TagInfo) => void;
  /** 合并模式下切换选中回调 */
  onToggleSelect?: (tagName: string) => void;
}

const MIN_FONT = 12;
const MAX_FONT = 28;

const cloudWrapStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-sm) var(--space-md)',
  padding: 'var(--space-lg)',
  minHeight: 240,
};

interface tagItemStyleArgs {
  fontSize: number;
  color: string | null;
  selected: boolean;
  mergeMode: boolean;
}

function tagItemStyle({ fontSize, color, selected, mergeMode }: tagItemStyleArgs): CSSProperties {
  return {
    fontSize,
    lineHeight: 1.4,
    fontFamily: 'var(--font-sans)',
    fontWeight: fontSize >= 20 ? 600 : 500,
    color: color ?? 'var(--color-text-main)',
    background: selected
      ? 'var(--color-primary-soft)'
      : mergeMode
        ? 'var(--color-surface-subtle)'
        : 'transparent',
    border: selected
      ? '1px solid var(--color-primary)'
      : '1px solid transparent',
    borderRadius: 'var(--radius-round)',
    padding: 'var(--space-2xs) var(--space-md)',
    cursor: 'pointer',
    userSelect: 'none',
    transition:
      'background var(--duration-fast) var(--ease-out-expo), border-color var(--duration-fast) var(--ease-out-expo), transform var(--duration-fast) var(--ease-out-expo)',
  };
}

function scaleFont(count: number, min: number, max: number): number {
  if (max <= min) return (MIN_FONT + MAX_FONT) / 2;
  const ratio = (count - min) / (max - min);
  // 限制在 [0,1]，再线性映射到 [MIN_FONT, MAX_FONT]
  const clamped = Math.max(0, Math.min(1, ratio));
  return Math.round(MIN_FONT + clamped * (MAX_FONT - MIN_FONT));
}

export default function TagCloud(props: TagCloudProps): JSX.Element {
  const { tags, selectedTags = [], mergeMode = false, onTagClick, onToggleSelect } = props;

  if (tags.length === 0) {
    return (
      <div
        style={{
          ...cloudWrapStyle,
          color: 'var(--color-text-light)',
          fontSize: 13,
          flexDirection: 'column',
          gap: 'var(--space-sm)',
        }}
      >
        <span>暂无标签</span>
        <span style={{ fontSize: 11 }}>在 Wiki 页面中添加 tags 后将在此处聚合展示</span>
      </div>
    );
  }

  const counts = tags.map((t) => t.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);

  const handleClick = (tag: TagInfo): void => {
    if (mergeMode) {
      onToggleSelect?.(tag.name);
    } else {
      onTagClick?.(tag);
    }
  };

  return (
    <div style={cloudWrapStyle} role="list" aria-label="标签云">
      {tags.map((tag) => {
        const fontSize = scaleFont(tag.count, min, max);
        const selected = selectedTags.includes(tag.name);
        return (
          <span
            key={tag.name}
            role="listitem"
            style={tagItemStyle({
              fontSize,
              color: tag.color,
              selected,
              mergeMode,
            })}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              handleClick(tag);
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
            }}
            title={`${tag.name}（${tag.count} 次）`}
            data-tag-name={tag.name}
            data-tag-count={tag.count}
          >
            {tag.name}
            <span
              style={{
                marginLeft: 4,
                fontSize: Math.max(10, fontSize - 4),
                opacity: 0.6,
                fontWeight: 400,
              }}
            >
              {tag.count}
            </span>
          </span>
        );
      })}
    </div>
  );
}
