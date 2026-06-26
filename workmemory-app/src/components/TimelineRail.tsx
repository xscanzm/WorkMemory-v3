/**
 * 时间线竖直轨道 (04_UI_SPEC.md §3.1)
 *
 * - 一条 2px 宽、border-left: 2px dashed var(--color-border) 的竖线贯穿
 * - 接受 children，每个 child 左侧留 24px 缩进贴线
 * - 子节点（圆点）由各 child（如 MemoryCard）自行渲染并落在线上，
 *   当前 episode 的圆点用 --color-primary（由 child 的 isActive 控制）
 */
import type { CSSProperties, ReactNode } from 'react';

export interface TimelineRailProps {
  children: ReactNode;
  /** 子节点之间的垂直间距，默认 --space-lg */
  gap?: string;
}

const railStyle: CSSProperties = {
  position: 'relative',
  paddingLeft: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-lg)',
};

const lineStyle: CSSProperties = {
  position: 'absolute',
  left: 5,
  top: 0,
  bottom: 0,
  width: 0,
  borderLeft: '2px dashed var(--color-border)',
  pointerEvents: 'none',
};

function TimelineRail({ children, gap }: TimelineRailProps): JSX.Element {
  const style: CSSProperties = gap ? { ...railStyle, gap } : railStyle;
  return (
    <div style={style} role="list" aria-label="时间线">
      <div style={lineStyle} aria-hidden />
      {children}
    </div>
  );
}

export default TimelineRail;
