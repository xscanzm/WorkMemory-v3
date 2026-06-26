/**
 * 左侧 72px 图标导航栏 (04_UI_SPEC.md §2)
 *
 * - 顶部：WorkMemory 圆形毛玻璃小 logo
 * - 8 个导航项（lucide-react 图标 + Radix Tooltip 中文标签）
 *   今日 / 日历 / 搜索 / 洞察 / Wiki / 图谱 / 报告 / 设置
 * - 当前选中项左侧 2px 主色竖条 + primary-soft 背景
 * - 用 react-router-dom 的 NavLink 实现路由切换
 */
import { NavLink } from 'react-router-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  Home,
  Calendar,
  Search,
  Lightbulb,
  BookOpen,
  Share2,
  FileText,
  Settings,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/today', icon: Home, label: '今日' },
  { to: '/calendar', icon: Calendar, label: '日历' },
  { to: '/search', icon: Search, label: '搜索' },
  { to: '/insights', icon: Lightbulb, label: '洞察' },
  { to: '/wiki', icon: BookOpen, label: 'Wiki' },
  { to: '/graph', icon: Share2, label: '图谱' },
  { to: '/reports', icon: FileText, label: '报告' },
  { to: '/settings', icon: Settings, label: '设置' },
];

const SIDEBAR_WIDTH = 72;

const sidebarStyle: React.CSSProperties = {
  width: SIDEBAR_WIDTH,
  flex: `0 0 ${SIDEBAR_WIDTH}px`,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '12px 0',
  gap: 4,
  background: 'var(--color-surface-glass)',
  backdropFilter: 'var(--blur-acrylic)',
  WebkitBackdropFilter: 'var(--blur-acrylic)',
  borderRight: '1px solid var(--color-border)',
  userSelect: 'none',
};

const logoStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 'var(--radius-round)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 12,
  background:
    'linear-gradient(135deg, var(--color-primary), var(--color-private))',
  color: '#FFFFFF',
  fontSize: 16,
  fontWeight: 700,
  boxShadow: 'var(--shadow-subtle)',
};

function Sidebar(): JSX.Element {
  return (
    <Tooltip.Provider delayDuration={200}>
      <nav style={sidebarStyle} aria-label="主导航">
        <div style={logoStyle} title="WorkMemory">
          W
        </div>

        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Tooltip.Root key={item.to}>
              <Tooltip.Trigger asChild>
                <NavLink
                  to={item.to}
                  style={({ isActive }) => ({
                    position: 'relative',
                    width: 48,
                    height: 48,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 'var(--radius-md)',
                    color: isActive
                      ? 'var(--color-primary)'
                      : 'var(--color-text-muted)',
                    background: isActive
                      ? 'var(--color-primary-soft)'
                      : 'transparent',
                    transition:
                      'background var(--duration-fast) var(--ease-out-expo), color var(--duration-fast) var(--ease-out-expo)',
                    textDecoration: 'none',
                  })}
                  onMouseEnter={(e) => {
                    const a = e.currentTarget;
                    // 仅在非激活时叠加 hover 背景
                    if (!a.classList.contains('active')) {
                      a.style.background = 'var(--color-surface-subtle)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    const a = e.currentTarget;
                    if (!a.classList.contains('active')) {
                      a.style.background = 'transparent';
                    }
                  }}
                >
                  {({ isActive }) =>
                    isActive ? (
                      <>
                        <span
                          style={{
                            position: 'absolute',
                            left: -12,
                            top: 8,
                            bottom: 8,
                            width: 2,
                            borderRadius: 2,
                            background: 'var(--color-primary)',
                          }}
                        />
                        <Icon size={22} strokeWidth={2} />
                      </>
                    ) : (
                      <Icon size={22} strokeWidth={2} />
                    )
                  }
                </NavLink>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="right"
                  sideOffset={8}
                  style={{
                    background: 'var(--color-text-main)',
                    color: '#FFFFFF',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 12,
                    boxShadow: 'var(--shadow-card)',
                  }}
                >
                  {item.label}
                  <Tooltip.Arrow
                    style={{ fill: 'var(--color-text-main)' }}
                  />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          );
        })}
      </nav>
    </Tooltip.Provider>
  );
}

export default Sidebar;
