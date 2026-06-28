/**
 * 面包屑导航 (audit-v4-hardening Task 14, 04_UI_SPEC.md §2 TopBar)
 *
 * - 使用 useLocation() 读取当前路径，生成层级面包屑数组
 * - 最后一项为当前页（不可点击、text-main 强调）
 * - 非最后一项可点击，使用 useNavigate 跳转
 * - 分隔符使用 lucide-react ChevronRight（项目已依赖）
 * - Wiki 深层页面支持：
 *     /wiki/:id            → 知识库 › 页面详情（或 location.state.wikiTitle 标题）
 *     /wiki/edit/:id       → 知识库 › [页面标题]
 *     /wiki?id=xxx         → 知识库 › [页面标题]
 * - /calendar/:date → 日历 › YYYY-MM-DD
 */
import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  path: string;
}

/** 根级路由 → 中文标签映射（与 App.tsx 路由表对齐） */
const ROOT_LABELS: Record<string, string> = {
  '/home': '仪表盘',
  '/today': '今日',
  '/focus': '专注',
  '/tasks': '任务',
  '/wiki': '知识库',
  '/calendar': '日历',
  '/insights': '洞察',
  '/settings': '设置',
  '/search': '搜索',
  '/tags': '标签管理',
  '/pet': '宠物',
  '/graph': '图谱',
  '/reports': '报告',
};

/** 从 location.state 中安全提取 wikiTitle */
function readWikiTitle(state: unknown): string | undefined {
  if (state && typeof state === 'object' && 'wikiTitle' in state) {
    const v = (state as { wikiTitle?: unknown }).wikiTitle;
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}

/**
 * 根据当前路径生成面包屑项数组。
 * - `/` 或 `/today` → [{ 今日 }]
 * - `/wiki/:id` → [{ 知识库 }, { 页面详情 | 标题 }]
 * - `/wiki/edit/:id` → [{ 知识库 }, { 页面详情 | 标题 }]
 * - `/wiki?id=xxx` → [{ 知识库 }, { 页面详情 | 标题 }]
 * - `/calendar/:date` → [{ 日历 }, { YYYY-MM-DD }]
 */
export function buildBreadcrumbs(
  pathname: string,
  search: string,
  state: unknown,
): BreadcrumbItem[] {
  // 根路径视为今日（spec Task 14: `/` → 今日）
  if (pathname === '/') {
    return [{ label: '今日', path: '/' }];
  }

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return [{ label: '今日', path: '/' }];
  }

  const root = '/' + segments[0];
  const rootLabel = ROOT_LABELS[root];
  if (!rootLabel) {
    // 未知根路由：仅渲染根段原值，避免崩溃
    return [{ label: root, path: root }];
  }

  const items: BreadcrumbItem[] = [{ label: rootLabel, path: root }];

  if (root === '/wiki') {
    // /wiki/edit/:id
    if (segments.length >= 3 && segments[1] === 'edit') {
      const id = segments[2];
      const title = readWikiTitle(state);
      items.push({ label: title || '页面详情', path: `/wiki/edit/${id}` });
      return items;
    }
    // /wiki/:id
    if (segments.length >= 2) {
      const id = segments[1];
      const title = readWikiTitle(state);
      items.push({ label: title || '页面详情', path: `/wiki/${id}` });
      return items;
    }
    // /wiki?id=xxx
    if (segments.length === 1) {
      const params = new URLSearchParams(search);
      const id = params.get('id');
      if (id) {
        const title = readWikiTitle(state);
        items.push({ label: title || '页面详情', path: `/wiki?id=${id}` });
      }
      return items;
    }
    return items;
  }

  // /calendar/:date
  if (root === '/calendar' && segments.length >= 2) {
    const date = segments[1];
    items.push({ label: date, path: `/calendar/${date}` });
    return items;
  }

  return items;
}

const navStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2xs)',
  minWidth: 0,
  flex: 1,
  fontSize: 14,
  color: 'var(--color-text-muted)',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
};

const itemBaseStyle: CSSProperties = {
  fontSize: 14,
  color: 'var(--color-text-muted)',
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  transition: 'color var(--duration-fast) var(--ease-out-expo)',
};

const currentItemStyle: CSSProperties = {
  ...itemBaseStyle,
  color: 'var(--color-text-main)',
  fontWeight: 600,
  cursor: 'default',
};

export default function Breadcrumbs(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  const items = buildBreadcrumbs(
    location.pathname,
    location.search,
    location.state,
  );

  if (items.length === 0) return <nav aria-label="面包屑导航" style={navStyle} />;

  return (
    <nav aria-label="面包屑导航" style={navStyle}>
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const key = `${item.path}-${idx}`;
        return (
          <span
            key={key}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2xs)', minWidth: 0 }}
          >
            {idx > 0 && (
              <ChevronRight
                size={14}
                style={{
                  color: 'var(--color-text-light)',
                  flexShrink: 0,
                }}
                aria-hidden
              />
            )}
            {isLast ? (
              <span
                style={currentItemStyle}
                aria-current="page"
                data-testid={`breadcrumb-${idx}`}
              >
                {item.label}
              </span>
            ) : (
              <button
                type="button"
                style={itemBaseStyle}
                onClick={() => navigate(item.path)}
                data-testid={`breadcrumb-${idx}`}
                title={item.label}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--color-text-main)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--color-text-muted)';
                }}
              >
                {item.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
