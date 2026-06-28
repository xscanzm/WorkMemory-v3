/**
 * 批量操作工具条 (BatchToolbar) - audit-v4-hardening Task 21
 *
 * 当列表选中项 > 0 时由父视图渲染（父级控制 selectedCount 与显隐）。
 * 布局：左侧 全选/取消全选复选框 + "已选 N 项"；右侧 完成/归档/导出/删除 等按钮。
 * 顶部 sticky，背景 --color-surface，阴影 --shadow-card。
 *
 * 按钮按 props 回调是否存在动态渲染：
 *   - onComplete 提供 → 显示"完成"
 *   - onArchive 提供 → 显示"归档"
 *   - onPublish 提供 → 显示"发布"（Wiki 场景）
 *   - onExport 提供 → 显示"导出"
 *   - onDelete 始终渲染（红色 danger）
 */
import { Check, Archive, Download, Trash2, Send, X } from 'lucide-react';

export interface BatchToolbarProps {
  selectedCount: number;
  /** 全选/取消全选（由父级根据当前 list 长度决定语义） */
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** 全选状态：true 表示当前已全选，复选框显示对勾 */
  allSelected?: boolean;
  /** 批量完成（TasksView 提供；WikiView 不提供则隐藏按钮） */
  onComplete?: () => void;
  /** 批量归档 */
  onArchive?: () => void;
  /** 批量导出 */
  onExport: () => void;
  /** 批量删除（带二次确认由父级处理，本组件仅触发回调） */
  onDelete: () => void;
  /** 批量发布（Wiki 场景，按钮文案"发布"） */
  onPublish?: () => void;
}

export default function BatchToolbar(props: BatchToolbarProps): JSX.Element | null {
  const {
    selectedCount,
    onSelectAll,
    onClearSelection,
    allSelected = false,
    onComplete,
    onArchive,
    onExport,
    onDelete,
    onPublish,
  } = props;

  // 父级应在 selectedCount === 0 时不渲染；这里再加一层防护
  if (selectedCount <= 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="批量操作工具条"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-md)',
        padding: 'var(--space-sm) var(--space-md)',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-card)',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      {/* 左侧：全选复选框 + 已选数量 */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}
      >
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-xs)',
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--color-text-main)',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAll}
            aria-label="全选或取消全选"
            style={{ cursor: 'pointer', width: 16, height: 16 }}
          />
          全选
        </label>
        <span
          style={{
            fontSize: 13,
            color: 'var(--color-text-muted)',
            fontWeight: 600,
          }}
          data-testid="batch-selected-count"
        >
          已选 {selectedCount} 项
        </span>
        <button
          type="button"
          onClick={onClearSelection}
          aria-label="清空选择"
          title="清空选择"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            padding: 0,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* 右侧：批量操作按钮 */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flexWrap: 'wrap' }}
      >
        {onComplete && (
          <button
            type="button"
            onClick={onComplete}
            aria-label="批量完成"
            style={actionBtn('var(--color-success)', 'var(--color-on-primary)')}
          >
            <Check size={14} /> 完成
          </button>
        )}
        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            aria-label="批量发布"
            style={actionBtn('var(--color-primary)', 'var(--color-on-primary)')}
          >
            <Send size={14} /> 发布
          </button>
        )}
        {onArchive && (
          <button
            type="button"
            onClick={onArchive}
            aria-label="批量归档"
            style={actionBtn()}
          >
            <Archive size={14} /> 归档
          </button>
        )}
        <button
          type="button"
          onClick={onExport}
          aria-label="批量导出"
          style={actionBtn()}
        >
          <Download size={14} /> 导出
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="批量删除"
          style={actionBtn('var(--color-danger)', 'var(--color-on-danger)')}
        >
          <Trash2 size={14} /> 删除
        </button>
      </div>
    </div>
  );
}

/** 操作按钮基础样式：可选背景色（用于完成=绿 / 删除=红 / 默认=中性） */
function actionBtn(
  bg: string = 'var(--color-surface)',
  color: string = 'var(--color-text-main)',
): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2xs)',
    height: 28,
    padding: '0 var(--space-md)',
    fontSize: 12,
    fontWeight: 600,
    color,
    background: bg,
    border: `1px solid ${bg === 'var(--color-surface)' ? 'var(--color-border)' : bg}`,
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    transition:
      'filter var(--duration-fast) var(--ease-out-expo), background var(--duration-fast) var(--ease-out-expo)',
  };
}
