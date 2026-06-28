/**
 * 全局快捷键监听矩阵（audit-v4-hardening Task 13 / 05_INTERACTION.md §3.1）
 *
 * 设计要点：
 *   - 单一全局 `keydown` 监听器，在 App 根组件挂载时注册一次（useHotkeys 仅在 App.tsx 调用一次）
 *   - 内部维护组合键 → 事件名的映射，使用 window.dispatchEvent 派发 CustomEvent
 *   - 其他组件通过 useHotkeyEvent(eventName, handler) 订阅
 *   - macOS 兼容：同时识别 ctrlKey 与 metaKey（Cmd 键）
 *   - 输入框冲突处理详见 §2（Ctrl+S/K/N/F 在 INPUT/TEXTAREA/[contenteditable] 内仍触发，
 *     并对浏览器默认行为 preventDefault；单字符快捷键本任务暂不实现）
 */
import { useCallback, useEffect } from 'react';

/** 全局快捷键派发的自定义事件名 */
export type HotkeyEventName =
  | 'open-command-palette'
  | 'quick-new-task'
  | 'save-current'
  | 'focus-search'
  | 'close-modal'
  | 'toggle-quick-capture';

/** 派发全局快捷键自定义事件 */
function dispatchHotkeyEvent(name: HotkeyEventName): void {
  window.dispatchEvent(new CustomEvent(name));
}

/**
 * 全局快捷键激活入口。
 *
 * 在 App.tsx 顶层调用一次即可注册全部快捷键监听；不要在子组件重复挂载。
 * 卸载时自动移除 window 上的 keydown 监听器。
 */
export function useHotkeys(): void {
  const handleKeydown = useCallback((e: KeyboardEvent) => {
    // 单独按下 Ctrl/Meta（无其他键组合）不触发任何事件
    if (e.key === 'Control' || e.key === 'Meta') {
      return;
    }

    const mod = e.ctrlKey || e.metaKey;

    if (mod) {
      // Ctrl/Cmd 组合键：key 统一取小写比对（兼容 Shift 同时按下场景的容错）
      switch (e.key.toLowerCase()) {
        case 'k':
          // 命令面板可从任何上下文唤出；preventDefault 浏览器默认（如地址栏聚焦）
          e.preventDefault();
          dispatchHotkeyEvent('open-command-palette');
          break;
        case 'n':
          // preventDefault 浏览器新建窗口行为
          e.preventDefault();
          dispatchHotkeyEvent('quick-new-task');
          break;
        case 's':
          // 浏览器默认保存行为需 preventDefault；交由当前 focus 的编辑器通过事件处理
          // （非编辑器上下文由订阅方决定忽略）
          e.preventDefault();
          dispatchHotkeyEvent('save-current');
          break;
        case 'f':
          // preventDefault 浏览器查找行为
          e.preventDefault();
          dispatchHotkeyEvent('focus-search');
          break;
        case 'c':
          // Ctrl+Shift+C 唤出快速捕获窗口（Task 12）；plain Ctrl+C 保留复制行为，不拦截
          if (e.shiftKey) {
            e.preventDefault();
            dispatchHotkeyEvent('toggle-quick-capture');
          }
          break;
        default:
          break;
      }
      return;
    }

    // 无修饰键：Esc 关闭当前打开的模态/弹窗
    if (e.key === 'Escape') {
      dispatchHotkeyEvent('close-modal');
      return;
    }

    // 当输入框聚焦时，单字符快捷键（如 J/K 导航）不应触发——本任务暂不实现单字符快捷键。
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [handleKeydown]);
}

/**
 * 订阅全局快捷键派发出的自定义事件。
 *
 * 用法：
 *   useHotkeyEvent('open-command-palette', () => setPaletteOpen(true));
 */
export function useHotkeyEvent(
  eventName: HotkeyEventName,
  handler: (event: Event) => void,
): void {
  useEffect(() => {
    window.addEventListener(eventName, handler);
    return () => {
      window.removeEventListener(eventName, handler);
    };
  }, [eventName, handler]);
}
