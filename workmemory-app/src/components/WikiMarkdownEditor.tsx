/**
 * WikiMarkdownEditor - 自研轻量双链 Markdown 编辑器
 *
 * 严格遵循 04_UI_SPEC.md §3.5 + 09_PRODUCT_ACCEPTANCE_LEDGER.md 用例 7。
 * 功能要点：
 *   - 左右分栏：左侧 <textarea> 编辑（等宽字体，行高 1.6），右侧实时预览
 *   - 自写简易 Markdown parser（heading / bold / inline code / 列表嵌套 / 引用 / [[wikilink]]）
 *   - [[wikilink]] 实时高亮（主色调加粗，hover 下划线），点击调 onNavigateLink
 *   - 输入 [[ 自动补全：Radix Popover 列出匹配标题，键盘上下选择 + Enter 插入，Esc 关闭
 *   - 工具栏：B / H / • / Q / [[]] 快捷插入
 *
 * 禁止 Tailwind，全部 CSS 变量。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';

export interface WikiMarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  allWikiTitles: string[];
  onNavigateLink: (title: string) => void;
}

interface LinkState {
  start: number; // `[[` 在原文中的起始下标
  query: string; // `[[` 之后到光标之间的文本
}

type Suggestion = { type: 'page' | 'create'; title: string };

const MONO_STACK =
  '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", "Courier New", monospace';

const EDITOR_CSS = `
.wme-root { display:flex; flex-direction:column; height:100%; min-height:0; background:transparent; }
.wme-toolbar {
  display:flex; align-items:center; gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-subtle);
}
.wme-btn {
  height: 28px; min-width: 28px; padding: 0 var(--space-sm);
  border: none; background: transparent; color: var(--color-text-muted);
  border-radius: var(--radius-sm); font-size: 13px; font-weight: 600;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
  transition: background var(--duration-fast) var(--ease-out-expo), color var(--duration-fast) var(--ease-out-expo);
}
.wme-btn:hover { background: var(--color-surface); color: var(--color-text-main); }
.wme-divider { width:1px; height:18px; background: var(--color-border); margin: 0 var(--space-xs); }
.wme-split { flex:1; display:flex; min-height:0; }
.wme-pane { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; }
.wme-pane-left { border-right: 1px solid var(--color-border); }
.wme-pane-label {
  padding: var(--space-xs) var(--space-md);
  font-size: 11px; font-weight: 600; color: var(--color-text-light);
  letter-spacing: 0.4px; text-transform: uppercase;
  background: var(--color-surface-subtle);
  border-bottom: 1px solid var(--color-border);
}
.wme-textarea {
  flex:1; width:100%; border:none; outline:none; resize:none;
  padding: var(--space-md); font-family: ${MONO_STACK};
  font-size: 13px; line-height: 1.6; color: var(--color-text-main);
  background: transparent; tab-size: 2;
}
.wme-textarea::placeholder { color: var(--color-text-light); }
.wme-preview {
  flex:1; overflow:auto; padding: var(--space-md) var(--space-lg);
  font-size: 14px; line-height: 1.6; color: var(--color-text-main);
}
.wme-preview h1 { font-size:20px; font-weight:700; margin:0 0 var(--space-sm); line-height:1.3; }
.wme-preview h2 { font-size:18px; font-weight:700; margin:var(--space-md) 0 var(--space-sm); line-height:1.3; }
.wme-preview h3 { font-size:16px; font-weight:700; margin:var(--space-md) 0 var(--space-xs); line-height:1.3; }
.wme-preview p { margin:0 0 var(--space-sm); }
.wme-preview ul { margin:0 0 var(--space-sm); padding-left: var(--space-lg); }
.wme-preview li { margin: var(--space-2xs) 0; }
.wme-preview blockquote { margin:0 0 var(--space-sm); }
.wme-code {
  background: var(--color-surface-subtle); padding: 2px 4px;
  border-radius: 3px; font-family: ${MONO_STACK}; font-size: 0.92em;
  color: var(--color-text-main);
}
.wme-wikilink {
  color: var(--color-primary); font-weight: 700; cursor: pointer;
  background: none; border: none; padding: 0; font: inherit;
  display: inline;
}
.wme-wikilink:hover { text-decoration: underline; }
.wme-suggest {
  width: 280px; max-height: 260px; overflow:auto;
  padding: var(--space-xs); background: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
}
.wme-suggest-item {
  width:100%; text-align:left; padding: var(--space-xs) var(--space-sm);
  border:none; background:transparent; color: var(--color-text-main);
  font-size:13px; border-radius: var(--radius-sm); cursor:pointer;
  display:flex; align-items:center; gap: var(--space-sm);
}
.wme-suggest-item[data-active="true"], .wme-suggest-item:hover {
  background: var(--color-primary-soft); color: var(--color-primary);
}
.wme-suggest-hint { padding: var(--space-xs) var(--space-sm); font-size:12px; color: var(--color-text-light); }
.wme-suggest-create { color: var(--color-primary); }
`;

/**
 * 检测光标处是否存在未闭合的 `[[`，返回其位置与查询文本。
 */
function detectOpenLink(text: string, caret: number): LinkState | null {
  const before = text.slice(0, caret);
  const lastOpen = before.lastIndexOf('[[');
  if (lastOpen === -1) return null;
  const after = before.slice(lastOpen + 2);
  // 已闭合或跨行则不再触发补全
  if (after.includes(']]') || after.includes('\n')) return null;
  return { start: lastOpen, query: after };
}

interface ListItem {
  indent: number;
  text: string;
}

/**
 * 逐行解析 Markdown 为 React 节点（自写简易 parser，不引入第三方库）。
 * 支持：# / ## / ### 标题、**bold**、`code`、- 列表（嵌套缩进）、> 引用、[[wikilink]]。
 */
export function renderMarkdown(
  md: string,
  onNavigateLink: (title: string) => void,
): ReactNode {
  if (!md) return null;
  const lines = md.split('\n');
  const blocks: ReactNode[] = [];
  let key = 0;
  let i = 0;

  const renderInline = (text: string): ReactNode => {
    const nodes: ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\])/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
      const token = m[0];
      if (token.startsWith('**')) {
        nodes.push(<strong key={k++}>{token.slice(2, -2)}</strong>);
      } else if (token.startsWith('`')) {
        nodes.push(
          <code key={k++} className="wme-code">
            {token.slice(1, -1)}
          </code>,
        );
      } else {
        const title = token.slice(2, -2);
        nodes.push(
          <button
            type="button"
            key={k++}
            className="wme-wikilink"
            onClick={() => onNavigateLink(title)}
            title={`跳转到 / 创建：${title}`}
          >
            {title}
          </button>,
        );
      }
      lastIndex = m.index + token.length;
    }
    if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
    return nodes;
  };

  const renderListBlock = (items: ListItem[], keyBase: string): ReactNode => {
    const build = (arr: ListItem[], level: number): ReactNode => {
      if (arr.length === 0) return null;
      const lis: ReactNode[] = [];
      let idx = 0;
      while (idx < arr.length) {
        const item = arr[idx];
        const children: ListItem[] = [];
        let j = idx + 1;
        while (j < arr.length && arr[j].indent > item.indent) {
          children.push(arr[j]);
          j++;
        }
        const nested = children.length ? build(children, level + 1) : null;
        lis.push(
          <li key={`${keyBase}-${level}-${idx}`}>
            {renderInline(item.text)}
            {nested}
          </li>,
        );
        idx = j;
      }
      return <ul>{lis}</ul>;
    };
    return build(items, 0);
  };

  const isSpecial = (line: string): boolean =>
    /^(#{1,3}\s|>\s?|\s*-\s+)/.test(line);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const content = renderInline(h[2]);
      if (level === 1) blocks.push(<h1 key={key++}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={key++}>{content}</h2>);
      else blocks.push(<h3 key={key++}>{content}</h3>);
      i++;
      continue;
    }

    // 引用
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      blocks.push(
        <blockquote
          key={key++}
          style={{
            borderLeft: '3px solid var(--color-border)',
            paddingLeft: '12px',
            color: 'var(--color-text-muted)',
          }}
        >
          {renderInline(q[1])}
        </blockquote>,
      );
      i++;
      continue;
    }

    // 列表（含嵌套）
    const li = line.match(/^(\s*)-\s+(.*)$/);
    if (li) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)-\s+(.*)$/);
        if (!m) break;
        items.push({ indent: m[1].length, text: m[2] });
        i++;
      }
      blocks.push(<div key={key++}>{renderListBlock(items, `l${key}`)}</div>);
      continue;
    }

    // 段落（连续普通行）
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isSpecial(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++}>
        {para.map((pl, idx) => (
          <span key={idx}>
            {idx > 0 && <br />}
            {renderInline(pl)}
          </span>
        ))}
      </p>,
    );
  }

  return blocks;
}

export default function WikiMarkdownEditor(
  props: WikiMarkdownEditorProps,
): JSX.Element {
  const { value, onChange, allWikiTitles, onNavigateLink } = props;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  // 标记 value 变更是否来自用户在 textarea 内的输入，用于区分外部页面切换
  const internalChangeRef = useRef(false);
  const [linkState, setLinkState] = useState<LinkState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // 外部 value 变更（如切换页面）时关闭自动补全
  useEffect(() => {
    if (!internalChangeRef.current) {
      setLinkState(null);
    }
    internalChangeRef.current = false;
  }, [value]);

  // 程序化插入后恢复光标
  useEffect(() => {
    if (pendingCaretRef.current != null && taRef.current) {
      const pos = pendingCaretRef.current;
      taRef.current.selectionStart = pos;
      taRef.current.selectionEnd = pos;
      pendingCaretRef.current = null;
    }
  }, [value]);

  const suggestions: Suggestion[] = (() => {
    if (!linkState) return [];
    const q = linkState.query.trim().toLowerCase();
    const matched = allWikiTitles.filter((t) => t.toLowerCase().startsWith(q));
    if (matched.length > 0) return matched.map((t) => ({ type: 'page', title: t }));
    // 无匹配且已输入文本 → 提示创建新页面
    if (linkState.query.trim() !== '') {
      return [{ type: 'create', title: linkState.query.trim() }];
    }
    return [];
  })();

  // linkState 变化时重置选中项
  useEffect(() => {
    setActiveIdx(0);
  }, [linkState?.start, linkState?.query]);

  const open = linkState !== null;
  const safeIdx = suggestions.length
    ? Math.min(activeIdx, suggestions.length - 1)
    : 0;

  const focusLater = () => {
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const insertSuggestion = (title: string) => {
    if (!linkState) return;
    const text = value;
    const caret = linkState.start + 2 + linkState.query.length;
    const before = text.slice(0, linkState.start);
    const after = text.slice(caret);
    const insert = `[[${title}]]`;
    const newText = before + insert + after;
    pendingCaretRef.current = before.length + insert.length;
    internalChangeRef.current = true;
    onChange(newText);
    setLinkState(null);
    focusLater();
  };

  const recompute = () => {
    const ta = taRef.current;
    if (!ta) return;
    const ls = detectOpenLink(ta.value, ta.selectionStart ?? ta.value.length);
    setLinkState(ls);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nv = e.target.value;
    const caret = e.target.selectionStart ?? nv.length;
    internalChangeRef.current = true;
    onChange(nv);
    setLinkState(detectOpenLink(nv, caret));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!linkState) return;
    if (e.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setActiveIdx((idx) => (idx + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setActiveIdx((idx) => (idx - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      if (suggestions.length > 0) {
        e.preventDefault();
        insertSuggestion(suggestions[safeIdx].title);
      } else {
        // 无可选项：关闭补全，让 Enter 正常换行
        setLinkState(null);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setLinkState(null);
    }
  };

  // ===== 工具栏插入操作 =====
  const wrapSelection = (before: string, after: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end);
    const newText = value.slice(0, start) + before + selected + after + value.slice(end);
    pendingCaretRef.current = start + before.length + selected.length;
    internalChangeRef.current = true;
    onChange(newText);
    setLinkState(null);
    focusLater();
  };

  const insertLinePrefix = (prefix: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const newText = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    pendingCaretRef.current = lineStart + prefix.length;
    internalChangeRef.current = true;
    onChange(newText);
    setLinkState(null);
    focusLater();
  };

  const insertText = (text: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newText = value.slice(0, start) + text + value.slice(end);
    const newCaret = start + text.length;
    pendingCaretRef.current = newCaret;
    internalChangeRef.current = true;
    onChange(newText);
    // 插入 [[ 后立即触发自动补全
    setLinkState(detectOpenLink(newText, newCaret));
    focusLater();
  };

  return (
    <div className="wme-root">
      <style>{EDITOR_CSS}</style>

      <div className="wme-toolbar" role="toolbar" aria-label="Markdown 工具栏">
        <button
          type="button"
          className="wme-btn"
          title="加粗 (B)"
          onClick={() => wrapSelection('**', '**')}
        >
          <b>B</b>
        </button>
        <button
          type="button"
          className="wme-btn"
          title="标题 (H)"
          onClick={() => insertLinePrefix('## ')}
        >
          H
        </button>
        <span className="wme-divider" />
        <button
          type="button"
          className="wme-btn"
          title="列表 (•)"
          onClick={() => insertLinePrefix('- ')}
        >
          •
        </button>
        <button
          type="button"
          className="wme-btn"
          title="引用 (Q)"
          onClick={() => insertLinePrefix('> ')}
        >
          Q
        </button>
        <span className="wme-divider" />
        <button
          type="button"
          className="wme-btn"
          title="双链 ([[]])"
          onClick={() => insertText('[[')}
        >
          [[ ]]
        </button>
      </div>

      <div className="wme-split">
        <div className="wme-pane wme-pane-left">
          <div className="wme-pane-label">编辑</div>
          <Popover.Root
            open={open}
            onOpenChange={(o) => {
              if (!o) setLinkState(null);
            }}
          >
            <Popover.Anchor asChild>
              <textarea
                ref={taRef}
                className="wme-textarea"
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onKeyUp={recompute}
                onClick={recompute}
                placeholder="在此输入 Markdown…  使用 [[ 创建双链"
                spellCheck={false}
              />
            </Popover.Anchor>
            <Popover.Portal>
              <Popover.Content
                className="wme-suggest"
                side="top"
                align="start"
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                {suggestions.length === 0 ? (
                  <div className="wme-suggest-hint">输入页面标题以创建新页面…</div>
                ) : (
                  suggestions.map((s, idx) => (
                    <button
                      key={`${s.type}-${s.title}-${idx}`}
                      type="button"
                      className="wme-suggest-item"
                      data-active={idx === safeIdx ? 'true' : 'false'}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertSuggestion(s.title);
                      }}
                      onMouseEnter={() => setActiveIdx(idx)}
                    >
                      {s.type === 'create' ? (
                        <span className="wme-suggest-create">+ 创建新页面：{s.title}</span>
                      ) : (
                        <span>{s.title}</span>
                      )}
                    </button>
                  ))
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>

        <div className="wme-pane">
          <div className="wme-pane-label">预览</div>
          <div className="wme-preview">
            {renderMarkdown(value, onNavigateLink)}
          </div>
        </div>
      </div>
    </div>
  );
}
