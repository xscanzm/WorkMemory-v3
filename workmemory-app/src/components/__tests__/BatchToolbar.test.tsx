/**
 * BatchToolbar 批量操作工具条测试 - audit-v4-hardening Task 21
 *
 * 覆盖：
 *   - 渲染选中数（"已选 N 项"）
 *   - 点击"完成"触发 onComplete
 *   - 点击"删除"触发 onDelete
 *   - 点击"归档"触发 onArchive
 *   - 点击"导出"触发 onExport
 *   - 点击"发布"触发 onPublish（Wiki 场景）
 *   - 点击全选复选框触发 onSelectAll
 *   - 点击清空按钮触发 onClearSelection
 *   - selectedCount=0 时返回 null（不渲染）
 *   - 不提供 onComplete 时"完成"按钮不渲染
 *
 * Mock：无外部依赖，纯组件测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BatchToolbar, { type BatchToolbarProps } from '../BatchToolbar';

/** 构造默认 props，允许部分覆盖 */
function makeProps(
  overrides: Partial<BatchToolbarProps> = {},
): BatchToolbarProps {
  return {
    selectedCount: 3,
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onExport: vi.fn(),
    onDelete: vi.fn(),
    onComplete: vi.fn(),
    onArchive: vi.fn(),
    ...overrides,
  };
}

describe('BatchToolbar 批量操作工具条', () => {
  beforeEach(() => {
    cleanup();
  });

  it('渲染选中数（"已选 N 项"）', () => {
    render(<BatchToolbar {...makeProps({ selectedCount: 5 })} />);
    expect(screen.getByTestId('batch-selected-count')).toHaveTextContent(
      '已选 5 项',
    );
  });

  it('点击"完成"触发 onComplete', () => {
    const onComplete = vi.fn();
    render(<BatchToolbar {...makeProps({ onComplete })} />);
    fireEvent.click(screen.getByRole('button', { name: '批量完成' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('点击"删除"触发 onDelete', () => {
    const onDelete = vi.fn();
    render(<BatchToolbar {...makeProps({ onDelete })} />);
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('点击"归档"触发 onArchive', () => {
    const onArchive = vi.fn();
    render(<BatchToolbar {...makeProps({ onArchive })} />);
    fireEvent.click(screen.getByRole('button', { name: '批量归档' }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it('点击"导出"触发 onExport', () => {
    const onExport = vi.fn();
    render(<BatchToolbar {...makeProps({ onExport })} />);
    fireEvent.click(screen.getByRole('button', { name: '批量导出' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('点击"发布"触发 onPublish（Wiki 场景）', () => {
    const onPublish = vi.fn();
    render(<BatchToolbar {...makeProps({ onPublish, onComplete: undefined })} />);
    fireEvent.click(screen.getByRole('button', { name: '批量发布' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('点击全选复选框触发 onSelectAll', () => {
    const onSelectAll = vi.fn();
    render(<BatchToolbar {...makeProps({ onSelectAll })} />);
    // 复选框 aria-label 为"全选或取消全选"
    const checkbox = screen.getByLabelText('全选或取消全选');
    fireEvent.click(checkbox);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('点击清空按钮触发 onClearSelection', () => {
    const onClearSelection = vi.fn();
    render(<BatchToolbar {...makeProps({ onClearSelection })} />);
    fireEvent.click(screen.getByRole('button', { name: '清空选择' }));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('selectedCount=0 时返回 null（不渲染）', () => {
    render(<BatchToolbar {...makeProps({ selectedCount: 0 })} />);
    // toolbar 角色不应存在
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('batch-selected-count')).not.toBeInTheDocument();
  });

  it('selectedCount=1 时正常渲染（边界）', () => {
    render(<BatchToolbar {...makeProps({ selectedCount: 1 })} />);
    expect(screen.getByTestId('batch-selected-count')).toHaveTextContent(
      '已选 1 项',
    );
  });

  it('不提供 onComplete 时"完成"按钮不渲染', () => {
    render(<BatchToolbar {...makeProps({ onComplete: undefined })} />);
    expect(screen.queryByRole('button', { name: '批量完成' })).toBeNull();
    // 其他按钮仍应渲染
    expect(screen.getByRole('button', { name: '批量删除' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批量导出' })).toBeInTheDocument();
  });

  it('不提供 onArchive 时"归档"按钮不渲染', () => {
    render(<BatchToolbar {...makeProps({ onArchive: undefined })} />);
    expect(screen.queryByRole('button', { name: '批量归档' })).toBeNull();
  });

  it('toolbar 角色存在且 aria-label 正确', () => {
    render(<BatchToolbar {...makeProps()} />);
    expect(screen.getByRole('toolbar')).toHaveAttribute(
      'aria-label',
      '批量操作工具条',
    );
  });

  it('allSelected=true 时复选框为选中状态', () => {
    render(<BatchToolbar {...makeProps({ allSelected: true })} />);
    const checkbox = screen.getByLabelText('全选或取消全选') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('allSelected=false（默认）时复选框未选中', () => {
    render(<BatchToolbar {...makeProps()} />);
    const checkbox = screen.getByLabelText('全选或取消全选') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });
});
