/**
 * 搜索视图 (SearchView) - P1 历史反查与时间审计
 * 严格遵循 04_UI_SPEC.md §3.4 与 09_PRODUCT_ACCEPTANCE_LEDGER.md 用例 6。
 *
 * - 顶部大圆角搜索框（--radius-lg，--shadow-card，左侧 Search 图标）+ Ctrl+K 聚焦
 * - 回车触发 api.searchMemories(query, dateRange)
 * - 结果双栏：左栏 Episode Matches（sourceType !== 'segment'）/ 右栏 OCR Snippets（segment）
 * - ==关键字== 浅黄高亮渲染（var(--color-highlight-mark) + var(--radius-sm)）
 * - 命中原因标签：💡 OCR 匹配 / 🏷️ 标签匹配 / 🔗 Wiki 关联 / 🧠 语义命中
 * - 双击 OCR Snippet：右侧 Context 面板反查 Segment 详情
 * - 空状态 / 无结果 / 加载骨架
 * 中性话术，禁止评判式表达（00_PRODUCT_VISION.md §4、06_DESIGN_GOVERNANCE.md）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Search, SearchX, X } from 'lucide-react';
import { api } from '@/src-tauri/api';
import { useDebouncedValue } from '@/utils/debounce';
import type { CleanEpisode, SearchResult } from '@/types';
import MemoryFullscreenModal from '@/components/MemoryFullscreenModal';

/** 解析 ==xxx== 包裹的部分，替换为浅黄高亮 <mark> */
function renderSnippet(snippet: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /==([^=]+)==/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(snippet)) !== null) {
    if (m.index > last) parts.push(snippet.slice(last, m.index));
    parts.push(
      <mark
        key={i++}
        style={{
          background: 'var(--color-highlight-mark)',
          borderRadius: 'var(--radius-sm)',
          padding: '0 2px',
        }}
      >
        {m[1]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  if (last < snippet.length) parts.push(snippet.slice(last));
  return parts;
}

interface HitTag {
  emoji: string;
  label: string;
}

function getHitTag(r: SearchResult): HitTag {
  if (r.matchReason?.includes('语义')) return { emoji: '🧠', label: '语义命中' };
  if (r.sourceType === 'segment') return { emoji: '💡', label: 'OCR 匹配' };
  if (r.sourceType === 'episode') return { emoji: '🏷️', label: '标签匹配' };
  if (r.sourceType === 'wiki') return { emoji: '🔗', label: 'Wiki 关联' };
  return { emoji: '🔍', label: r.matchReason || '匹配' };
}

const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  gap: 'var(--space-lg)',
};

const searchBoxStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-md)',
  padding: '12px 20px',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--color-surface)',
  boxShadow: 'var(--shadow-card)',
  border: '1px solid var(--color-border)',
};

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: 15,
  color: 'var(--color-text-main)',
  fontFamily: 'inherit',
};

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-md)',
  fontSize: 12,
  color: 'var(--color-text-muted)',
};

const dateInputStyle: CSSProperties = {
  height: 30,
  padding: '0 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface)',
  fontSize: 12,
  color: 'var(--color-text-main)',
  fontFamily: 'inherit',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  gap: 'var(--space-lg)',
  minHeight: 0,
};

const resultsStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
};

const twoColStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-lg)',
  alignItems: 'start',
};

const colHeaderStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-text-main)',
  marginBottom: 'var(--space-md)',
  paddingBottom: 'var(--space-sm)',
  borderBottom: '1px solid var(--color-border)',
};

const cardStyle: CSSProperties = {
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  boxShadow: 'var(--shadow-card)',
  border: '1px solid var(--color-border)',
  padding: 'var(--space-md) var(--space-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-xs)',
};

const primaryTextStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--color-text-main)',
  lineHeight: 1.4,
};

const snippetStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--color-text-main)',
  lineHeight: 1.6,
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const metaStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-muted)',
};

const tagStyle: CSSProperties = {
  alignSelf: 'flex-start',
  fontSize: 11,
  color: 'var(--color-text-muted)',
  background: 'var(--color-surface-subtle)',
  borderRadius: 'var(--radius-round)',
  padding: '2px 8px',
  marginTop: 2,
};

const panelStyle: CSSProperties = {
  width: 320,
  flex: '0 0 320px',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  boxShadow: 'var(--shadow-card)',
  overflow: 'auto',
};

const centerStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-md)',
  color: 'var(--color-text-light)',
};

export default function SearchView(): JSX.Element {
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<CleanEpisode | null>(null);
  const [episodeLoading, setEpisodeLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // 点击 Episode 命中卡片时按 sourceId 拉取完整 Episode 并唤出详情模态
  const openEpisodeModal = useCallback(async (sourceId: string) => {
    setEpisodeLoading(true);
    try {
      const ep = await api.getEpisodeById(sourceId);
      setSelectedEpisode(ep);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[getEpisodeById] 拉取失败', err);
    } finally {
      setEpisodeLoading(false);
    }
  }, []);

  // Ctrl/Cmd+K 聚焦搜索框
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const debouncedQuery = useDebouncedValue(query, 300);

  const doSearch = useCallback(async (q: string) => {
    const qt = q.trim();
    if (!qt) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    setLoading(true);
    setHasSearched(true);
    try {
      const dateRange = from || to ? { from, to } : undefined;
      const res = await api.searchMemories(qt, dateRange);
      setResults(res ?? []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[searchMemories] 检索失败', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  // 300ms 防抖自动检索（审计意见 2.2：高频 IPC 接口防抖）
  useEffect(() => {
    void doSearch(debouncedQuery);
  }, [debouncedQuery, doSearch]);

  const episodeMatches = results.filter((r) => r.sourceType !== 'segment');
  const ocrSnippets = results.filter((r) => r.sourceType === 'segment');

  return (
    <div style={pageStyle}>
      {/* 搜索框 */}
      <div style={searchBoxStyle}>
        <Search size={18} color="var(--color-text-light)" />
        <input
          ref={inputRef}
          style={inputStyle}
          placeholder="搜索记忆、OCR 文本、Wiki..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doSearch(query);
          }}
          aria-label="全局检索"
        />
        <span style={{ fontSize: 11, color: 'var(--color-text-light)' }}>Ctrl+K</span>
      </div>

      {/* 时间范围 */}
      <div style={toolbarStyle}>
        <span>时间范围</span>
        <input
          type="date"
          style={dateInputStyle}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="起始日期"
        />
        <span>—</span>
        <input
          type="date"
          style={dateInputStyle}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="结束日期"
        />
        {(from || to) && (
          <button
            type="button"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--color-primary)',
              fontSize: 12,
              cursor: 'pointer',
              padding: 0,
            }}
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            清除
          </button>
        )}
      </div>

      <div style={bodyStyle}>
        <div style={resultsStyle}>
          {loading ? (
            <div style={twoColStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton" style={{ height: 96, borderRadius: 'var(--radius-md)' }} />
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton" style={{ height: 96, borderRadius: 'var(--radius-md)' }} />
                ))}
              </div>
            </div>
          ) : !hasSearched ? (
            <div style={centerStyle}>
              <SearchX size={40} color="var(--color-text-light)" />
              <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
                输入关键词开始搜索你的工作记忆
              </div>
            </div>
          ) : results.length === 0 ? (
            <div style={centerStyle}>
              <SearchX size={40} color="var(--color-text-light)" />
              <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
                没有找到相关记忆，换个关键词试试？
              </div>
            </div>
          ) : (
            <div style={twoColStyle}>
              {/* 左栏：最相关逻辑事件 */}
              <div>
                <div style={colHeaderStyle}>最相关逻辑事件 (Episode Matches)</div>
                {episodeMatches.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--color-text-light)' }}>
                    暂无逻辑事件匹配。
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    {episodeMatches.map((r) => {
                      const tag = getHitTag(r);
                      return (
                        <div
                          key={r.sourceId}
                          style={{ ...cardStyle, cursor: 'pointer' }}
                          onClick={() => void openEpisodeModal(r.sourceId)}
                          title="点击查看 Episode 详情"
                        >
                          <div style={primaryTextStyle}>{r.primaryText}</div>
                          <div style={snippetStyle}>{renderSnippet(r.snippet)}</div>
                          <div style={metaStyle}>
                            {r.date}
                            {r.timeRange ? ` · ${r.timeRange}` : ''}
                          </div>
                          <span style={tagStyle}>
                            {tag.emoji} {tag.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 右栏：原始文字匹配 */}
              <div>
                <div style={colHeaderStyle}>原始文字匹配 (OCR Snippets)</div>
                {ocrSnippets.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--color-text-light)' }}>
                    暂无 OCR 文本匹配。
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    {ocrSnippets.map((r) => {
                      const tag = getHitTag(r);
                      return (
                        <div
                          key={r.sourceId}
                          style={cardStyle}
                          onDoubleClick={() => setSelected(r)}
                          title="双击反查原始 Segment 详情"
                        >
                          <div style={primaryTextStyle}>{r.primaryText}</div>
                          <div style={snippetStyle}>{renderSnippet(r.snippet)}</div>
                          <div style={metaStyle}>
                            {r.date}
                            {r.timeRange ? ` · ${r.timeRange}` : ''}
                          </div>
                          <span style={tagStyle}>
                            {tag.emoji} {tag.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 右侧反查 Context 面板（双击 OCR Snippet 触发） */}
        {selected ? (
          <aside style={panelStyle} aria-label="Segment 反查">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-md) var(--space-lg)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-main)' }}>
                Segment 反查
              </span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setSelected(null)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-light)',
                  cursor: 'pointer',
                  display: 'flex',
                  padding: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-main)' }}>
                {selected.primaryText}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-main)',
                  lineHeight: 1.7,
                  background: 'var(--color-surface-subtle)',
                  padding: 'var(--space-md)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {renderSnippet(selected.snippet)}
              </div>
              <Row label="来源 ID" value={selected.sourceId} />
              <Row label="来源类型" value={selected.sourceType} />
              <Row label="日期" value={selected.date} />
              <Row label="时间范围" value={selected.timeRange || '—'} />
              <Row label="命中原因" value={selected.matchReason} />
              <Row label="相关度" value={selected.score.toFixed(2)} />
              <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginTop: 4 }}>
                提示：双击 OCR 片段可在此反查其归属的原始 Segment 上下文。
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <MemoryFullscreenModal
        episode={selectedEpisode}
        open={!!selectedEpisode}
        onOpenChange={(o) => !o && setSelectedEpisode(null)}
      />
      {episodeLoading ? (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            padding: '6px 12px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-card)',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            zIndex: 9000,
          }}
        >
          加载 Episode 详情…
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-md)', fontSize: 12 }}>
      <span style={{ color: 'var(--color-text-light)', width: 64, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}
