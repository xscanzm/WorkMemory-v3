/**
 * MemoryFullscreenModal 测试 - audit-v4-hardening Task 16
 *
 * 覆盖：
 *   - 渲染 null 时不显示
 *   - 渲染 episode 时显示标题、摘要、应用列表
 *   - 双击标题进入编辑模式
 *   - Ctrl+S 保存触发 invoke('update_episode_title_summary')
 *   - 删除按钮弹出二次确认
 *   - 确认删除触发 invoke('delete_episode')
 *   - 保存到 Wiki 触发 invoke('save_to_wiki')
 *   - Esc 关闭
 *
 * Mock：
 *   - `@tauri-apps/api/core` 的 invoke（避免真实 IPC 调用）
 *     setup.ts 已注入 __TAURI_INTERNALS__，因此 api.invoke 会走真实 Tauri 分支，
 *     经动态 import('@tauri-apps/api/core') 调用到此 mock。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import type { CleanEpisode } from '@/types';

// vi.mock 工厂会被提升到文件顶部，因此用 vi.hoisted 声明 mock 以确保可访问。
const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

import MemoryFullscreenModal from '../MemoryFullscreenModal';

const baseEpisode: CleanEpisode = {
  id: 'ep-1',
  date: '2026-06-28',
  hourBucket: '10:00',
  startTime: '10:00:00',
  endTime: '10:30:00',
  title: '编写单元测试',
  summary: '为 MemoryFullscreenModal 编写 Vitest 测试用例，覆盖渲染与交互。',
  memoryKind: 'work',
  project: 'VS Code',
  entities: ['VS Code', 'Vitest'],
  topics: ['测试', '前端'],
  materials: [],
  outputs: [],
  todos: ['编写测试', '运行验证'],
  blockers: [],
  segmentIds: ['s1', 's2'],
  evidenceRefs: [],
  sourceQuality: 'high',
  confidence: 0.9,
  wikiEligible: true,
  wikiStatus: 'eligible',
  isPrivate: false,
};

/** 判断 mockInvoke 是否被以指定命令名调用过 */
function invokedCommand(cmd: string): boolean {
  return mockInvoke.mock.calls.some(([c]) => c === cmd);
}

describe('MemoryFullscreenModal 记忆详情全屏模态', () => {
  beforeEach(() => {
    cleanup();
    mockInvoke.mockReset();
    // 默认 IPC 返回空数组（get_episode_screenshots 等不报错）
    mockInvoke.mockResolvedValue([]);
  });

  it('episode 为 null 时不渲染', () => {
    render(
      <MemoryFullscreenModal
        episode={null}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('dialog', { name: '记忆详情' }),
    ).not.toBeInTheDocument();
  });

  it('渲染 episode 时显示标题、摘要与应用列表', async () => {
    render(
      <MemoryFullscreenModal
        episode={baseEpisode}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    // 标题
    expect(screen.getByTestId('modal-title')).toHaveTextContent('编写单元测试');
    // 摘要
    expect(
      screen.getByText(/为 MemoryFullscreenModal 编写 Vitest 测试用例/),
    ).toBeInTheDocument();
    // 应用列表（entities 渲染为 🏷️ chip）
    expect(screen.getByText('🏷️ VS Code')).toBeInTheDocument();
    expect(screen.getByText('🏷️ Vitest')).toBeInTheDocument();
  });

  it('双击标题进入编辑模式', async () => {
    const user = userEvent.setup();
    render(
      <MemoryFullscreenModal
        episode={baseEpisode}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    const title = screen.getByTestId('modal-title');
    await user.dblClick(title);
    expect(screen.getByLabelText('标题编辑')).toBeInTheDocument();
  });

  it('编辑模式下 Ctrl+S 保存触发 invoke(update_episode_title_summary)', async () => {
    render(
      <MemoryFullscreenModal
        episode={baseEpisode}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    // 进入编辑模式
    fireEvent.dblClick(screen.getByTestId('modal-title'));
    const titleInput = await screen.findByLabelText('标题编辑');
    // 触发 Ctrl+S（组件内部全局 keydown 监听器，事件冒泡到 window）
    fireEvent.keyDown(titleInput, { key: 's', ctrlKey: true });
    await waitFor(() => {
      expect(invokedCommand('update_episode_title_summary')).toBe(true);
    });
  });

  it('点击删除按钮弹出二次确认', async () => {
    const user = userEvent.setup();
    render(
      <MemoryFullscreenModal
        episode={baseEpisode}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    // 此刻只有一个匹配 /删除/ 的按钮（底部操作栏）
    await user.click(screen.getByRole('button', { name: /删除/ }));
    // ConfirmDialog 出现，含确认文案
    expect(await screen.findByText(/确定要删除/)).toBeInTheDocument();
  });

  it('确认删除触发 invoke(delete_episode)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryFullscreenModal
        episode={baseEpisode}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    // 打开二次确认
    await user.click(screen.getByRole('button', { name: /删除/ }));
    const confirmMsg = await screen.findByText(/确定要删除/);
    const confirmDialog = confirmMsg.closest('[role="dialog"]') as HTMLElement;
    // 点击 ConfirmDialog 内的"删除"确认按钮
    // 用 fireEvent.click 避免 userEvent 的 pointer-events 校验在多层 Portal 叠加时误判
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(invokedCommand('delete_episode')).toBe(true);
    });
  });

  it('点击保存到 Wiki 触发 invoke(save_to_wiki)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryFullscreenModal
        episode={baseEpisode}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /保存到 Wiki/ }));
    await waitFor(() => {
      expect(invokedCommand('save_to_wiki')).toBe(true);
    });
  });

  it('Esc 关闭模态', async () => {
    const onOpenChange = vi.fn();
    render(
      <MemoryFullscreenModal
        episode={baseEpisode}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );
    // Radix Dialog.Content 同时设置 aria-label 与 aria-labelledby（指向标题 header），
    // 按 ARIA 规范 aria-labelledby 优先，故 accessible name 为标题文本而非"记忆详情"。
    const dialog = screen.getByRole('dialog', { name: /编写单元测试/ });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
