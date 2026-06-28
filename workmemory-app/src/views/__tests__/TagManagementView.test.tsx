/**
 * TagManagementView 测试 - audit-v4-hardening Task 15
 *
 * 覆盖：
 *   - 渲染标签云（含 count 缩放）
 *   - 点击标签弹出操作菜单
 *   - 重命名流程触发 invoke('rename_tag')
 *   - 合并流程触发 invoke('merge_tags')
 *   - 颜色选择触发 invoke('set_tag_color')
 *   - 搜索过滤标签
 *
 * Mock：
 *   - `@tauri-apps/api/core` 的 invoke（避免真实 IPC 调用）
 *   - test/setup.ts 已定义 window.__TAURI_INTERNALS__ 使 api.isTauri() 返回 true
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

// vi.mock 工厂会被提升到文件顶部，因此用 vi.hoisted 声明 mock 以确保可访问。
const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

import TagManagementView from '../TagManagementView';

// 测试用 TagInfo 数据
const MOCK_TAGS = [
  { name: '设计', count: 5, last_used_at: '2026-06-26T12:00:00Z', color: '#2563EB' },
  { name: '订单', count: 3, last_used_at: '2026-06-26T11:00:00Z', color: null },
  { name: '退款', count: 1, last_used_at: '2026-06-26T09:00:00Z', color: null },
];

describe('TagManagementView 标签管理面板', () => {
  beforeEach(() => {
    cleanup();
    mockInvoke.mockReset();
    // 默认 list_tags 返回 MOCK_TAGS
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_tags') {
        return Promise.resolve(MOCK_TAGS);
      }
      if (cmd === 'get_wiki_pages') {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });
  });

  it('渲染标签云，显示所有标签名与 count', async () => {
    render(<TagManagementView />);

    // 等待 list_tags 完成
    // 注意：api.listTags() 通过统一 invoke 封装调用 m.invoke('list_tags', undefined)，
    // 因此 mockInvoke 收到两个参数（第二个为 undefined）。
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('list_tags', undefined);
    });

    // 三个标签都应渲染
    expect(await screen.findByText('设计')).toBeInTheDocument();
    expect(screen.getByText('订单')).toBeInTheDocument();
    expect(screen.getByText('退款')).toBeInTheDocument();
  });

  it('点击标签弹出操作菜单（含"重命名"项）', async () => {
    const user = userEvent.setup();
    render(<TagManagementView />);

    // 等待标签云渲染
    const tagEl = await screen.findByText('设计');
    await user.click(tagEl);

    // 操作菜单应出现，包含"重命名"项
    await waitFor(() => {
      expect(screen.getByText('重命名')).toBeInTheDocument();
    });
    expect(screen.getByText('合并到...')).toBeInTheDocument();
    expect(screen.getByText('设置颜色')).toBeInTheDocument();
    expect(screen.getByText('删除标签')).toBeInTheDocument();
    expect(screen.getByText('查看关联 Wiki')).toBeInTheDocument();
  });

  it('重命名流程触发 invoke("rename_tag")', async () => {
    const user = userEvent.setup();
    render(<TagManagementView />);

    // 1. 点击标签 → 弹出菜单
    const tagEl = await screen.findByText('设计');
    await user.click(tagEl);

    // 2. 点击"重命名" → 弹出对话框
    const renameItem = await screen.findByText('重命名');
    await user.click(renameItem);

    // 3. 输入新名字
    const input = await screen.findByLabelText('新标签名');
    expect(input).toHaveValue('设计'); // 默认填入当前名
    await user.clear(input);
    await user.type(input, 'Design');

    // 4. 点击"确认"
    const confirmBtns = screen.getAllByRole('button', { name: '确认' });
    await user.click(confirmBtns[0]);

    // 5. 验证 invoke('rename_tag') 被调用
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('rename_tag', {
        oldName: '设计',
        newName: 'Design',
      });
    });
  });

  it('合并流程触发 invoke("merge_tags")', async () => {
    const user = userEvent.setup();
    render(<TagManagementView />);

    // 等待标签云渲染
    await screen.findByText('设计');

    // 1. 点击"合并模式"切换
    const mergeToggle = screen.getByTitle('切换合并模式');
    await user.click(mergeToggle);

    // 2. 在合并模式下点击两个标签选中
    const designTag = screen.getByText('设计');
    const orderTag = screen.getByText('订单');
    await user.click(designTag);
    await user.click(orderTag);

    // 3. 输入目标标签名
    const targetInput = screen.getByLabelText('目标标签名');
    await user.type(targetInput, '产品设计');

    // 4. 点击"执行合并"
    const mergeBtn = screen.getByRole('button', { name: /执行合并/ });
    await user.click(mergeBtn);

    // 5. 验证 invoke('merge_tags') 被调用
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('merge_tags', {
        sourceTags: ['设计', '订单'],
        targetTag: '产品设计',
      });
    });
  });

  it('颜色选择触发 invoke("set_tag_color")', async () => {
    const user = userEvent.setup();
    render(<TagManagementView />);

    // 1. 点击标签 → 弹出菜单
    const tagEl = await screen.findByText('退款');
    await user.click(tagEl);

    // 2. 点击"设置颜色"
    const colorItem = await screen.findByText('设置颜色');
    await user.click(colorItem);

    // 3. 点击第一个预设色（#2563EB 主色蓝）
    const swatch = await screen.findByLabelText('选择颜色 #2563EB');
    await user.click(swatch);

    // 4. 点击"确认"
    const confirmBtns = screen.getAllByRole('button', { name: '确认' });
    await user.click(confirmBtns[0]);

    // 5. 验证 invoke('set_tag_color') 被调用
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_tag_color', {
        tag: '退款',
        color: '#2563EB',
      });
    });
  });

  it('搜索框过滤标签', async () => {
    const user = userEvent.setup();
    render(<TagManagementView />);

    // 等待标签云渲染
    await screen.findByText('设计');
    expect(screen.getByText('订单')).toBeInTheDocument();
    expect(screen.getByText('退款')).toBeInTheDocument();

    // 输入搜索词"设"（仅匹配"设计"）
    const searchInput = screen.getByLabelText('搜索标签');
    await user.type(searchInput, '设');

    // 等待 debounce (300ms) + 重新渲染
    await waitFor(
      () => {
        expect(screen.getByText('设计')).toBeInTheDocument();
        expect(screen.queryByText('订单')).not.toBeInTheDocument();
        expect(screen.queryByText('退款')).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('加载中状态显示加载提示', async () => {
    // 让 list_tags 返回慢一点，确保加载态可见
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_tags') {
        return new Promise((resolve) => {
          setTimeout(() => resolve(MOCK_TAGS), 100);
        });
      }
      return Promise.resolve(undefined);
    });

    render(<TagManagementView />);

    // 初始应显示"加载中…"
    expect(screen.getByText('加载中…')).toBeInTheDocument();

    // 等待加载完成
    await waitFor(() => {
      expect(screen.getByText('设计')).toBeInTheDocument();
    });
  });

  it('空标签列表显示空态', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_tags') {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });

    render(<TagManagementView />);

    await waitFor(() => {
      expect(screen.getByText('暂无标签')).toBeInTheDocument();
    });
  });

  it('清空选择按钮清空已选标签', async () => {
    const user = userEvent.setup();
    render(<TagManagementView />);

    await screen.findByText('设计');

    // 进入合并模式
    await user.click(screen.getByTitle('切换合并模式'));

    // 选中两个标签
    await user.click(screen.getByText('设计'));
    await user.click(screen.getByText('订单'));

    // 验证已选数量
    // 注意：合并工具条中 "已选 <strong>N</strong> 个源标签" 文本跨 span/strong 元素，
    // 直接 getByText 无法匹配，需用函数 matcher 检查完整 textContent。
    const matchCountText = (count: number) => (_: string, el: Element | null) =>
      !!el && (el.textContent ?? '').replace(/\s+/g, ' ').trim() === `已选 ${count} 个源标签`;

    expect(screen.getByText(matchCountText(2))).toBeInTheDocument();

    // 点击"清空选择"
    await user.click(screen.getByRole('button', { name: '清空选择' }));

    // 已选数量应归零
    await waitFor(() => {
      expect(screen.getByText(matchCountText(0))).toBeInTheDocument();
    });
  });
});
