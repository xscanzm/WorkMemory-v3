/**
 * ContextMenu 统一右键菜单封装测试 - audit-v4-hardening Task 20
 *
 * 覆盖：
 *   - 渲染 wrapper 包裹的子元素
 *   - 右键触发菜单显示
 *   - 点击 action 菜单项触发 onSelect
 *   - separator 不响应点击（渲染为 separator 角色）
 *   - danger 项有红色样式 class（cm-item-danger）
 *   - disabled 项不触发 onSelect
 *   - submenu 子项可点击触发
 *   - label 项渲染为非交互标签
 *
 * Mock：无外部依赖，纯组件测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ContextMenuWrapper, type ContextMenuItem } from '../ContextMenu';

/** 打开右键菜单：在 trigger 上触发 contextmenu 事件（Radix 监听该事件打开菜单） */
function openMenu(target: HTMLElement): void {
  fireEvent.contextMenu(target, { button: 2, clientX: 0, clientY: 0 });
}

describe('ContextMenu 统一右键菜单封装', () => {
  beforeEach(() => {
    cleanup();
  });

  it('渲染 wrapper 包裹的子元素', () => {
    render(
      <ContextMenuWrapper items={[]}>
        <div data-testid="target">目标元素</div>
      </ContextMenuWrapper>,
    );
    expect(screen.getByTestId('target')).toBeInTheDocument();
    expect(screen.getByText('目标元素')).toBeInTheDocument();
  });

  it('右键触发菜单显示', () => {
    const items: ContextMenuItem[] = [
      { type: 'action', label: '动作一', onSelect: () => {} },
    ];
    render(
      <ContextMenuWrapper items={items}>
        <div data-testid="target">目标</div>
      </ContextMenuWrapper>,
    );
    // 初始菜单未显示
    expect(screen.queryByText('动作一')).not.toBeInTheDocument();
    // 右键打开
    openMenu(screen.getByTestId('target'));
    expect(screen.getByText('动作一')).toBeInTheDocument();
    // 菜单内容角色存在
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('点击 action 菜单项触发 onSelect', () => {
    const onSelect = vi.fn();
    const items: ContextMenuItem[] = [
      { type: 'action', label: '复制', onSelect },
    ];
    render(
      <ContextMenuWrapper items={items}>
        <div data-testid="target">目标</div>
      </ContextMenuWrapper>,
    );
    openMenu(screen.getByTestId('target'));
    const item = screen.getByRole('menuitem', { name: '复制' });
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('separator 渲染为 separator 角色且不响应点击', () => {
    const onSelect = vi.fn();
    const items: ContextMenuItem[] = [
      { type: 'action', label: '动作A', onSelect },
      { type: 'separator' },
      { type: 'action', label: '动作B', onSelect: () => {} },
    ];
    render(
      <ContextMenuWrapper items={items}>
        <div data-testid="target">目标</div>
      </ContextMenuWrapper>,
    );
    openMenu(screen.getByTestId('target'));
    const separator = screen.getByRole('separator');
    expect(separator).toBeInTheDocument();
    // separator 不是 menuitem，点击它不应触发任何 onSelect
    fireEvent.click(separator);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('danger 项有红色样式 class', () => {
    const items: ContextMenuItem[] = [
      { type: 'action', label: '删除', danger: true, onSelect: () => {} },
    ];
    render(
      <ContextMenuWrapper items={items}>
        <div data-testid="target">目标</div>
      </ContextMenuWrapper>,
    );
    openMenu(screen.getByTestId('target'));
    const item = screen.getByRole('menuitem', { name: '删除' });
    expect(item).toHaveClass('cm-item-danger');
  });

  it('disabled 项不触发 onSelect', () => {
    const onSelect = vi.fn();
    const items: ContextMenuItem[] = [
      { type: 'action', label: '禁用项', disabled: true, onSelect },
    ];
    render(
      <ContextMenuWrapper items={items}>
        <div data-testid="target">目标</div>
      </ContextMenuWrapper>,
    );
    openMenu(screen.getByTestId('target'));
    const item = screen.getByRole('menuitem', { name: '禁用项' });
    // Radix 在 disabled 时设置 data-disabled
    expect(item).toHaveAttribute('data-disabled');
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('label 项渲染为非交互标签（无 menuitem 角色）', () => {
    const items: ContextMenuItem[] = [
      { type: 'label', label: '分组标题' },
      { type: 'action', label: '动作', onSelect: () => {} },
    ];
    render(
      <ContextMenuWrapper items={items}>
        <div data-testid="target">目标</div>
      </ContextMenuWrapper>,
    );
    openMenu(screen.getByTestId('target'));
    // label 文本可见但不是 menuitem
    const label = screen.getByText('分组标题');
    expect(label).toBeInTheDocument();
    expect(label).not.toHaveRole('menuitem');
  });

  it('shortcut 提示右侧对齐渲染', () => {
    const items: ContextMenuItem[] = [
      { type: 'action', label: '保存', shortcut: 'Ctrl+S', onSelect: () => {} },
    ];
    render(
      <ContextMenuWrapper items={items}>
        <div data-testid="target">目标</div>
      </ContextMenuWrapper>,
    );
    openMenu(screen.getByTestId('target'));
    expect(screen.getByText('Ctrl+S')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+S')).toHaveClass('cm-item-shortcut');
  });

  it('submenu 子菜单项可点击触发 onSelect', () => {
    const subSelect = vi.fn();
    const items: ContextMenuItem[] = [
      {
        type: 'submenu',
        label: '导出',
        items: [
          { type: 'action', label: 'Markdown', onSelect: subSelect },
          { type: 'action', label: 'JSON', onSelect: () => {} },
        ],
      },
    ];
    render(
      <ContextMenuWrapper items={items}>
        <div data-testid="target">目标</div>
      </ContextMenuWrapper>,
    );
    openMenu(screen.getByTestId('target'));
    // 子菜单触发项存在
    const subTrigger = screen.getByRole('menuitem', { name: /导出/ });
    expect(subTrigger).toBeInTheDocument();
    // 点击子菜单触发项展开子菜单（Radix SubTrigger onClick 切换 open）
    fireEvent.click(subTrigger);
    // 子菜单项应出现并可点击
    const subItem = screen.getByRole('menuitem', { name: 'Markdown' });
    fireEvent.click(subItem);
    expect(subSelect).toHaveBeenCalledTimes(1);
  });
});
