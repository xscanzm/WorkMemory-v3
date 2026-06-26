/**
 * 洞察卡片 (InsightCard)
 * 严格遵循 04_UI_SPEC.md §3.5 视觉规范与 06_DESIGN_GOVERNANCE.md 中性话术约束。
 *
 * - --radius-md 圆角，--color-surface 背景，--shadow-card 阴影
 * - 左侧 3px 竖条颜色按 severity（info=primary / warning=warning / danger=danger）
 * - 顶部：lucide 图标 + 类型标题（15px 加粗）
 * - 描述：13px --color-text-muted
 * - 底部：时间戳 12px --color-text-light
 */
import type { CSSProperties } from 'react';
import { Info, AlertTriangle, AlertOctagon, type LucideIcon } from 'lucide-react';
import type { Insight } from '@/types';

interface SeverityMeta {
  bar: string;
  icon: LucideIcon;
  iconColor: string;
}

const SEVERITY_META: Record<Insight['severity'], SeverityMeta> = {
  info: { bar: 'var(--color-primary)', icon: Info, iconColor: 'var(--color-primary)' },
  warning: {
    bar: 'var(--color-warning)',
    icon: AlertTriangle,
    iconColor: 'var(--color-warning)',
  },
  danger: {
    bar: 'var(--color-danger)',
    icon: AlertOctagon,
    iconColor: 'var(--color-danger)',
  },
};

const cardStyle: CSSProperties = {
  position: 'relative',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-lg)',
  overflow: 'hidden',
};

const barStyle = (color: string): CSSProperties => ({
  position: 'absolute',
  left: 0,
  top: 0,
  bottom: 0,
  width: 3,
  background: color,
});

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-sm)',
  marginBottom: 'var(--space-sm)',
};

const titleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--color-text-main)',
  lineHeight: 1.4,
};

const descStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--color-text-muted)',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
};

const timeStyle: CSSProperties = {
  marginTop: 'var(--space-md)',
  fontSize: 12,
  color: 'var(--color-text-light)',
};

/** 将 ISO 时间戳格式化为 HH:MM */
function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface InsightCardProps {
  insight: Insight;
}

export default function InsightCard({ insight }: InsightCardProps): JSX.Element {
  const meta = SEVERITY_META[insight.severity] ?? SEVERITY_META.info;
  const Icon = meta.icon;
  const time = formatTime(insight.createdAt);

  return (
    <article style={cardStyle}>
      <span style={barStyle(meta.bar)} aria-hidden />
      <div style={headerStyle}>
        <Icon size={16} strokeWidth={2} color={meta.iconColor} />
        <span style={titleStyle}>{insight.title}</span>
      </div>
      <div style={descStyle}>{insight.description}</div>
      {time ? <div style={timeStyle}>{time}</div> : null}
    </article>
  );
}
