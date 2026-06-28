/**
 * 左侧 72px 图标导航栏 (04_UI_SPEC.md §2)
 *
 * - 顶部：WorkMemory 圆形毛玻璃小 logo
 * - 主导航 5-Tab（仪表盘/任务/专注/宠物 + 底部设置）
 * - 记忆子导航（今日/日历/搜索/洞察/Wiki/图谱/报告）保留现有工作记忆捕获功能
 * - 当前选中项左侧 2px 主色竖条 + primary-soft 背景
 * - 用 react-router-dom 的 NavLink 实现路由切换
 */
import { NavLink } from 'react-router-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  Home,
  CheckSquare,
  Timer,
  Cat,
  Calendar,
  CalendarDays,
  Search,
  Lightbulb,
  BookOpen,
  Share2,
  FileText,
  Settings,
  Tags,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
}

// 主导航 5-Tab（任务/宠物/专注层）
const PRIMARY_NAV: NavItem[] = [
  { to: '/home', icon: Home, label: '仪表盘' },
  { to: '/tasks', icon: CheckSquare, label: '任务' },
  { to: '/focus', icon: Timer, label: '专注' },
  { to: '/pet', icon: Cat, label: '宠物' },
];

// 记忆子导航（现有工作记忆捕获功能，保留；移除重复的“设置”项）
const MEMORY_NAV: NavItem[] = [
  { to: '/today', icon: Calendar, label: '今日' },
  { to: '/calendar', icon: CalendarDays, label: '日历' },
  { to: '/search', icon: Search, label: '搜索' },
  { to: '/insights', icon: Lightbulb, label: '洞察' },
  { to: '/wiki', icon: BookOpen, label: 'Wiki' },
  { to: '/graph', icon: Share2, label: '图谱' },
  { to: '/reports', icon: FileText, label: '报告' },
  // Task 15：标签管理（与 Wiki 相关，放在记忆子导航下方）
  { to: '/tags', icon: Tags, label: '标签' },
];

// 设置（底部独立项，原记忆组中的“设置”已上移至此主导航位）
const SETTINGS_NAV: NavItem = {
  to: '/settings',
  icon: Settings,
  label: '设置',
};

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

// 中间可滚动区域：主导航 + 分隔 + 记忆子导航（高度不足时滚动）
const navScrollStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  overflowY: 'auto',
};

const logoStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 'var(--radius-round)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 12,
  flex: '0 0 auto',
  background:
    'linear-gradient(135deg, var(--color-primary), var(--color-private))',
  color: 'var(--color-on-primary)',
  fontSize: 16,
  fontWeight: 700,
  boxShadow: 'var(--shadow-subtle)',
};

const dividerStyle: React.CSSProperties = {
  width: 32,
  height: 1,
  background: 'var(--color-border)',
  margin: '8px 0',
  flex: '0 0 auto',
};

const memoryLabelStyle: React.CSSProperties = {
  fontSize: 9,
  color: 'var(--color-text-muted)',
  marginBottom: 4,
  letterSpacing: 1,
  opacity: 0.7,
  flex: '0 0 auto',
};

function Sidebar(): JSX.Element {
  // 渲染单个导航项（NavLink + Tooltip + 激活态指示条）
  const renderNavItem = (item: NavItem): JSX.Element => {
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
                      borderRadius: 'var(--radius-sm)',
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
              color: 'var(--color-on-primary)',
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
  };

  return (
    <Tooltip.Provider delayDuration={200}>
      <nav style={sidebarStyle} aria-label="主导航">
        <div style={logoStyle} title="WorkMemory">
          W
        </div>

        <div style={navScrollStyle}>
          {PRIMARY_NAV.map(renderNavItem)}

          <div style={dividerStyle} />
          <div style={memoryLabelStyle}>记忆</div>

          {MEMORY_NAV.map(renderNavItem)}
        </div>

        {renderNavItem(SETTINGS_NAV)}
      </nav>
    </Tooltip.Provider>
  );
}

export default Sidebar;
