/**
 * Breadcrumbs 面包屑导航测试 - audit-v4-hardening Task 14
 *
 * 覆盖：
 *   - 渲染今日页（/today）只显示"今日"且为当前页
 *   - 渲染根路径（/）也显示"今日"
 *   - 渲染 /wiki 显示"知识库"
 *   - 渲染 /wiki/abc-123 显示"知识库 › 页面详情"
 *   - 渲染 /wiki?id=xxx 也显示"知识库 › 页面详情"
 *   - 渲染 /wiki/edit/:id + location.state.wikiTitle 显示"知识库 › [标题]"
 *   - 渲染 /calendar/2026-06-28 显示"日历 › 2026-06-28"
 *   - 点击非末项触发 navigate
 *   - 末项不可点击（无 button role，不触发 navigate）
 *
 * 使用 MemoryRouter + initialEntries 注入当前路径，vi.mock 拦截 useNavigate。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
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

import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Breadcrumbs from '../Breadcrumbs';

/** 包装 Breadcrumbs 在 MemoryRouter 中，便于通过 initialEntries 指定当前路径 */
function renderAt(
  path: string,
  state?: unknown,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[state ? { pathname: path, state } : path]}>
      <Routes>
        <Route path="*" element={<Breadcrumbs />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Breadcrumbs 面包屑导航', () => {
  beforeEach(() => {
    cleanup();
    mockNavigate.mockReset();
  });

  it('渲染今日页（/today）只显示"今日"且为当前页', () => {
    renderAt('/today');
    const nav = screen.getByLabelText('面包屑导航');
    expect(nav).toBeInTheDocument();
    // 仅有一项 "今日"
    expect(screen.getByText('今日')).toBeInTheDocument();
    // 不应出现其他标签项
    expect(screen.queryByText('知识库')).not.toBeInTheDocument();
    // 当前项应有 aria-current="page"
    expect(screen.getByText('今日').closest('[aria-current]')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('渲染根路径（/）也显示"今日"', () => {
    renderAt('/');
    expect(screen.getByText('今日')).toBeInTheDocument();
    expect(screen.getByText('今日').closest('[aria-current]')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('渲染 /wiki 显示"知识库"', () => {
    renderAt('/wiki');
    expect(screen.getByText('知识库')).toBeInTheDocument();
    expect(screen.queryByText('页面详情')).not.toBeInTheDocument();
    // 单项应为当前页
    expect(screen.getByText('知识库').closest('[aria-current]')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('渲染 /wiki/abc-123 显示"知识库 › 页面详情"', () => {
    renderAt('/wiki/abc-123');
    expect(screen.getByText('知识库')).toBeInTheDocument();
    expect(screen.getByText('页面详情')).toBeInTheDocument();
    // 末项 "页面详情" 应为当前页
    expect(
      screen.getByText('页面详情').closest('[aria-current]'),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('渲染 /wiki?id=doc-1 也显示"知识库 › 页面详情"', () => {
    renderAt('/wiki?id=doc-1');
    expect(screen.getByText('知识库')).toBeInTheDocument();
    expect(screen.getByText('页面详情')).toBeInTheDocument();
  });

  it('渲染 /wiki/edit/abc 且 location.state.wikiTitle 时显示标题', () => {
    renderAt('/wiki/edit/abc', { wikiTitle: '订单系统设计' });
    expect(screen.getByText('知识库')).toBeInTheDocument();
    expect(screen.getByText('订单系统设计')).toBeInTheDocument();
    expect(screen.queryByText('页面详情')).not.toBeInTheDocument();
  });

  it('渲染 /wiki/abc-123 且 location.state.wikiTitle 时优先显示标题', () => {
    renderAt('/wiki/abc-123', { wikiTitle: '架构笔记' });
    expect(screen.getByText('架构笔记')).toBeInTheDocument();
    expect(screen.queryByText('页面详情')).not.toBeInTheDocument();
  });

  it('渲染 /calendar/2026-06-28 显示"日历 › 2026-06-28"', () => {
    renderAt('/calendar/2026-06-28');
    expect(screen.getByText('日历')).toBeInTheDocument();
    expect(screen.getByText('2026-06-28')).toBeInTheDocument();
    // 末项日期应为当前页
    expect(
      screen.getByText('2026-06-28').closest('[aria-current]'),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('点击非末项面包屑触发 navigate 到对应路径', async () => {
    const user = userEvent.setup();
    renderAt('/wiki/abc-123');
    // 第一项 "知识库" 是可点击的 button
    const rootItem = screen.getByRole('button', { name: '知识库' });
    await user.click(rootItem);
    expect(mockNavigate).toHaveBeenCalledWith('/wiki');
  });

  it('点击日历深层路径的"日历"项触发 navigate 到 /calendar', async () => {
    const user = userEvent.setup();
    renderAt('/calendar/2026-06-28');
    const rootItem = screen.getByRole('button', { name: '日历' });
    await user.click(rootItem);
    expect(mockNavigate).toHaveBeenCalledWith('/calendar');
  });

  it('最后一项不可点击（无 button role，不触发 navigate）', async () => {
    const user = userEvent.setup();
    renderAt('/wiki/abc-123');
    // 末项 "页面详情" 应为 span（aria-current=page），不是 button
    const lastItem = screen.getByText('页面详情');
    expect(lastItem.closest('[aria-current]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('button', { name: '页面详情' })).toBeNull();
    await user.click(lastItem);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('单层路由（/tasks）末项同样不可点击', async () => {
    const user = userEvent.setup();
    renderAt('/tasks');
    const lastItem = screen.getByText('任务');
    expect(lastItem.closest('[aria-current]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('button', { name: '任务' })).toBeNull();
    await user.click(lastItem);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
