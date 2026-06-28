/**
 * Sidebar 可折叠多维分组导航测试 - audit-v4-hardening Task 19
 *
 * 覆盖：
 *   - 渲染所有分组（导航/知识库/工作伙伴/收藏/标签/最近）
 *   - 点击分组标题切换折叠状态
 *   - 折叠状态持久化到 localStorage
 *   - 点击导航项触发 navigate
 *   - 当前路由对应项高亮（aria-current="page"）
 *   - 收藏分组从 localStorage 读取
 *   - 标签分组调用 invoke('list_tags')
 *
 * Mock：
 *   - `@tauri-apps/api/core` 的 invoke（避免真实 IPC 调用）
 *   - react-router-dom 的 useNavigate（避免真实路由跳转）
 *   - 使用 MemoryRouter 包裹提供 useLocation 上下文
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

// vi.mock 工厂会被提升到文件顶部，因此用 vi.hoisted 声明 mock 以确保可访问。
const { mockInvoke, mockNavigate } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import Sidebar from '../Sidebar';

/** 在 MemoryRouter 中渲染 Sidebar，便于通过 initialEntries 指定当前路径 */
function renderSidebar(initialPath = '/today'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe('Sidebar 可折叠多维分组导航', () => {
  beforeEach(() => {
    cleanup();
    mockInvoke.mockReset();
    mockNavigate.mockReset();
    // list_tags 默认返回空数组（避免未处理 Promise 干扰测试）
    mockInvoke.mockResolvedValue([]);
    localStorage.clear();
  });

  it('渲染所有分组标题（导航/知识库/工作伙伴/收藏/标签/最近）', () => {
    renderSidebar('/today');
    expect(screen.getByText('导航')).toBeInTheDocument();
    expect(screen.getByText('知识库')).toBeInTheDocument();
    expect(screen.getByText('工作伙伴')).toBeInTheDocument();
    expect(screen.getByText('收藏')).toBeInTheDocument();
    expect(screen.getByText('标签')).toBeInTheDocument();
    expect(screen.getByText('最近')).toBeInTheDocument();
  });

  it('默认展开的分组（导航/知识库/工作伙伴）显示其导航项', () => {
    renderSidebar('/today');
    // 导航分组项
    expect(screen.getByText('今日')).toBeInTheDocument();
    expect(screen.getByText('专注')).toBeInTheDocument();
    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.getByText('日历')).toBeInTheDocument();
    expect(screen.getByText('洞察')).toBeInTheDocument();
    // 知识库分组项
    expect(screen.getByText('Wiki')).toBeInTheDocument();
    expect(screen.getByText('标签管理')).toBeInTheDocument();
    expect(screen.getByText('图谱')).toBeInTheDocument();
    // 工作伙伴分组项
    expect(screen.getByText('宠物')).toBeInTheDocument();
    expect(screen.getByText('成就')).toBeInTheDocument();
  });

  it('点击分组标题切换折叠状态（折叠后导航项消失）', async () => {
    const user = userEvent.setup();
    renderSidebar('/today');
    // 导航分组默认展开，今日可见
    expect(screen.getByText('今日')).toBeInTheDocument();
    // 点击"导航"分组标题
    const header = screen.getByRole('button', { name: '切换导航分组' });
    await user.click(header);
    // 折叠后今日应消失
    expect(screen.queryByText('今日')).not.toBeInTheDocument();
    expect(screen.queryByText('专注')).not.toBeInTheDocument();
    // 再次点击展开
    await user.click(header);
    expect(screen.getByText('今日')).toBeInTheDocument();
  });

  it('折叠状态持久化到 localStorage（sidebar.collapsed）', async () => {
    const user = userEvent.setup();
    renderSidebar('/today');
    const header = screen.getByRole('button', { name: '切换导航分组' });
    await user.click(header);
    // localStorage 应记录导航分组折叠
    const raw = localStorage.getItem('sidebar.collapsed');
    expect(raw).not.toBeNull();
    const collapsed = JSON.parse(raw as string);
    expect(collapsed.navigation).toBe(true);
  });

  it('点击导航项触发 navigate 到对应路径', async () => {
    const user = userEvent.setup();
    // 渲染在 /tasks，点击"今日"项应触发 navigate('/today')
    renderSidebar('/tasks');
    const todayItem = screen.getByRole('button', { name: '今日' });
    await user.click(todayItem);
    expect(mockNavigate).toHaveBeenCalledWith('/today');
  });

  it('点击知识库分组中的 Wiki 项触发 navigate("/wiki")', async () => {
    const user = userEvent.setup();
    renderSidebar('/today');
    const wikiItem = screen.getByRole('button', { name: 'Wiki' });
    await user.click(wikiItem);
    expect(mockNavigate).toHaveBeenCalledWith('/wiki');
  });

  it('当前路由对应项高亮（aria-current="page"）', () => {
    renderSidebar('/today');
    const todayItem = screen.getByRole('button', { name: '今日' });
    expect(todayItem).toHaveAttribute('aria-current', 'page');
    // 非当前路由不应高亮
    const focusItem = screen.getByRole('button', { name: '专注' });
    expect(focusItem).not.toHaveAttribute('aria-current');
  });

  it('切换到 /tasks 路由时任务项高亮', () => {
    renderSidebar('/tasks');
    const tasksItem = screen.getByRole('button', { name: '任务' });
    expect(tasksItem).toHaveAttribute('aria-current', 'page');
    const todayItem = screen.getByRole('button', { name: '今日' });
    expect(todayItem).not.toHaveAttribute('aria-current');
  });

  it('收藏分组从 localStorage 读取并渲染收藏项', async () => {
    const user = userEvent.setup();
    // 预置收藏数据
    localStorage.setItem(
      'sidebar.favorites',
      JSON.stringify([
        { id: 'f1', title: '订单系统设计', type: 'wiki', path: '/wiki?id=f1' },
        { id: 'f2', title: '周会纪要', type: 'wiki', path: '/wiki?id=f2' },
      ]),
    );
    renderSidebar('/today');
    // 收藏分组默认折叠，先展开
    const header = screen.getByRole('button', { name: '切换收藏分组' });
    await user.click(header);
    expect(screen.getByText('订单系统设计')).toBeInTheDocument();
    expect(screen.getByText('周会纪要')).toBeInTheDocument();
  });

  it('收藏分组为空时显示空态提示', async () => {
    const user = userEvent.setup();
    renderSidebar('/today');
    const header = screen.getByRole('button', { name: '切换收藏分组' });
    await user.click(header);
    expect(
      screen.getByText('暂无收藏，点击 Wiki 页面星标可添加'),
    ).toBeInTheDocument();
  });

  it('标签分组调用 invoke("list_tags")', async () => {
    renderSidebar('/today');
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('list_tags', undefined);
    });
  });

  it('标签分组展开后渲染前 10 个标签 + "查看全部"', async () => {
    const user = userEvent.setup();
    const tagList = Array.from({ length: 12 }, (_, i) => ({
      name: `标签${i + 1}`,
      count: i + 1,
      last_used_at: '2026-06-26T12:00:00Z',
      color: null,
    }));
    mockInvoke.mockResolvedValue(tagList);
    renderSidebar('/today');
    // 等待 list_tags 完成
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('list_tags', undefined);
    });
    // 展开标签分组
    const header = screen.getByRole('button', { name: '切换标签分组' });
    await user.click(header);
    // 前 10 个标签应渲染
    expect(screen.getByText('标签1')).toBeInTheDocument();
    expect(screen.getByText('标签10')).toBeInTheDocument();
    // 第 11、12 个不应渲染（仅显示前 10 个）
    expect(screen.queryByText('标签11')).not.toBeInTheDocument();
    expect(screen.queryByText('标签12')).not.toBeInTheDocument();
    // "查看全部"链接应存在
    expect(screen.getByText('查看全部')).toBeInTheDocument();
  });

  it('点击"查看全部"触发 navigate("/tags")', async () => {
    const user = userEvent.setup();
    renderSidebar('/today');
    const header = screen.getByRole('button', { name: '切换标签分组' });
    await user.click(header);
    const viewAll = screen.getByRole('button', { name: '查看全部' });
    await user.click(viewAll);
    expect(mockNavigate).toHaveBeenCalledWith('/tags');
  });

  it('点击标签项触发 navigate 到 /wiki?tag=<name>', async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue([
      { name: '设计', count: 3, last_used_at: '2026-06-26T12:00:00Z', color: null },
    ]);
    renderSidebar('/today');
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('list_tags', undefined);
    });
    const header = screen.getByRole('button', { name: '切换标签分组' });
    await user.click(header);
    const tagItem = screen.getByRole('button', { name: '设计' });
    await user.click(tagItem);
    expect(mockNavigate).toHaveBeenCalledWith('/wiki?tag=' + encodeURIComponent('设计'));
  });

  it('路由切换时维护最近访问列表（localStorage sidebar.recent）', () => {
    renderSidebar('/today');
    // 挂载后 recent 列表应包含当前路径
    const raw = localStorage.getItem('sidebar.recent');
    expect(raw).not.toBeNull();
    const recent = JSON.parse(raw as string);
    expect(recent.some((r: { path: string }) => r.path === '/today')).toBe(true);
    expect(recent.length).toBeLessThanOrEqual(5);
  });

  it('点击 logo 触发 navigate("/home")', async () => {
    const user = userEvent.setup();
    renderSidebar('/today');
    const logo = screen.getByRole('button', { name: '返回仪表盘' });
    await user.click(logo);
    expect(mockNavigate).toHaveBeenCalledWith('/home');
  });

  it('底部设置项点击触发 navigate("/settings")', async () => {
    const user = userEvent.setup();
    renderSidebar('/today');
    const settingsItem = screen.getByRole('button', { name: '设置' });
    await user.click(settingsItem);
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
  });

  it('折叠的分组标题显示展开 chevron（aria-expanded=false）', () => {
    renderSidebar('/today');
    // 收藏分组默认折叠
    const favHeader = screen.getByRole('button', { name: '切换收藏分组' });
    expect(favHeader).toHaveAttribute('aria-expanded', 'false');
    // 导航分组默认展开
    const navHeader = screen.getByRole('button', { name: '切换导航分组' });
    expect(navHeader).toHaveAttribute('aria-expanded', 'true');
  });
});
