/**
 * 命令面板 CommandPalette (audit-v4-hardening Task 11)
 *
 * 设计参考 cmdk 风格（不引入新依赖）：
 *   - 基于 Radix Dialog 作为容器
 *   - 顶部 autofocus 搜索框
 *   - 命令分组：快速操作 / 视图切换 / 搜索记忆 / 系统指令
 *   - 简单子串匹配 + 子序列容错匹配的模糊搜索，命中字符高亮
 *   - 键盘导航：↑↓ 选择、Enter 执行、Esc 关闭
 *
 * 通过 'open-command-palette' 事件唤出（由 useHotkeys Ctrl+K 派发）。
 * 严格遵循 04_UI_SPEC.md 设计 Token；不引入新依赖。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '@/src-tauri/api';
import { useDebouncedValue } from '@/utils/debounce';
import { useHotkeyEvent } from '@/hooks/useHotkeys';
import { toast } from '@/store/toastStore';
import ConfirmDialog from './ConfirmDialog';
import type { SearchResult } from '@/types';

/** 命令项类型 */
interface BaseCommand {
  id: string;
  label: string;
  hint?: string;
  group: CommandGroup;
  /** 用于模糊匹配的额外关键词 */
  keywords?: string[];
  run: () => void | Promise<void>;
}

type CommandGroup = 'quick' | 'view' | 'search' | 'system';

/** 视图切换项配置（与 App.tsx 路由表保持一致） */
const VIEW_COMMANDS: Array<{ path: string; label: string; keywords: string[] }> = [
  { path: '/today', label: '今日', keywords: ['today', '今日', '当天', '首页'] },
  { path: '/focus', label: '专注', keywords: ['focus', '专注', '番茄', '计时'] },
  { path: '/tasks', label: '任务', keywords: ['tasks', '任务', 'todo', '待办'] },
  { path: '/wiki', label: 'Wiki', keywords: ['wiki', '知识库', '笔记', '双链'] },
  { path: '/calendar', label: '日历', keywords: ['calendar', '日历', '日程'] },
  { path: '/insights', label: '洞察', keywords: ['insights', '洞察', '分析', '统计'] },
  { path: '/settings', label: '设置', keywords: ['settings', '设置', '配置', '偏好'] },
];

const GROUP_LABELS: Record<CommandGroup, string> = {
  quick: '快速操作',
  view: '视图切换',
  search: '搜索记忆',
  system: '系统指令',
};

const GROUP_ORDER: CommandGroup[] = ['quick', 'view', 'search', 'system'];

/** 应用版本号（用于"检查更新"失败时的回退提示） */
const APP_VERSION = '3.0.0';

/** 模糊匹配结果 */
interface MatchResult {
  score: number;
  matchedIndices: Set<number>;
}

/**
 * 简单模糊匹配：
 *   1. 子串匹配（大小写不敏感）优先，越靠前分数越高
 *   2. 子序列容错匹配（容许字符不连续）
 *   3. 完全无匹配返回 null
 */
function fuzzyMatch(query: string, target: string): MatchResult | null {
  if (!query) return { score: 1, matchedIndices: new Set() };
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // 1. 子串匹配
  const substringIdx = t.indexOf(q);
  if (substringIdx >= 0) {
    const indices = new Set<number>();
    for (let i = 0; i < q.length; i++) indices.add(substringIdx + i);
    let score = 100 - substringIdx; // 越靠前分数越高
    if (substringIdx === 0) score += 50; // 前缀匹配额外加分
    return { score, matchedIndices: indices };
  }

  // 2. 子序列容错匹配
  const matchedIndices = new Set<number>();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matchedIndices.add(ti);
      qi += 1;
    }
  }
  if (qi < q.length) return null;
  return { score: 10, matchedIndices };
}

/** 高亮渲染匹配字符 */
function renderHighlighted(text: string, matchedIndices: Set<number>): ReactNode {
  if (matchedIndices.size === 0) return text;
  const parts: ReactNode[] = [];
  let buffer = '';
  let bufferIsMatch = false;
  for (let i = 0; i < text.length; i++) {
    const isMatch = matchedIndices.has(i);
    if (i === 0) {
      buffer = text[i];
      bufferIsMatch = isMatch;
      continue;
    }
    if (isMatch === bufferIsMatch) {
      buffer += text[i];
    } else {
      parts.push(bufferIsMatch ? <mark key={parts.length} style={markStyle}>{buffer}</mark> : buffer);
      buffer = text[i];
      bufferIsMatch = isMatch;
    }
  }
  if (buffer) {
    parts.push(bufferIsMatch ? <mark key={parts.length} style={markStyle}>{buffer}</mark> : buffer);
  }
  return parts;
}

// ===== 样式（严格使用 CSS 变量） =====
const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.4)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  zIndex: 9000,
};

const contentStyle: CSSProperties = {
  position: 'fixed',
  top: '15vh',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 640,
  maxWidth: '90vw',
  maxHeight: 480,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-overlay)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  zIndex: 9001,
  animation: 'spring-in var(--duration-bounce) var(--ease-spring) both',
};

const searchBoxStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-md)',
  padding: 'var(--space-md) var(--space-lg)',
  borderBottom: '1px solid var(--color-border)',
};

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: 16,
  color: 'var(--color-text-main)',
  fontFamily: 'inherit',
};

const hintStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-light)',
  whiteSpace: 'nowrap',
};

const listStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 'var(--space-sm) 0',
};

const groupStyle: CSSProperties = {
  padding: 'var(--space-xs) 0',
};

const groupHeaderStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-light)',
  padding: 'var(--space-xs) var(--space-lg)',
  letterSpacing: 0.4,
  textTransform: 'uppercase',
};

const itemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-md)',
  padding: 'var(--space-sm) var(--space-lg)',
  fontSize: 14,
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background var(--duration-fast) var(--ease-out-expo)',
};

const itemLabelStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const itemHintStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-light)',
  background: 'var(--color-surface-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 6px',
  flexShrink: 0,
};

const itemMetaStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-light)',
  flexShrink: 0,
};

const markStyle: CSSProperties = {
  background: 'var(--color-highlight-mark)',
  color: 'inherit',
  borderRadius: 'var(--radius-sm)',
  padding: '0 1px',
};

const emptyStyle: CSSProperties = {
  padding: 'var(--space-xl) var(--space-lg)',
  textAlign: 'center',
  fontSize: 13,
  color: 'var(--color-text-light)',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-lg)',
  padding: 'var(--space-xs) var(--space-lg)',
  borderTop: '1px solid var(--color-border)',
  fontSize: 11,
  color: 'var(--color-text-light)',
  background: 'var(--color-surface-subtle)',
};

const footerItemStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

export default function CommandPalette(): JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSearchResults([]);
    setSelectedIndex(0);
    setSearching(false);
  }, []);

  // 订阅 'open-command-palette' 事件唤出面板
  const handleOpen = useCallback(() => {
    setOpen(true);
    setQuery('');
    setSelectedIndex(0);
    setSearchResults([]);
    setSearching(false);
  }, []);
  useHotkeyEvent('open-command-palette', handleOpen);

  // 搜索记忆防抖（200ms，Task 7 useDebouncedValue）
  const debouncedQuery = useDebouncedValue(query, 200);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    api
      .searchMemories(q, undefined)
      .then((results) => {
        if (cancelled) return;
        setSearchResults((results ?? []).slice(0, 8));
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[CommandPalette] search_memories failed', err);
        setSearchResults([]);
      })
      .finally(() => {
        if (cancelled) return;
        setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // 构建静态命令列表（快速操作 / 视图切换 / 系统指令）
  const staticCommands = useMemo<BaseCommand[]>(() => {
    const list: BaseCommand[] = [];

    // 快速操作
    list.push({
      id: 'quick-new-task',
      label: '新建任务',
      hint: 'Ctrl+N',
      group: 'quick',
      keywords: ['new', 'task', '任务', '新建', 'create'],
      run: () => {
        navigate('/tasks');
        window.dispatchEvent(new CustomEvent('quick-new-task'));
        closePalette();
      },
    });
    list.push({
      id: 'quick-new-wiki',
      label: '新建 Wiki',
      group: 'quick',
      keywords: ['new', 'wiki', '知识库', '新建', '页面'],
      run: () => {
        navigate('/wiki');
        window.dispatchEvent(new CustomEvent('quick-new-wiki'));
        closePalette();
      },
    });
    list.push({
      id: 'quick-new-thought',
      label: '新建闪念',
      group: 'quick',
      keywords: ['new', 'thought', '闪念', '灵感', 'idea'],
      run: async () => {
        try {
          await api.invoke('create_quick_thought', { content: '' });
          toast.success('已创建闪念');
        } catch (err) {
          // IPC 未实现时静默降级：派发事件由对应视图处理
          // eslint-disable-next-line no-console
          console.warn('[CommandPalette] create_quick_thought not available, fallback to event', err);
          window.dispatchEvent(new CustomEvent('quick-new-thought'));
        }
        closePalette();
      },
    });
    list.push({
      id: 'quick-capture',
      label: '快速捕获窗口',
      group: 'quick',
      keywords: ['capture', '捕获', '截图', '窗口', 'quick'],
      run: async () => {
        try {
          await api.invoke('show_quick_capture');
        } catch (err) {
          // Task 12 未实现时静默失败
          // eslint-disable-next-line no-console
          console.warn('[CommandPalette] show_quick_capture not available', err);
        }
        closePalette();
      },
    });

    // 视图切换
    for (const v of VIEW_COMMANDS) {
      list.push({
        id: `view-${v.path}`,
        label: `跳转到${v.label}`,
        group: 'view',
        keywords: v.keywords,
        run: () => {
          navigate(v.path);
          closePalette();
        },
      });
    }

    // 系统指令
    list.push({
      id: 'system-export',
      label: '导出数据',
      group: 'system',
      keywords: ['export', '导出', '备份', 'json'],
      run: async () => {
        try {
          await api.invoke('export_all_data');
          toast.success('已导出全部数据');
        } catch (err1) {
          // eslint-disable-next-line no-console
          console.warn('[CommandPalette] export_all_data failed, try export_data', err1);
          try {
            await api.invoke('export_data', { format: 'json' });
            toast.success('已导出数据');
          } catch (err2) {
            // eslint-disable-next-line no-console
            console.warn('[CommandPalette] export_data failed', err2);
            toast.info('导出功能暂未实现');
          }
        }
        closePalette();
      },
    });
    list.push({
      id: 'system-clear',
      label: '清空所有数据',
      group: 'system',
      keywords: ['clear', '清空', '删除', '重置', 'reset'],
      run: () => {
        setConfirmClearOpen(true);
      },
    });
    list.push({
      id: 'system-check-update',
      label: '检查更新',
      group: 'system',
      keywords: ['update', '更新', '版本', 'check'],
      run: async () => {
        try {
          await api.invoke('check_for_updates');
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[CommandPalette] check_for_updates not available', err);
          toast.info(`当前版本：${APP_VERSION}`);
        }
        closePalette();
      },
    });

    return list;
  }, [navigate, closePalette]);

  // 模糊过滤静态命令
  const filteredStaticCommands = useMemo<BaseCommand[]>(() => {
    const q = query.trim();
    if (!q) return staticCommands;
    return staticCommands
      .map((cmd) => {
        const target = `${cmd.label} ${(cmd.keywords ?? []).join(' ')}`;
        const match = fuzzyMatch(q, target);
        return match ? { cmd, score: match.score } : null;
      })
      .filter((x): x is { cmd: BaseCommand; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.cmd);
  }, [staticCommands, query]);

  // 搜索结果作为命令项
  const searchCommands = useMemo<BaseCommand[]>(() => {
    const q = query.trim();
    if (!q || searchResults.length === 0) return [];
    const encoded = encodeURIComponent(q);
    return searchResults.map((r, i) => ({
      id: `search-${r.sourceId}-${i}`,
      label: r.primaryText || r.snippet || '未命名记忆',
      hint: r.date,
      group: 'search' as const,
      keywords: [r.sourceType, r.matchReason].filter(Boolean) as string[],
      run: () => {
        navigate(`/search?q=${encoded}`);
        closePalette();
      },
    }));
  }, [query, searchResults, navigate, closePalette]);

  // 合并最终命令列表（按分组顺序）
  const allCommands = useMemo<BaseCommand[]>(() => {
    const merged = [...filteredStaticCommands];
    if (searchCommands.length > 0) {
      merged.push(...searchCommands);
    }
    return merged;
  }, [filteredStaticCommands, searchCommands]);

  // 选中索引复位（query 或结果变化时）
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, searching]);

  // 选中项超出范围时夹紧
  useEffect(() => {
    if (selectedIndex >= allCommands.length && allCommands.length > 0) {
      setSelectedIndex(0);
    }
  }, [allCommands.length, selectedIndex]);

  // 滚动选中项进入视口
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-cp-index="${selectedIndex}"]`,
    );
    // jsdom 等环境未实现 scrollIntoView，做能力检测避免运行时错误
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, open]);

  // 键盘导航
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, Math.max(allCommands.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = allCommands[selectedIndex];
      if (cmd) void cmd.run();
    }
  };

  // 清空数据确认
  const handleConfirmClear = useCallback(async () => {
    setConfirmClearOpen(false);
    try {
      await api.invoke('clear_all_data');
      toast.success('已清空所有数据');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[CommandPalette] clear_all_data failed', err);
      toast.error('清空数据失败');
    }
    closePalette();
  }, [closePalette]);

  // 计算每个命令的匹配信息（用于高亮）
  const matchMap = useMemo(() => {
    const map = new Map<string, Set<number>>();
    const q = query.trim();
    if (!q) return map;
    for (const cmd of allCommands) {
      const target = cmd.label;
      const m = fuzzyMatch(q, target);
      if (m) map.set(cmd.id, m.matchedIndices);
    }
    return map;
  }, [allCommands, query]);

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(o) => !o && closePalette()}>
        <Dialog.Portal>
          <Dialog.Overlay style={overlayStyle} />
          <Dialog.Content
            style={contentStyle}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
            onKeyDown={handleKeyDown}
            aria-label="命令面板"
          >
            {/* 搜索框 */}
            <div style={searchBoxStyle}>
              <Search size={18} color="var(--color-text-light)" />
              <input
                ref={inputRef}
                style={inputStyle}
                placeholder="输入命令或搜索记忆..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="命令搜索"
                autoComplete="off"
                spellCheck={false}
              />
              <span style={hintStyle}>Esc 关闭</span>
            </div>

            {/* 命令列表 */}
            <div ref={listRef} style={listStyle} role="listbox" aria-label="命令列表">
              {GROUP_ORDER.map((group) => {
                const items = allCommands.filter((c) => c.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} style={groupStyle} role="group" aria-label={GROUP_LABELS[group]}>
                    <div style={groupHeaderStyle}>{GROUP_LABELS[group]}</div>
                    {items.map((cmd) => {
                      const absoluteIdx = allCommands.indexOf(cmd);
                      const isSelected = absoluteIdx === selectedIndex;
                      const matched = matchMap.get(cmd.id);
                      return (
                        <div
                          key={cmd.id}
                          data-cp-index={absoluteIdx}
                          role="option"
                          aria-selected={isSelected}
                          style={{
                            ...itemStyle,
                            background: isSelected
                              ? 'var(--color-primary-soft)'
                              : 'transparent',
                            color: isSelected
                              ? 'var(--color-primary)'
                              : 'var(--color-text-main)',
                          }}
                          onMouseEnter={() => setSelectedIndex(absoluteIdx)}
                          onClick={() => void cmd.run()}
                        >
                          <span style={itemLabelStyle}>
                            {matched ? renderHighlighted(cmd.label, matched) : cmd.label}
                          </span>
                          {cmd.group === 'search' && cmd.hint ? (
                            <span style={itemMetaStyle}>{cmd.hint}</span>
                          ) : cmd.hint ? (
                            <span style={itemHintStyle}>{cmd.hint}</span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {allCommands.length === 0 && !searching && (
                <div style={emptyStyle}>没有匹配的命令</div>
              )}
              {searching && allCommands.length === 0 && (
                <div style={emptyStyle}>搜索中...</div>
              )}
            </div>

            {/* 底部快捷键提示 */}
            <div style={footerStyle}>
              <span style={footerItemStyle}>
                <ArrowUp size={12} />
                <ArrowDown size={12} />
                切换
              </span>
              <span style={footerItemStyle}>
                <CornerDownLeft size={12} />
                执行
              </span>
              <span style={footerItemStyle}>Esc 关闭</span>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* 清空数据二次确认 */}
      <ConfirmDialog
        open={confirmClearOpen}
        title="清空所有数据"
        message="此操作将删除全部任务、Wiki、闪念、记忆数据，且不可恢复。确认继续？"
        confirmText="确认清空"
        danger
        onConfirm={() => void handleConfirmClear()}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </>
  );
}
