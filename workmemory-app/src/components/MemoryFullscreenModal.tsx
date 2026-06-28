/**
 * 记忆详情全屏模态 (audit-v4-hardening Task 16 / 04_UI_SPEC.md §3.5)
 *
 * 基于 Radix Dialog 实现的大尺寸记忆详情模态，扩展 MemoryCard 的内容呈现：
 *   - Header：可编辑标题 + 关闭 + 时间范围 + 持续时长
 *   - 元信息卡片：来源 / 应用列表 / Wiki 徽章
 *   - 完整摘要
 *   - 证据链时间轴（应用切换 / OCR / 用户操作）
 *   - 素材区：OCR 文本（可折叠）+ 截图（best-effort 拉取）
 *   - 关联结构：Todo / Wiki 链接
 *   - 底部操作栏：编辑 / 保存到 Wiki / 删除（二次确认） / 导出 Markdown
 *
 * 键盘交互：
 *   - Esc 关闭（Radix 默认）
 *   - Ctrl/Cmd+E 进入编辑
 *   - Ctrl/Cmd+S 保存编辑（持久化到后端）
 */
import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X,
  Edit3,
  Check,
  Trash2,
  Download,
  BookMarked,
  ChevronDown,
  ChevronUp,
  Clock,
  AppWindow,
  FileText,
  ImageIcon,
} from 'lucide-react';
import type { CleanEpisode } from '@/types';
import { api } from '@/src-tauri/api';
import { toast } from '@/store/toastStore';
import { downloadText } from '@/utils/download';
import SourceBadge from './SourceBadge';
import ConfirmDialog from './ConfirmDialog';

export interface MemoryFullscreenModalProps {
  episode: CleanEpisode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ===== 时间工具（与 MemoryCard 一致） ===== */
function parseTimeToSec(t: string): number {
  const parts = t.split(':').map(Number);
  const [h = 0, m = 0, s = 0] = parts;
  return h * 3600 + m * 60 + s;
}
function fmtHM(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':');
  return `${h}:${m}`;
}
function durationMinutes(start: string, end: string): number {
  return Math.max(0, Math.round((parseTimeToSec(end) - parseTimeToSec(start)) / 60));
}

/** 截图 DTO：兼容 string[] 与对象数组两种返回结构 */
interface ScreenshotItem {
  path: string;
  label?: string;
}
function normalizeScreenshots(raw: unknown): ScreenshotItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      if (typeof s === 'string') return { path: s };
      if (s && typeof s === 'object' && 'path' in s) {
        const obj = s as { path?: string; label?: string };
        return { path: obj.path ?? '', label: obj.label };
      }
      return null;
    })
    .filter((s): s is ScreenshotItem => !!s && !!s.path);
}

const OCR_COLLAPSE_THRESHOLD = 200;

export default function MemoryFullscreenModal(
  props: MemoryFullscreenModalProps,
): JSX.Element | null {
  const { episode, open, onOpenChange } = props;

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [ocrExpanded, setOcrExpanded] = useState(false);
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
  const [screenshotsLoading, setScreenshotsLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [wikiSaving, setWikiSaving] = useState(false);

  const episodeId = episode?.id;

  // Episode 切换时重置 draft / OCR / 截图
  useEffect(() => {
    if (!episode) return;
    setDraftTitle(episode.title);
    setDraftSummary(episode.summary);
    setEditing(false);
    setOcrExpanded(false);
    setScreenshots([]);
  }, [episodeId, episode]);

  // 拉取截图（命令不存在时降级为"暂无截图"）
  useEffect(() => {
    if (!open || !episode) return;
    let cancelled = false;
    setScreenshotsLoading(true);
    api
      .invoke<unknown>('get_episode_screenshots', { id: episode.id })
      .then((res) => {
        if (!cancelled) setScreenshots(normalizeScreenshots(res));
      })
      .catch(() => {
        if (!cancelled) setScreenshots([]);
      })
      .finally(() => {
        if (!cancelled) setScreenshotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, episodeId, episode]);

  const startEdit = useCallback(() => {
    if (!episode) return;
    setDraftTitle(episode.title);
    setDraftSummary(episode.summary);
    setEditing(true);
  }, [episode]);

  const cancelEdit = useCallback(() => {
    if (!episode) return;
    setDraftTitle(episode.title);
    setDraftSummary(episode.summary);
    setEditing(false);
  }, [episode]);

  const commitEdit = useCallback(async () => {
    if (!episode) return;
    const title = draftTitle.trim() || episode.title;
    const summary = draftSummary.trim();
    setSaving(true);
    try {
      await api.updateEpisodeTitleSummary(episode.id, title, summary);
      setEditing(false);
      toast.success('已保存');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[MemoryFullscreenModal] 保存失败', err);
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  }, [episode, draftTitle, draftSummary]);

  // Ctrl/Cmd+E 编辑、Ctrl/Cmd+S 保存（编辑态下生效，避免与浏览器默认行为冲突）
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'e') {
        e.preventDefault();
        if (!editing) startEdit();
      } else if (key === 's') {
        e.preventDefault();
        if (editing) void commitEdit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, editing, startEdit, commitEdit]);

  const handleSaveToWiki = useCallback(async () => {
    if (!episode) return;
    setWikiSaving(true);
    try {
      await api.saveToWiki(
        episode.id,
        episode.title,
        episode.summary,
        episode.topics ?? [],
      );
      toast.success('已保存到 Wiki');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[MemoryFullscreenModal] saveToWiki 失败', err);
      toast.error('保存到 Wiki 失败');
    } finally {
      setWikiSaving(false);
    }
  }, [episode]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!episode) return;
    setDeleting(true);
    try {
      await api.invoke<void>('delete_episode', { id: episode.id });
      toast.success('已删除');
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[MemoryFullscreenModal] delete_episode 失败', err);
      toast.error('删除失败');
    } finally {
      setDeleting(false);
    }
  }, [episode, onOpenChange]);

  const handleExport = useCallback(() => {
    if (!episode) return;
    const lines: string[] = [];
    lines.push(`# ${episode.title}`);
    lines.push('');
    lines.push(`- **日期**: ${episode.date}`);
    lines.push(`- **时间**: ${fmtHM(episode.startTime)} - ${fmtHM(episode.endTime)}`);
    lines.push(`- **持续**: ${durationMinutes(episode.startTime, episode.endTime)} 分钟`);
    if (episode.project) lines.push(`- **项目**: ${episode.project}`);
    if (episode.entities?.length) {
      lines.push(`- **实体**: ${episode.entities.join(', ')}`);
    }
    if (episode.topics?.length) {
      lines.push(`- **主题**: ${episode.topics.join(', ')}`);
    }
    lines.push('');
    lines.push('## 摘要');
    lines.push('');
    lines.push(episode.summary || '（暂无摘要）');
    if (episode.todos?.length) {
      lines.push('');
      lines.push('## 关联任务');
      lines.push('');
      for (const t of episode.todos) lines.push(`- ${t}`);
    }
    if (episode.blockers?.length) {
      lines.push('');
      lines.push('## 阻塞项');
      lines.push('');
      for (const b of episode.blockers) lines.push(`- ${b}`);
    }
    if (episode.outputs?.length) {
      lines.push('');
      lines.push('## 产出');
      lines.push('');
      for (const o of episode.outputs) lines.push(`- ${o}`);
    }
    const md = lines.join('\n') + '\n';
    const fname = `${episode.date || 'memory'}-${episode.id}.md`;
    downloadText(fname, md, 'text/markdown;charset=utf-8');
  }, [episode]);

  if (!episode) return null;

  const durMin = durationMinutes(episode.startTime, episode.endTime);
  const wikiSaved = episode.wikiStatus === 'saved';
  const evidenceCount = episode.segmentIds?.length ?? 0;
  const appList = (episode.entities ?? []).length
    ? episode.entities
    : episode.project
      ? [episode.project]
      : [];
  const todos = episode.todos ?? [];
  const ocrText = (episode as CleanEpisode & { ocrTextExcerpt?: string }).ocrTextExcerpt ?? '';
  const ocrCollapsible = ocrText.length > OCR_COLLAPSE_THRESHOLD;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 10000,
          }}
        />
        <Dialog.Content
          aria-label="记忆详情"
          onEscapeKeyDown={(e) => {
            // 编辑态下 Esc 优先取消编辑，不关闭模态
            if (editing) {
              e.preventDefault();
              cancelEdit();
            }
          }}
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '90vw',
            maxWidth: 1200,
            height: '85vh',
            maxHeight: '85vh',
            background: 'var(--color-surface)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-overlay)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 10001,
          }}
        >
          {/* ===== Sticky Header ===== */}
          <Dialog.Title asChild>
            <header
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                background: 'var(--color-surface)',
                borderBottom: '1px solid var(--color-border)',
                padding: 'var(--space-lg) var(--space-xl)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-sm)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 'var(--space-md)',
                }}
              >
                {editing ? (
                  <input
                    aria-label="标题编辑"
                    autoFocus
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void commitEdit();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEdit();
                      }
                    }}
                    style={{
                      flex: 1,
                      fontSize: 20,
                      fontWeight: 700,
                      color: 'var(--color-text-main)',
                      border: '1px solid var(--color-primary)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 8px',
                      outline: 'none',
                      background: 'var(--color-surface)',
                      fontFamily: 'inherit',
                    }}
                  />
                ) : (
                  <div
                    data-testid="modal-title"
                    onDoubleClick={startEdit}
                    title="双击编辑标题（或 Ctrl+E）"
                    style={{
                      flex: 1,
                      fontSize: 20,
                      fontWeight: 700,
                      color: 'var(--color-text-main)',
                      cursor: 'text',
                      lineHeight: 1.4,
                      wordBreak: 'break-word',
                    }}
                  >
                    {episode.title}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {editing && (
                    <>
                      <button
                        type="button"
                        aria-label="保存标题"
                        onClick={() => void commitEdit()}
                        disabled={saving}
                        style={iconBtnStyle(true)}
                      >
                        <Check size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label="取消编辑"
                        onClick={cancelEdit}
                        style={iconBtnStyle(false)}
                      >
                        <X size={16} />
                      </button>
                    </>
                  )}
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label="关闭"
                      style={iconBtnStyle(false)}
                    >
                      <X size={18} />
                    </button>
                  </Dialog.Close>
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-md)',
                  fontSize: 12,
                  color: 'var(--color-text-light)',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Clock size={12} />
                  {fmtHM(episode.startTime)} - {fmtHM(episode.endTime)}
                </span>
                <span style={chipStyle}>{durMin} min</span>
                {episode.project && (
                  <span style={chipStyle}>📂 {episode.project}</span>
                )}
              </div>
            </header>
          </Dialog.Title>

          {/* ===== Body（垂直滚动） ===== */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 'var(--space-xl)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-xl)',
            }}
          >
            {/* 元信息卡片 */}
            <section aria-label="元信息">
              <SectionTitle icon={<AppWindow size={14} />} text="元信息" />
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--space-xs)',
                  marginTop: 'var(--space-sm)',
                }}
              >
                <SourceBadge appName={episode.project || '未知应用'} />
                {appList.map((app) => (
                  <span key={app} style={chipStyle}>
                    🏷️ {app}
                  </span>
                ))}
                <span style={chipStyle}>
                  🔗 {evidenceCount} 证据
                </span>
                <span
                  style={{
                    ...chipStyle,
                    color: wikiSaved
                      ? 'var(--color-success)'
                      : episode.wikiEligible
                        ? 'var(--color-primary)'
                        : 'var(--color-text-light)',
                  }}
                >
                  📚 Wiki: {wikiStatusText(episode.wikiStatus)}
                </span>
              </div>
            </section>

            {/* 摘要 */}
            <section aria-label="摘要">
              <SectionTitle icon={<FileText size={14} />} text="摘要" />
              {editing ? (
                <textarea
                  aria-label="摘要编辑"
                  value={draftSummary}
                  onChange={(e) => setDraftSummary(e.target.value)}
                  rows={4}
                  style={{
                    width: '100%',
                    marginTop: 'var(--space-sm)',
                    fontSize: 14,
                    color: 'var(--color-text-main)',
                    lineHeight: 1.7,
                    border: '1px solid var(--color-primary)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-sm) var(--space-md)',
                    outline: 'none',
                    resize: 'vertical',
                    background: 'var(--color-surface)',
                    fontFamily: 'inherit',
                  }}
                />
              ) : (
                <p
                  style={{
                    marginTop: 'var(--space-sm)',
                    fontSize: 14,
                    color: 'var(--color-text-main)',
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {episode.summary || '（暂无摘要）'}
                </p>
              )}
            </section>

            {/* 证据链时间轴 */}
            <section aria-label="证据链时间轴">
              <SectionTitle icon={<Clock size={14} />} text="证据链时间轴" />
              <div
                style={{
                  marginTop: 'var(--space-sm)',
                  paddingLeft: 'var(--space-sm)',
                  borderLeft: '2px solid var(--color-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-sm)',
                }}
              >
                <TimelineItem
                  time={fmtHM(episode.startTime)}
                  title="开始"
                  desc={`进入 ${episode.project || '工作'} 上下文`}
                />
                {appList.map((app, i) => (
                  <TimelineItem
                    key={app + i}
                    title="应用切换"
                    desc={app}
                  />
                ))}
                {ocrText && (
                  <TimelineItem
                    title="OCR 摘要"
                    desc={ocrText.slice(0, 80) + (ocrText.length > 80 ? '…' : '')}
                  />
                )}
                {todos.length > 0 && (
                  <TimelineItem
                    title="用户操作"
                    desc={`记录 ${todos.length} 项待办`}
                  />
                )}
                <TimelineItem
                  time={fmtHM(episode.endTime)}
                  title="结束"
                  desc={`持续 ${durMin} 分钟`}
                />
              </div>
            </section>

            {/* 素材区：OCR 文本 + 截图 */}
            <section aria-label="素材">
              <SectionTitle icon={<ImageIcon size={14} />} text="素材" />

              {ocrText ? (
                <div style={{ marginTop: 'var(--space-sm)' }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-light)',
                      marginBottom: 4,
                    }}
                  >
                    OCR 文本
                  </div>
                  <div
                    style={{
                      background: 'var(--color-surface-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-sm) var(--space-md)',
                      fontSize: 13,
                      color: 'var(--color-text-main)',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: ocrExpanded ? 'none' : 120,
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {ocrText}
                  </div>
                  {ocrCollapsible && (
                    <button
                      type="button"
                      onClick={() => setOcrExpanded((v) => !v)}
                      style={{
                        marginTop: 4,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--color-primary)',
                        fontSize: 12,
                        cursor: 'pointer',
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {ocrExpanded ? (
                        <>
                          <ChevronUp size={12} /> 折叠
                        </>
                      ) : (
                        <>
                          <ChevronDown size={12} /> 展开
                        </>
                      )}
                    </button>
                  )}
                </div>
              ) : (
                <div style={emptyTextStyle}>暂无 OCR 文本</div>
              )}

              <div style={{ marginTop: 'var(--space-md)' }}>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-light)',
                    marginBottom: 4,
                  }}
                >
                  截图
                </div>
                {screenshotsLoading ? (
                  <div style={emptyTextStyle}>加载中…</div>
                ) : screenshots.length === 0 ? (
                  <div style={emptyTextStyle}>暂无截图</div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                      gap: 'var(--space-sm)',
                    }}
                  >
                    {screenshots.map((s) => (
                      <div
                        key={s.path}
                        style={{
                          background: 'var(--color-surface-subtle)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: 'var(--space-sm)',
                          fontSize: 12,
                          color: 'var(--color-text-muted)',
                          wordBreak: 'break-all',
                        }}
                        title={s.path}
                      >
                        🖼️ {s.label || s.path.split(/[\\/]/).pop() || s.path}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* 关联结构 */}
            <section aria-label="关联结构">
              <SectionTitle icon={<FileText size={14} />} text="关联结构" />

              <div style={{ marginTop: 'var(--space-sm)' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginBottom: 4 }}>
                  关联任务（{todos.length}）
                </div>
                {todos.length === 0 ? (
                  <div style={emptyTextStyle}>无关联任务</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--color-text-main)', lineHeight: 1.7 }}>
                    {todos.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div style={{ marginTop: 'var(--space-md)' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginBottom: 4 }}>
                  关联 Wiki 页面
                </div>
                {wikiSaved ? (
                  <span
                    style={{
                      ...chipStyle,
                      color: 'var(--color-success)',
                      cursor: 'pointer',
                    }}
                    title="查看 Wiki 页面"
                  >
                    📚 已保存到 Wiki
                  </span>
                ) : (
                  <div style={emptyTextStyle}>尚未保存到 Wiki</div>
                )}
              </div>
            </section>
          </div>

          {/* ===== 底部操作栏 ===== */}
          <footer
            style={{
              borderTop: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              padding: 'var(--space-md) var(--space-xl)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 'var(--space-sm)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => (editing ? void commitEdit() : startEdit())}
              disabled={saving}
              style={footerBtnStyle(false)}
            >
              <Edit3 size={14} />
              {editing ? '保存编辑' : '编辑标题/摘要'}
            </button>
            <button
              type="button"
              onClick={() => void handleSaveToWiki()}
              disabled={wikiSaving || (!episode.wikiEligible && !wikiSaved)}
              style={{
                ...footerBtnStyle(false),
                opacity: wikiSaving || (!episode.wikiEligible && !wikiSaved) ? 0.5 : 1,
                cursor:
                  wikiSaving || (!episode.wikiEligible && !wikiSaved)
                    ? 'not-allowed'
                    : 'pointer',
              }}
            >
              <BookMarked size={14} />
              {wikiSaved ? '已保存到 Wiki' : '保存到 Wiki'}
            </button>
            <button
              type="button"
              onClick={handleExport}
              style={footerBtnStyle(false)}
            >
              <Download size={14} />
              导出
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              style={{
                ...footerBtnStyle(true),
              }}
            >
              <Trash2 size={14} />
              删除
            </button>
          </footer>

          {/* 删除二次确认 */}
          <ConfirmDialog
            open={confirmDelete}
            title="删除记忆"
            message={`确定要删除「${episode.title}」吗？此操作不可撤销。`}
            confirmText="删除"
            cancelText="取消"
            danger
            onConfirm={() => void handleDeleteConfirm()}
            onCancel={() => {
              if (!deleting) setConfirmDelete(false);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ===== 子组件 ===== */
function SectionTitle({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        letterSpacing: 0.3,
      }}
    >
      <span style={{ display: 'inline-flex', color: 'var(--color-primary)' }}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function TimelineItem({
  time,
  title,
  desc,
}: {
  time?: string;
  title: string;
  desc?: string;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', position: 'relative' }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 'var(--radius-round)',
          background: 'var(--color-primary)',
          marginTop: 5,
          flexShrink: 0,
          marginLeft: -5,
        }}
        aria-hidden
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-main)',
          }}
        >
          <span>{title}</span>
          {time && (
            <span style={{ fontSize: 11, color: 'var(--color-text-light)' }}>{time}</span>
          )}
        </div>
        {desc && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              marginTop: 2,
              wordBreak: 'break-word',
            }}
          >
            {desc}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== 工具函数与样式 ===== */
function wikiStatusText(status: string): string {
  switch (status) {
    case 'saved':
      return '已保存';
    case 'eligible':
      return '可保存';
    case 'none':
    default:
      return '不适用';
  }
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: 12,
  color: 'var(--color-text-muted)',
  background: 'var(--color-surface-subtle)',
  borderRadius: 'var(--radius-round)',
  padding: '2px 8px',
  whiteSpace: 'nowrap',
};

const emptyTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-light)',
};

function iconBtnStyle(primary: boolean): React.CSSProperties {
  return {
    width: 30,
    height: 30,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: primary ? 'var(--color-primary)' : 'var(--color-surface)',
    color: primary ? 'var(--color-on-primary)' : 'var(--color-text-muted)',
    cursor: 'pointer',
    transition:
      'background var(--duration-fast) var(--ease-out-expo), color var(--duration-fast) var(--ease-out-expo)',
  };
}

function footerBtnStyle(danger: boolean): React.CSSProperties {
  return {
    height: 34,
    padding: '0 var(--space-md)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: danger ? 'var(--color-danger)' : 'var(--color-surface)',
    color: danger ? 'var(--color-on-danger)' : 'var(--color-text-main)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition:
      'background var(--duration-fast) var(--ease-out-expo), color var(--duration-fast) var(--ease-out-expo)',
  };
}
