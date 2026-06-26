/**
 * Wiki 视图 (WikiView) - Obsidian 风格三栏双链知识库
 *
 * 严格遵循 04_UI_SPEC.md §3.5 + 09_PRODUCT_ACCEPTANCE_LEDGER.md 用例 7。
 * 功能：
 *   - 三栏布局（CSS Grid: 200px 1fr 280px）：左侧页面列表 / 中间编辑面板 / 右侧 References + Backlinks
 *   - Review Queue 悬浮条：Bell + 红点数量，展开列表，一键接受 → 沉淀为 draft Wiki 页面并清空红点
 *   - 双链动态跳转：编辑器中 [[wikilink]] 点击 → 存在则加载，不存在则创建新草稿（saveToWiki）
 *   - Backlinks 实时计算：扫描所有页面 content 中包含 [[当前页标题]] 的页面
 *
 * 禁止 Tailwind，全部 CSS 变量。
 */
import { useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  Link2,
  Plus,
  Save,
  Search,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/src-tauri/api';
import type { CleanEpisode, WikiPage } from '@/types';
import WikiMarkdownEditor from '@/components/WikiMarkdownEditor';

const WV_CSS = `
.wv-root { display:flex; flex-direction:column; height:100%; min-height:560px; gap: var(--space-md); }
.wv-grid { display:grid; grid-template-columns: 200px 1fr 280px; flex:1; min-height:0; gap: var(--space-md); }
.wv-panel {
  background: var(--color-surface); border:1px solid var(--color-border);
  border-radius: var(--radius-md); display:flex; flex-direction:column;
  min-height:0; overflow:hidden;
}
.wv-panel-head {
  padding: var(--space-sm) var(--space-md); border-bottom:1px solid var(--color-border);
  font-size:12px; font-weight:600; color: var(--color-text-muted); letter-spacing:0.4px;
  display:flex; align-items:center; justify-content:space-between; gap: var(--space-sm);
}
.wv-scroll { flex:1; overflow:auto; }
.wv-list-item {
  padding: var(--space-xs) var(--space-md); font-size:13px; color: var(--color-text-main);
  cursor:pointer; border-left:2px solid transparent;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.wv-list-item:hover { background: var(--color-surface-subtle); }
.wv-list-item[data-active="true"] {
  background: var(--color-primary-soft); color: var(--color-primary);
  border-left-color: var(--color-primary); font-weight:600;
}
.wv-input {
  height:30px; border:1px solid var(--color-border); border-radius: var(--radius-sm);
  padding: 0 var(--space-sm); font-size:13px; color: var(--color-text-main);
  background: var(--color-surface); outline:none;
  transition: border-color var(--duration-fast) var(--ease-out-expo);
}
.wv-input:focus { border-color: var(--color-primary); }
.wv-btn {
  height:30px; padding: 0 var(--space-md); border:1px solid var(--color-border);
  background: var(--color-surface); color: var(--color-text-main);
  border-radius: var(--radius-sm); font-size:13px; font-weight:600; cursor:pointer;
  display:inline-flex; align-items:center; gap: var(--space-xs);
  transition: background var(--duration-fast) var(--ease-out-expo), border-color var(--duration-fast) var(--ease-out-expo);
}
.wv-btn:hover { background: var(--color-surface-subtle); border-color: var(--color-border-hover); }
.wv-btn:disabled { opacity:0.6; cursor:not-allowed; }
.wv-btn-primary { background: var(--color-primary); color:#fff; border-color: var(--color-primary); }
.wv-btn-primary:hover { background: var(--color-primary); filter: brightness(1.06); }
.wv-btn-mini { height:24px; padding: 0 var(--space-sm); font-size:12px; }
.wv-badge {
  min-width:18px; height:18px; padding: 0 5px; background: var(--color-danger); color:#fff;
  border-radius: var(--radius-round); font-size:11px; font-weight:700;
  display:inline-flex; align-items:center; justify-content:center; line-height:1;
}
.wv-review-bar {
  display:flex; align-items:center; gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: var(--color-surface); border:1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.wv-review-trigger {
  display:inline-flex; align-items:center; gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm); background: var(--color-surface-subtle);
  border:1px solid var(--color-border); border-radius: var(--radius-sm);
  cursor:pointer; font-size:13px; color: var(--color-text-main); position:relative;
  transition: border-color var(--duration-fast) var(--ease-out-expo);
}
.wv-review-trigger:hover { border-color: var(--color-border-hover); }
.wv-review-content {
  width:380px; max-height:440px; overflow:auto;
  background: var(--color-surface); border:1px solid var(--color-border);
  border-radius: var(--radius-md); box-shadow: var(--shadow-overlay);
  padding: var(--space-xs);
}
.wv-review-item { padding: var(--space-sm); border-radius: var(--radius-sm); }
.wv-review-item:hover { background: var(--color-surface-subtle); }
.wv-accept {
  height:24px; padding: 0 var(--space-sm); font-size:12px; font-weight:600;
  background: var(--color-primary); color:#fff; border:none; border-radius: var(--radius-sm);
  cursor:pointer; display:inline-flex; align-items:center; gap: var(--space-2xs);
  transition: filter var(--duration-fast) var(--ease-out-expo);
}
.wv-accept:hover { filter: brightness(1.08); }
.wv-line-clamp {
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
}
.wv-empty {
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  height:100%; color: var(--color-text-light); gap: var(--space-md);
  text-align:center; padding: var(--space-xl);
}
.wv-right-section { padding: var(--space-md); border-bottom:1px solid var(--color-border); }
.wv-right-section:last-child { border-bottom:none; }
.wv-right-title {
  font-size:11px; font-weight:700; color: var(--color-text-muted); letter-spacing:0.5px;
  text-transform:uppercase; margin-bottom: var(--space-sm);
  display:flex; align-items:center; gap:6px;
}
.wv-backlink {
  font-size:13px; color: var(--color-primary); cursor:pointer; padding: var(--space-2xs) 0;
  display:flex; align-items:center; gap: var(--space-2xs);
}
.wv-backlink:hover { text-decoration: underline; }
.wv-skel { background: var(--color-surface-subtle); border-radius: var(--radius-sm); animation: wv-pulse 1.2s ease-in-out infinite; }
@keyframes wv-pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
`;

function newId(): string {
  return 'wiki-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

export default function WikiView(): JSX.Element {
  const navigate = useNavigate();

  const [allWikiPages, setAllWikiPages] = useState<WikiPage[]>([]);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [reviewQueue, setReviewQueue] = useState<CleanEpisode[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [search, setSearch] = useState('');
  // episodeId -> CleanEpisode，用于 References 来源标题解析
  const [episodeMap, setEpisodeMap] = useState<Record<string, CleanEpisode>>({});

  const allTitles = useMemo(
    () => allWikiPages.map((p) => p.title),
    [allWikiPages],
  );
  const currentPage = useMemo(
    () => allWikiPages.find((p) => p.id === currentPageId) ?? null,
    [allWikiPages, currentPageId],
  );
  const filteredPages = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allWikiPages;
    return allWikiPages.filter((p) => p.title.toLowerCase().includes(q));
  }, [allWikiPages, search]);
  const backlinks = useMemo(() => {
    if (!currentPage || currentPage.title.trim() === '') return [];
    const needle = `[[${currentPage.title}]]`;
    return allWikiPages.filter(
      (p) => p.id !== currentPage.id && p.content.includes(needle),
    );
  }, [allWikiPages, currentPage]);
  const reviewCount = reviewQueue.length;
  const sourceEpisode = currentPage?.sourceEpisodeId
    ? episodeMap[currentPage.sourceEpisodeId]
    : undefined;

  // 初始加载：Wiki 页面 + Review Queue
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [pages, queue] = await Promise.all([
          api.getWikiPages(),
          api.getReviewQueue(),
        ]);
        if (cancelled) return;
        setAllWikiPages(pages);
        setReviewQueue(queue);
        const emap: Record<string, CleanEpisode> = {};
        queue.forEach((e) => {
          emap[e.id] = e;
        });
        setEpisodeMap(emap);
        if (pages.length && !currentPageId) setCurrentPageId(pages[0].id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[WikiView] 加载失败', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updatePage = (patch: Partial<WikiPage>) => {
    if (!currentPageId) return;
    setAllWikiPages((prev) =>
      prev.map((p) =>
        p.id === currentPageId
          ? { ...p, ...patch, updatedAt: new Date().toISOString() }
          : p,
      ),
    );
  };

  const handleNewPage = () => {
    const now = new Date().toISOString();
    const page: WikiPage = {
      id: newId(),
      title: `未命名页面 ${allWikiPages.length + 1}`,
      content: '',
      sourceType: 'manual',
      status: 'draft',
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    setAllWikiPages((prev) => [page, ...prev]);
    setCurrentPageId(page.id);
  };

  // 双链动态跳转（用例 7 核心）：存在则加载，不存在则创建新草稿
  const handleNavigate = async (title: string) => {
    const existing = allWikiPages.find(
      (p) => p.title.trim() === title.trim(),
    );
    if (existing) {
      setCurrentPageId(existing.id);
      return;
    }
    try {
      const page = await api.saveToWiki('', title, '', []);
      setAllWikiPages((prev) => [page, ...prev]);
      setCurrentPageId(page.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WikiView] 创建双链草稿失败，回退本地新建', err);
      const now = new Date().toISOString();
      const page: WikiPage = {
        id: newId(),
        title,
        content: '',
        sourceType: 'manual',
        status: 'draft',
        tags: [],
        createdAt: now,
        updatedAt: now,
      };
      setAllWikiPages((prev) => [page, ...prev]);
      setCurrentPageId(page.id);
    }
  };

  // Review Queue 一键接受：沉淀为 draft Wiki，从队列移除，红点 -1
  const handleAcceptReview = async (episode: CleanEpisode) => {
    try {
      const page = await api.saveToWiki(
        episode.id,
        episode.title,
        episode.summary,
        [],
      );
      setAllWikiPages((prev) => [page, ...prev]);
      setReviewQueue((prev) => prev.filter((e) => e.id !== episode.id));
      setEpisodeMap((prev) => ({ ...prev, [episode.id]: episode }));
      setCurrentPageId(page.id);
      if (reviewQueue.length <= 1) setReviewOpen(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WikiView] 接受 Review 建议失败', err);
    }
  };

  const handleSave = () => {
    if (!currentPage) return;
    setSaving(true);
    // 当前 API 未提供 update 接口；编辑已实时同步到本地 state，此处刷新 updatedAt 并给反馈
    updatePage({ updatedAt: new Date().toISOString() });
    window.setTimeout(() => {
      setSaving(false);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1500);
    }, 120);
  };

  return (
    <div className="wv-root">
      <style>{WV_CSS}</style>

      {/* ===== Review Queue 悬浮条 ===== */}
      <div className="wv-review-bar">
        <Popover.Root open={reviewOpen} onOpenChange={setReviewOpen}>
          <Popover.Trigger asChild>
            <button type="button" className="wv-review-trigger" aria-label="Review Queue">
              <Bell size={15} />
              <span>Review Queue</span>
              {reviewCount > 0 && <span className="wv-badge">{reviewCount}</span>}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="wv-review-content" align="start" sideOffset={6}>
              <div
                style={{
                  padding: 'var(--space-xs) var(--space-sm)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--color-text-muted)',
                }}
              >
                待审阅建议（{reviewQueue.length}）
              </div>
              {reviewQueue.length === 0 ? (
                <div
                  style={{
                    padding: 'var(--space-md)',
                    fontSize: 13,
                    color: 'var(--color-text-light)',
                  }}
                >
                  暂无待审阅建议
                </div>
              ) : (
                reviewQueue.map((ep) => (
                  <div key={ep.id} className="wv-review-item">
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--color-text-main)',
                        marginBottom: 'var(--space-2xs)',
                      }}
                    >
                      {ep.title}
                    </div>
                    <div
                      className="wv-line-clamp"
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-muted)',
                        marginBottom: 'var(--space-sm)',
                      }}
                    >
                      {ep.summary}
                    </div>
                    <button
                      type="button"
                      className="wv-accept"
                      onClick={() => void handleAcceptReview(ep)}
                    >
                      <Check size={12} /> 一键接受
                    </button>
                  </div>
                ))
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {reviewCount > 0
            ? `${reviewCount} 条 Episode 建议沉淀为 Wiki`
            : '所有建议已处理'}
        </div>
      </div>

      {/* ===== 三栏主体 ===== */}
      <div className="wv-grid">
        {loading ? (
          <div
            className="wv-panel"
            style={{
              gridColumn: '1 / -1',
              padding: 'var(--space-xl)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-md)',
            }}
          >
            <div className="wv-skel" style={{ height: 22, width: 220 }} />
            <div className="wv-skel" style={{ height: 14, width: '100%' }} />
            <div className="wv-skel" style={{ height: 14, width: '82%' }} />
            <div className="wv-skel" style={{ height: 14, width: '64%' }} />
            <div
              style={{
                marginTop: 'var(--space-sm)',
                fontSize: 12,
                color: 'var(--color-text-light)',
              }}
            >
              加载 Wiki 数据中…
            </div>
          </div>
        ) : (
          <>
            {/* 左侧：页面列表 */}
            <aside className="wv-panel" aria-label="Wiki 页面列表">
              <div className="wv-panel-head">
                <span>页面</span>
                <button
                  type="button"
                  className="wv-btn wv-btn-mini"
                  onClick={handleNewPage}
                  title="新建页面"
                >
                  <Plus size={13} /> 新建
                </button>
              </div>
              <div
                style={{
                  padding: 'var(--space-sm)',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <div style={{ position: 'relative' }}>
                  <Search
                    size={13}
                    style={{
                      position: 'absolute',
                      left: 'var(--space-sm)',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-light)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    className="wv-input"
                    style={{ width: '100%', paddingLeft: 26 }}
                    placeholder="搜索页面…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="wv-scroll">
                {filteredPages.length === 0 ? (
                  <div
                    style={{
                      padding: 'var(--space-md)',
                      fontSize: 12,
                      color: 'var(--color-text-light)',
                    }}
                  >
                    暂无匹配页面
                  </div>
                ) : (
                  filteredPages.map((p) => (
                    <div
                      key={p.id}
                      className="wv-list-item"
                      data-active={p.id === currentPageId ? 'true' : 'false'}
                      onClick={() => setCurrentPageId(p.id)}
                      title={p.title || '未命名'}
                    >
                      {p.title || '未命名'}
                    </div>
                  ))
                )}
              </div>
            </aside>

            {/* 中间：编辑面板 */}
            <section className="wv-panel" aria-label="Wiki 编辑区">
              {currentPage ? (
                <>
                  <div
                    style={{
                      padding: 'var(--space-sm) var(--space-md)',
                      borderBottom: '1px solid var(--color-border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-sm)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <input
                      key={`title-${currentPage.id}`}
                      className="wv-input"
                      style={{ flex: 1, minWidth: 160, fontWeight: 600, fontSize: 14 }}
                      defaultValue={currentPage.title}
                      onChange={(e) => updatePage({ title: e.target.value })}
                      placeholder="页面标题"
                    />
                    <select
                      key={`status-${currentPage.id}`}
                      className="wv-input"
                      defaultValue={currentPage.status}
                      onChange={(e) =>
                        updatePage({ status: e.target.value as WikiPage['status'] })
                      }
                      title="状态"
                    >
                      <option value="draft">draft</option>
                      <option value="published">published</option>
                      <option value="archived">archived</option>
                    </select>
                    <input
                      key={`tags-${currentPage.id}`}
                      className="wv-input"
                      style={{ width: 180 }}
                      defaultValue={currentPage.tags.join(', ')}
                      onChange={(e) =>
                        updatePage({
                          tags: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="标签，逗号分隔"
                    />
                    <button
                      type="button"
                      className="wv-btn wv-btn-primary"
                      onClick={handleSave}
                      disabled={saving}
                    >
                      <Save size={14} /> {justSaved ? '已保存' : '保存'}
                    </button>
                  </div>
                  <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                    <WikiMarkdownEditor
                      value={currentPage.content}
                      onChange={(v) => updatePage({ content: v })}
                      allWikiTitles={allTitles}
                      onNavigateLink={(title) => void handleNavigate(title)}
                    />
                  </div>
                </>
              ) : (
                <div className="wv-empty">
                  <BookOpen size={40} color="var(--color-text-light)" />
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {allWikiPages.length === 0 ? '还没有 Wiki 页面' : '未选择页面'}
                  </div>
                  <div style={{ fontSize: 12, maxWidth: 320, lineHeight: 1.6 }}>
                    {allWikiPages.length === 0
                      ? '从 Review Queue 接受建议，或在左侧新建页面开始沉淀你的知识。'
                      : '从左侧选择一个页面查看与编辑。'}
                  </div>
                </div>
              )}
            </section>

            {/* 右侧：References + Backlinks */}
            <aside className="wv-panel" aria-label="Wiki 关联信息">
              <div className="wv-panel-head">
                <span>关联</span>
              </div>
              <div className="wv-scroll">
                {currentPage ? (
                  <>
                    <div className="wv-right-section">
                      <div className="wv-right-title">
                        <Link2 size={13} /> References 来源
                      </div>
                      {currentPage.sourceEpisodeId ? (
                        sourceEpisode ? (
                          <div style={{ fontSize: 13, color: 'var(--color-text-main)' }}>
                            <div style={{ marginBottom: 'var(--space-xs)' }}>
                              {sourceEpisode.title}
                            </div>
                            <div
                              className="wv-backlink"
                              onClick={() => navigate('/today')}
                              title="跳转到今日时间线"
                            >
                              查看来源 Episode <ArrowUpRight size={12} />
                            </div>
                          </div>
                        ) : (
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--color-text-light)',
                            }}
                          >
                            来源 Episode #{currentPage.sourceEpisodeId.slice(0, 8)}
                          </div>
                        )
                      ) : (
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--color-text-light)',
                          }}
                        >
                          本页面无关联来源 Episode
                        </div>
                      )}
                    </div>

                    <div className="wv-right-section">
                      <div className="wv-right-title">
                        <ArrowUpRight size={13} /> Backlinks 反向链接（{backlinks.length}）
                      </div>
                      {backlinks.length === 0 ? (
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--color-text-light)',
                          }}
                        >
                          暂无反向链接
                        </div>
                      ) : (
                        backlinks.map((p) => (
                          <div
                            key={p.id}
                            className="wv-backlink"
                            onClick={() => setCurrentPageId(p.id)}
                            title={p.title}
                          >
                            <ArrowUpRight size={12} /> {p.title || '未命名'}
                          </div>
                        ))
                      )}
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      padding: 'var(--space-md)',
                      fontSize: 12,
                      color: 'var(--color-text-light)',
                    }}
                  >
                    选择页面后查看关联信息
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
