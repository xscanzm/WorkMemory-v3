/**
 * 统一右键上下文菜单封装 (audit-v4-hardening Task 20 / 04_UI_SPEC.md §4.2)
 *
 * 基于 Radix ContextMenu 提供声明式 API：
 *   <ContextMenuWrapper items={[...]}>
 *     <目标元素 />
 *   </ContextMenuWrapper>
 *
 * 支持 4 种菜单项：
 *   - action    可点击动作项（带 onSelect 回调）
 *   - separator 分隔线（不可点击）
 *   - label     纯文本标签（不可点击，常作分组标题）
 *   - submenu   子菜单（items 字段提供子项）
 *
 * danger 项以红色文字呈现（如删除）；shortcut 右对齐；disabled 项不触发 onSelect。
 * 严格遵循项目 CSS 变量设计 Token，不引入新依赖。
 */
import * as React from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ChevronRight } from 'lucide-react';

export interface ContextMenuItem {
  type: 'action' | 'separator' | 'label' | 'submenu';
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  /** 红色文字（破坏性操作如删除） */
  danger?: boolean;
  onSelect?: () => void;
  /** submenu 子项 */
  items?: ContextMenuItem[];
}

interface ContextMenuWrapperProps {
  items: ContextMenuItem[];
  children: React.ReactNode;
}

const CM_CSS = `
.cm-content {
  min-width: 180px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  padding: var(--space-xs);
  z-index: 10002;
  font-size: 13px;
  color: var(--color-text-main);
  user-select: none;
}
.cm-content[data-state="open"] {
  animation: cm-fade-in 120ms var(--ease-out-expo);
}
.cm-content[data-state="closed"] {
  animation: cm-fade-out 100ms var(--ease-out-expo);
}
@keyframes cm-fade-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes cm-fade-out {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.96); }
}
.cm-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  outline: none;
  color: var(--color-text-main);
  position: relative;
}
.cm-item[data-disabled] {
  color: var(--color-text-light);
  cursor: not-allowed;
  opacity: 0.55;
}
.cm-item[data-highlighted] {
  background: var(--color-surface-subtle);
}
.cm-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--color-text-muted);
}
.cm-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cm-item-shortcut {
  flex-shrink: 0;
  margin-left: var(--space-md);
  font-size: 11px;
  color: var(--color-text-light);
  letter-spacing: 0.4px;
}
.cm-item-danger {
  color: var(--color-danger);
}
.cm-item-danger[data-highlighted] {
  background: rgba(239, 68, 68, 0.12);
}
.cm-item-danger .cm-item-icon {
  color: var(--color-danger);
}
.cm-subtrigger[data-state="open"] {
  background: var(--color-surface-subtle);
}
.cm-chevron {
  margin-left: var(--space-xs);
  color: var(--color-text-light);
  flex-shrink: 0;
}
.cm-separator {
  height: 1px;
  background: var(--color-border);
  margin: var(--space-xs) var(--space-sm);
}
.cm-label {
  padding: var(--space-xs) var(--space-sm);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-light);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.cm-subcontent {
  min-width: 180px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  padding: var(--space-xs);
  z-index: 10003;
}
.cm-subcontent[data-state="open"] {
  animation: cm-fade-in 120ms var(--ease-out-expo);
}
`;

/**
 * 将 ContextMenu 样式注入到 document.head（仅注入一次）。
 * 使用模块级标志避免在多处复用 wrapper 时重复注入。
 */
let cssInjected = false;
function injectCss(): void {
  if (cssInjected || typeof document === 'undefined') return;
  if (document.getElementById('context-menu-style')) {
    cssInjected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'context-menu-style';
  style.textContent = CM_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

/**
 * 递归渲染一组菜单项。
 */
function renderItems(items: ContextMenuItem[]): React.ReactNode {
  return items.map((item, idx) => {
    switch (item.type) {
      case 'separator':
        return <ContextMenu.Separator key={`sep-${idx}`} className="cm-separator" />;
      case 'label':
        return (
          <ContextMenu.Label key={`lbl-${idx}`} className="cm-label">
            {item.label}
          </ContextMenu.Label>
        );
      case 'submenu': {
        const subItems = item.items ?? [];
        return (
          <ContextMenu.Sub key={`sub-${idx}`}>
            <ContextMenu.SubTrigger
              className="cm-item cm-subtrigger"
              disabled={item.disabled}
            >
              {item.icon && <span className="cm-item-icon">{item.icon}</span>}
              <span className="cm-item-label">{item.label}</span>
              <ChevronRight size={14} className="cm-chevron" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="cm-subcontent" sideOffset={4}>
                {renderItems(subItems)}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
        );
      }
      case 'action':
      default: {
        const dangerCls = item.danger ? ' cm-item-danger' : '';
        return (
          <ContextMenu.Item
            key={`act-${idx}`}
            className={`cm-item${dangerCls}`}
            disabled={item.disabled}
            onSelect={() => {
              if (item.disabled) return;
              item.onSelect?.();
            }}
          >
            {item.icon && <span className="cm-item-icon">{item.icon}</span>}
            <span className="cm-item-label">{item.label}</span>
            {item.shortcut && (
              <span className="cm-item-shortcut">{item.shortcut}</span>
            )}
          </ContextMenu.Item>
        );
      }
    }
  });
}

/**
 * 包裹目标元素，右键触发时显示统一风格的上下文菜单。
 */
export function ContextMenuWrapper(props: ContextMenuWrapperProps): JSX.Element {
  const { items, children } = props;
  injectCss();
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children as React.ReactElement}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="cm-content">
          {renderItems(items)}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export default ContextMenuWrapper;
