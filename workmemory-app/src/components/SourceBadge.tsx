/**
 * 应用来源徽标 (04_UI_SPEC.md §3.1)
 *
 * - 圆角 --radius-round，背景 --color-surface-subtle，padding 2px 8px，12px 字体
 * - 图标用 emoji 简单映射（Edge/Chrome→🌐、VS Code→💻、Word→📄、飞书/WeChat→💬、默认→📄）
 * - 不可见内容用 🔒
 */
import type { CSSProperties } from 'react';

export interface SourceBadgeProps {
  appName: string;
  icon?: string;
}

/** 应用名 → emoji 图标的简单映射（按子串匹配，大小写不敏感） */
const APP_ICON_MAP: Array<{ match: string; icon: string }> = [
  { match: 'edge', icon: '🌐' },
  { match: 'chrome', icon: '🌐' },
  { match: 'safari', icon: '🌐' },
  { match: 'firefox', icon: '🌐' },
  { match: 'vs code', icon: '💻' },
  { match: 'vscode', icon: '💻' },
  { match: 'code', icon: '💻' },
  { match: 'idea', icon: '💻' },
  { match: 'word', icon: '📄' },
  { match: 'excel', icon: '📊' },
  { match: 'powerpoint', icon: '📽️' },
  { match: 'notion', icon: '📝' },
  { match: 'obsidian', icon: '📝' },
  { match: '飞书', icon: '💬' },
  { match: 'feishu', icon: '💬' },
  { match: 'lark', icon: '💬' },
  { match: 'wechat', icon: '💬' },
  { match: '微信', icon: '💬' },
  { match: 'dingtalk', icon: '💬' },
  { match: '钉钉', icon: '💬' },
  { match: 'slack', icon: '💬' },
  { match: 'teams', icon: '💬' },
  { match: 'terminal', icon: '⌨️' },
  { match: '终端', icon: '⌨️' },
];

function resolveIcon(appName: string): string {
  const key = appName.toLowerCase();
  for (const item of APP_ICON_MAP) {
    if (key.includes(item.match)) return item.icon;
  }
  return '📄';
}

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  maxWidth: 180,
  borderRadius: 'var(--radius-round)',
  background: 'var(--color-surface-subtle)',
  padding: '2px 8px',
  fontSize: 12,
  color: 'var(--color-text-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

function SourceBadge({ appName, icon }: SourceBadgeProps): JSX.Element {
  const isHidden = !appName || appName === '🔒';
  const emoji = icon ?? (isHidden ? '🔒' : resolveIcon(appName));
  const label = isHidden ? '已保护' : appName;

  return (
    <span style={badgeStyle} title={label}>
      <span aria-hidden style={{ flexShrink: 0 }}>
        {emoji}
      </span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
    </span>
  );
}

export default SourceBadge;
