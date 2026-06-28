/**
 * 左侧可折叠多维分组导航栏 (audit-v4-hardening Task 19)
 *
 * 重构自扁平 5-Tab 图标导航，现为分组可折叠菜单：
 * - 导航（今日/专注/任务/日历/洞察）默认展开
 * - 知识库（Wiki/标签管理/图谱）默认展开
 * - 工作伙伴（宠物/成就）默认展开
 * - 收藏（localStorage: sidebar.favorites）默认折叠
 * - 标签（invoke('list_tags')，前 10 个）默认折叠
 * - 最近（localStorage: sidebar.recent，自动维护 5 个）默认折叠
 *
 * 折叠状态持久化到 localStorage（sidebar.collapsed）。
 * 路由切换时自动更新最近访问列表。
 * 顶部 logo 点击回到仪表盘（/home），底部保留设置入口。
 */
import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Calendar,
  CalendarDays,
  CheckSquare,
  Timer,
  Lightbulb,
  BookOpen,
  Tags,
  Share2,
  Cat,
  Trophy,
  Settings,
  ChevronRight,
  ChevronDown,
  Star,
  Hash,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../src-tauri/api';
import type { TagInfo } from '@/types';

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
}

interface FavoriteItem {
  id: string;
  title: string;
  type: string;
  path: string;
}

interface RecentItem {
  path: string;
  title: string;
  visitedAt: string;
}

type GroupKey =
  | 'navigation'
  | 'knowledge'
  | 'companion'
  | 'favorites'
  | 'tags'
  | 'recent';

/** 导航分组（默认展开） */
const NAV_GROUP: NavItem[] = [
  { to: '/today', icon: Calendar, label: '今日' },
  { to: '/focus', icon: Timer, label: '专注' },
  { to: '/tasks', icon: CheckSquare, label: '任务' },
  { to: '/calendar', icon: CalendarDays, label: '日历' },
  { to: '/insights', icon: Lightbulb, label: '洞察' },
];

/** 知识库分组（默认展开） */
const KNOWLEDGE_GROUP: NavItem[] = [
  { to: '/wiki', icon: BookOpen, label: 'Wiki' },
  { to: '/tags', icon: Tags, label: '标签管理' },
  { to: '/graph', icon: Share2, label: '图谱' },
];

/** 工作伙伴分组（默认展开） */
const COMPANION_GROUP: NavItem[] = [
  { to: '/pet', icon: Cat, label: '宠物' },
  // 成就复用 /insights 路由（Task 19 spec 允许）
  { to: '/insights', icon: Trophy, label: '成就' },
];

const SETTINGS_NAV: NavItem = {
  to: '/settings',
  icon: Settings,
  label: '设置',
};

/** 路径到标题映射，用于最近访问列表 */
const PATH_TITLES: Record<string, string> = {
  '/home': '仪表盘',
  '/today': '今日',
  '/focus': '专注',
  '/tasks': '任务',
  '/calendar': '日历',
  '/insights': '洞察',
  '/wiki': 'Wiki',
  '/graph': '图谱',
  '/reports': '报告',
  '/search': '搜索',
  '/tags': '标签管理',
  '/pet': '宠物',
  '/settings': '设置',
};

const SIDEBAR_WIDTH = 220;

const COLLAPSED_KEY = 'sidebar.collapsed';
const FAVORITES_KEY = 'sidebar.favorites';
const RECENT_KEY = 'sidebar.recent';
const MAX_RECENT = 5;
const MAX_TAGS = 10;

const DEFAULT_COLLAPSED: Record<GroupKey, boolean> = {
  navigation: false,
  knowledge: false,
  companion: false,
  favorites: true,
  tags: true,
  recent: true,
};

const sidebarStyle: React.CSSProperties = {
  width: SIDEBAR_WIDTH,
  flex: `0 0 ${SIDEBAR_WIDTH}px`,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-surface-glass)',
  backdropFilter: 'var(--blur-acrylic)',
  WebkitBackdropFilter: 'var(--blur-acrylic)',
  borderRight: '1px solid var(--color-border)',
  userSelect: 'none',
};

const logoStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 'var(--radius-round)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '12px 14px 8px',
  flex: '0 0 auto',
  background: 'linear-gradient(135deg, var(--color-primary), var(--color-private))',
  color: 'var(--color-on-primary)',
  fontSize: 15,
  fontWeight: 700,
  boxShadow: 'var(--shadow-subtle)',
  cursor: 'pointer',
  border: 'none',
};

const navScrollStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  padding: '4px 8px',
};

const groupHeaderStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  padding: '8px 12px',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  width: '100%',
  textAlign: 'left',
  fontWeight: 600,
  letterSpacing: 0.5,
  borderRadius: 4,
};

const groupItemsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  marginBottom: 4,
};

const itemBaseStyle: React.CSSProperties = {
  padding: '6px 12px 6px 24px',
  borderLeft: '3px solid transparent',
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--color-text-main)',
  cursor: 'pointer',
  fontSize: 13,
  textDecoration: 'none',
  background: 'transparent',
  border: 'none',
  borderBottom: 'none',
  borderTop: 'none',
  borderRight: 'none',
  width: '100%',
  textAlign: 'left',
  transition: 'background var(--duration-fast) var(--ease-out-expo)',
};

const activeItemStyle: React.CSSProperties = {
  background: 'var(--color-primary-soft)',
  borderLeftColor: 'var(--color-primary)',
  color: 'var(--color-primary)',
};

const emptyHintStyle: React.CSSProperties = {
  padding: '6px 12px 6px 24px',
  fontSize: 12,
  color: 'var(--color-text-light)',
  fontStyle: 'italic',
  lineHeight: 1.5,
};

const footerStyle: React.CSSProperties = {
  flex: '0 0 auto',
  padding: '8px 8px 12px',
  borderTop: '1px solid var(--color-border)',
};

function loadCollapsed(): Record<GroupKey, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return { ...DEFAULT_COLLAPSED };
    const parsed = JSON.parse(raw) as Partial<Record<GroupKey, boolean>>;
    return { ...DEFAULT_COLLAPSED, ...parsed };
  } catch {
    return { ...DEFAULT_COLLAPSED };
  }
}

function loadFavorites(): FavoriteItem[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FavoriteItem[]) : [];
  } catch {
    return [];
  }
}

function loadRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentItem[]) : [];
  } catch {
    return [];
  }
}

/** 根据 pathname 推导可读标题 */
function titleForPath(pathname: string): string {
  if (PATH_TITLES[pathname]) return PATH_TITLES[pathname];
  const seg = pathname.split('/')[1];
  if (seg && PATH_TITLES[`/${seg}`]) return PATH_TITLES[`/${seg}`];
  return pathname;
}

interface GroupSectionProps {
  groupKey: GroupKey;
  label: string;
  collapsed: boolean;
  onToggle: (key: GroupKey) => void;
  children: ReactNode;
}

function GroupSection({
  groupKey,
  label,
  collapsed,
  onToggle,
  children,
}: GroupSectionProps): JSX.Element {
  return (
    <div>
      <button
        type="button"
        style={groupHeaderStyle}
        onClick={() => onToggle(groupKey)}
        aria-expanded={!collapsed}
        aria-label={`切换${label}分组`}
      >
        {collapsed ? (
          <ChevronRight size={12} strokeWidth={2} />
        ) : (
          <ChevronDown size={12} strokeWidth={2} />
        )}
        <span>{label}</span>
      </button>
      {!collapsed && <div style={groupItemsStyle}>{children}</div>}
    </div>
  );
}

interface NavItemButtonProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavItemButton({
  icon,
  label,
  active,
  onClick,
}: NavItemButtonProps): JSX.Element {
  const Icon = icon;
  return (
    <button
      type="button"
      className={active ? 'sidebar-item sidebar-item-active' : 'sidebar-item'}
      style={{ ...itemBaseStyle, ...(active ? activeItemStyle : null) }}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={14} strokeWidth={2} />
      <span>{label}</span>
    </button>
  );
}

function Sidebar(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState<Record<GroupKey, boolean>>(
    loadCollapsed,
  );
  const [favorites] = useState<FavoriteItem[]>(loadFavorites);
  const [recent, setRecent] = useState<RecentItem[]>(loadRecent);
  const [tags, setTags] = useState<TagInfo[]>([]);

  // 加载标签列表（Task 15 已实现的 list_tags IPC）
  useEffect(() => {
    let cancelled = false;
    void api
      .listTags()
      .then((list) => {
        if (!cancelled) setTags(list);
      })
      .catch(() => {
        if (!cancelled) setTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 路由变化时维护最近访问列表（去重，最多 5 个）
  useEffect(() => {
    const pathname = location.pathname;
    // 忽略独立窗口路由
    if (!pathname || pathname === '/mascot' || pathname === '/quick-capture') {
      return;
    }
    setRecent((prev) => {
      const filtered = prev.filter((r) => r.path !== pathname);
      const next = [
        {
          path: pathname,
          title: titleForPath(pathname),
          visitedAt: new Date().toISOString(),
        },
        ...filtered,
      ].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // 忽略写入失败
      }
      return next;
    });
  }, [location.pathname]);

  const toggleGroup = useCallback((key: GroupKey) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // 忽略写入失败
      }
      return next;
    });
  }, []);

  const isItemActive = useCallback(
    (to: string): boolean => {
      if (location.pathname === to) return true;
      if (to !== '/' && location.pathname.startsWith(to + '/')) return true;
      return false;
    },
    [location.pathname],
  );

  const renderNavGroup = (items: NavItem[]): ReactNode =>
    items.map((item) => (
      <NavItemButton
        key={`${item.to}-${item.label}`}
        icon={item.icon}
        label={item.label}
        active={isItemActive(item.to)}
        onClick={() => navigate(item.to)}
      />
    ));

  const topTags = tags.slice(0, MAX_TAGS);

  return (
    <nav style={sidebarStyle} aria-label="主导航">
      <style>{`
        .sidebar-item:hover { background: var(--color-surface-subtle); }
        .sidebar-item-active:hover { background: var(--color-primary-soft); }
      `}</style>
      <button
        type="button"
        style={logoStyle}
        onClick={() => navigate('/home')}
        aria-label="返回仪表盘"
        title="WorkMemory"
      >
        W
      </button>

      <div style={navScrollStyle}>
        <GroupSection
          groupKey="navigation"
          label="导航"
          collapsed={collapsed.navigation}
          onToggle={toggleGroup}
        >
          {renderNavGroup(NAV_GROUP)}
        </GroupSection>

        <GroupSection
          groupKey="knowledge"
          label="知识库"
          collapsed={collapsed.knowledge}
          onToggle={toggleGroup}
        >
          {renderNavGroup(KNOWLEDGE_GROUP)}
        </GroupSection>

        <GroupSection
          groupKey="companion"
          label="工作伙伴"
          collapsed={collapsed.companion}
          onToggle={toggleGroup}
        >
          {renderNavGroup(COMPANION_GROUP)}
        </GroupSection>

        <GroupSection
          groupKey="favorites"
          label="收藏"
          collapsed={collapsed.favorites}
          onToggle={toggleGroup}
        >
          {favorites.length === 0 ? (
            <div style={emptyHintStyle}>
              暂无收藏，点击 Wiki 页面星标可添加
            </div>
          ) : (
            favorites.map((fav) => (
              <NavItemButton
                key={fav.id}
                icon={Star}
                label={fav.title}
                active={isItemActive(fav.path)}
                onClick={() => navigate(fav.path)}
              />
            ))
          )}
        </GroupSection>

        <GroupSection
          groupKey="tags"
          label="标签"
          collapsed={collapsed.tags}
          onToggle={toggleGroup}
        >
          {topTags.length === 0 ? (
            <div style={emptyHintStyle}>暂无标签</div>
          ) : (
            topTags.map((tag) => (
              <NavItemButton
                key={tag.name}
                icon={Hash}
                label={tag.name}
                active={false}
                onClick={() => navigate(`/wiki?tag=${encodeURIComponent(tag.name)}`)}
              />
            ))
          )}
          <button
            type="button"
            className="sidebar-item"
            style={itemBaseStyle}
            onClick={() => navigate('/tags')}
          >
            <Tags size={14} strokeWidth={2} />
            <span>查看全部</span>
          </button>
        </GroupSection>

        <GroupSection
          groupKey="recent"
          label="最近"
          collapsed={collapsed.recent}
          onToggle={toggleGroup}
        >
          {recent.length === 0 ? (
            <div style={emptyHintStyle}>暂无最近访问</div>
          ) : (
            recent.map((item) => (
              <NavItemButton
                key={item.path}
                icon={Clock}
                label={item.title}
                active={isItemActive(item.path)}
                onClick={() => navigate(item.path)}
              />
            ))
          )}
        </GroupSection>
      </div>

      <div style={footerStyle}>
        <NavItemButton
          icon={SETTINGS_NAV.icon}
          label={SETTINGS_NAV.label}
          active={isItemActive(SETTINGS_NAV.to)}
          onClick={() => navigate(SETTINGS_NAV.to)}
        />
      </div>
    </nav>
  );
}

export default Sidebar;
