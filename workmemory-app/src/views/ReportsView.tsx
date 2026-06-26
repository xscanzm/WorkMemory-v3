/**
 * 报告视图 (ReportsView) - 04_UI_SPEC.md §3.2 + 05_INTERACTION.md §4.2
 *
 * - 左 40%：Episode Checklist（Radix Checkbox，多选 / 全选 / 反选）
 * - 右 60%：Markdown 编辑器
 *   - 4 模板切换（Enhanced / Concise / OKR / Structured）
 *   - Regenerate / Copy Rich Text / Export Markdown
 *   - textarea + 实时 Markdown 预览（含 [[wikilink]] 蓝色加粗）
 *   - 生成中：loading spinner + 骨架
 *   - 无 Key 降级：点击生成零延迟渲染 Bullet 模板
 * - 富文本复制：ClipboardItem 同时写 text/html + text/plain（用例 5）
 */
import { useEffect, useMemo, useState } from 'react';
import * as Checkbox from '@radix-ui/react-checkbox';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { Check, Copy, Download, RefreshCw, FileText } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { api } from '@/src-tauri/api';
import type { AppSetting, CleanEpisode, WorkReport } from '@/types';

type AppSettingExt = AppSetting & { openai_api_key?: string };

type Template = WorkReport['template'];

const TEMPLATES: Array<{ value: Template; label: string; desc: string }> = [
  { value: 'enhanced', label: '高级叙述', desc: 'Enhanced' },
  { value: 'concise', label: '极简 Bullet', desc: 'Concise' },
  { value: 'okr', label: 'OKR', desc: 'OKR' },
  { value: 'structured', label: '标准分栏', desc: 'Structured' },
];

/* ===== 时间工具 ===== */
function parseTimeToSec(t: string): number {
  const [h = 0, m = 0, s = 0] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}
function fmtHM(t: string): string {
  const [h, m] = t.split(':');
  return `${h}:${m}`;
}
function durationMinutes(start: string, end: string): number {
  return Math.max(0, Math.round((parseTimeToSec(end) - parseTimeToSec(start)) / 60));
}

export default function ReportsView(): JSX.Element {
  const activeDate = useAppStore((s) => s.activeDate);
  const settings = useAppStore((s) => s.settings);

  const [episodes, setEpisodes] = useState<CleanEpisode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingList, setLoadingList] = useState(true);

  const [template, setTemplate] = useState<Template>('enhanced');
  const [markdown, setMarkdown] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');

  const hasApiKey = !!((settings as AppSettingExt | null)?.openai_api_key);

  // 初始加载 episodes 填充 checklist
  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    api
      .getEpisodesByDate(activeDate)
      .then((list) => {
        if (cancelled) return;
        const arr = list ?? [];
        setEpisodes(arr);
        // 默认全选
        setSelected(new Set(arr.map((e) => e.id)));
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[ReportsView] getEpisodesByDate 失败', err);
        if (!cancelled) setEpisodes([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDate]);

  const selectedEpisodes = useMemo(
    () => episodes.filter((e) => selected.has(e.id)),
    [episodes, selected],
  );

  const noneSelected = selected.size === 0;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(episodes.map((e) => e.id)));
  const invert = () =>
    setSelected(new Set(episodes.filter((e) => !selected.has(e.id)).map((e) => e.id)));

  // 生成报告
  const handleGenerate = async () => {
    if (selectedEpisodes.length === 0) return;
    setGenerating(true);
    setCopyState('idle');
    try {
      if (!hasApiKey) {
        // 无 Key 降级：零延迟渲染 Bullet 模板
        setMarkdown(buildFallbackReport(activeDate, selectedEpisodes));
        return;
      }
      const report = await api.generateReport(activeDate, template);
      setMarkdown(report?.content ?? '');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[ReportsView] generateReport 失败，降级为 Bullet', err);
      setMarkdown(buildFallbackReport(activeDate, selectedEpisodes));
    } finally {
      setGenerating(false);
    }
  };

  // 复制富文本
  const handleCopy = async () => {
    if (!markdown) return;
    const html = markdownToRichHtml(markdown);
    const plain = markdown;
    const ok = await copyRichText(html, plain);
    setCopyState(ok ? 'ok' : 'fail');
    setTimeout(() => setCopyState('idle'), 1800);
  };

  // 导出 Markdown
  const handleExport = () => {
    if (!markdown) return;
    exportMarkdown(`workmemory-report-${activeDate}.md`, markdown);
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        gap: 'var(--space-lg)',
        minHeight: 0,
      }}
    >
      {/* 左 40%：Checklist */}
      <aside
        style={{
          width: '40%',
          flex: '0 0 40%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 'var(--space-md) var(--space-lg)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-sm)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-main)' }}>
            选取 Episode
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={selectAll} style={miniBtn}>
              全选
            </button>
            <button type="button" onClick={invert} style={miniBtn}>
              反选
            </button>
          </div>
        </div>

        <ScrollArea.Root style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <ScrollArea.Viewport style={{ width: '100%', height: '100%' }}>
            <div style={{ padding: 'var(--space-sm) var(--space-sm) var(--space-lg)' }}>
              {loadingList ? (
                <div style={{ padding: 'var(--space-md)' }}>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="skeleton"
                      style={{ height: 44, borderRadius: 6, marginBottom: 8 }}
                    />
                  ))}
                </div>
              ) : episodes.length === 0 ? (
                <div
                  style={{
                    padding: 'var(--space-xl)',
                    fontSize: 13,
                    color: 'var(--color-text-light)',
                    textAlign: 'center',
                  }}
                >
                  今日暂无 Episode，无法生成报告。
                </div>
              ) : (
                episodes.map((ep) => {
                  const checked = selected.has(ep.id);
                  return (
                    <label
                      key={ep.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--space-sm)',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        background: checked ? 'var(--color-primary-soft)' : 'transparent',
                        transition: 'background var(--duration-fast) var(--ease-out-expo)',
                      }}
                      onMouseEnter={(e) => {
                        if (!checked)
                          e.currentTarget.style.background =
                            'var(--color-surface-subtle)';
                      }}
                      onMouseLeave={(e) => {
                        if (!checked) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <Checkbox.Root
                        checked={checked}
                        onCheckedChange={() => toggle(ep.id)}
                        style={{
                          width: 16,
                          height: 16,
                          marginTop: 2,
                          flexShrink: 0,
                          borderRadius: 4,
                          border: checked
                            ? '1px solid var(--color-primary)'
                            : '1px solid var(--color-border-hover)',
                          background: checked
                            ? 'var(--color-primary)'
                            : 'var(--color-surface)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <Checkbox.Indicator>
                          <Check size={12} color="#FFFFFF" strokeWidth={3} />
                        </Checkbox.Indicator>
                      </Checkbox.Root>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: 'var(--color-text-main)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {fmtHM(ep.startTime)} {ep.title}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--color-text-light)',
                            marginTop: 2,
                          }}
                        >
                          {durationMinutes(ep.startTime, ep.endTime)}min ·{' '}
                          {ep.project || '未分类'}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar
            orientation="vertical"
            style={{ width: 6, padding: 2, background: 'transparent' }}
          >
            <ScrollArea.Thumb
              style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 3 }}
            />
          </ScrollArea.Scrollbar>
          <ScrollArea.Corner />
        </ScrollArea.Root>

        <div
          style={{
            padding: 'var(--space-sm) var(--space-lg)',
            borderTop: '1px solid var(--color-border)',
            fontSize: 12,
            color: 'var(--color-text-muted)',
          }}
        >
          已选 {selected.size} / {episodes.length} 条
          {noneSelected && (
            <span style={{ color: 'var(--color-warning)', marginLeft: 8 }}>
              · 请至少选择一条
            </span>
          )}
        </div>
      </aside>

      {/* 右 60%：编辑器 */}
      <section
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* 顶部操作条 */}
        <div
          style={{
            padding: 'var(--space-sm) var(--space-lg)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
            }}
          >
            {TEMPLATES.map((t) => {
              const active = template === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTemplate(t.value)}
                  title={t.desc}
                  style={{
                    padding: '5px 10px',
                    fontSize: 12,
                    border: 'none',
                    borderRight: '1px solid var(--color-border)',
                    background: active
                      ? 'var(--color-primary-soft)'
                      : 'var(--color-surface)',
                    color: active
                      ? 'var(--color-primary)'
                      : 'var(--color-text-muted)',
                    cursor: 'pointer',
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || selectedEpisodes.length === 0}
            style={primaryBtn(generating || selectedEpisodes.length === 0)}
            title="重新生成"
          >
            <RefreshCw size={14} style={{ marginRight: 6 }} />
            {generating ? '生成中…' : '生成 / Regenerate'}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!markdown}
            style={ghostBtn(!markdown)}
            title="复制富文本（保留标题级差、加粗、Bullet、行内代码）"
          >
            {copyState === 'ok' ? <Check size={14} /> : <Copy size={14} />}
            <span style={{ marginLeft: 6 }}>
              {copyState === 'ok' ? '已复制' : copyState === 'fail' ? '复制失败' : '复制富文本'}
            </span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!markdown}
            style={ghostBtn(!markdown)}
            title="导出 .md 文件"
          >
            <Download size={14} />
            <span style={{ marginLeft: 6 }}>导出 Markdown</span>
          </button>
        </div>

        {/* 编辑器主体 */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {generating ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-md)',
                color: 'var(--color-text-muted)',
                padding: 'var(--space-xl)',
              }}
            >
              <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} />
              <div style={{ fontSize: 13 }}>正在生成报告…</div>
              <div style={{ width: '80%', maxWidth: 460 }}>
                <div
                  className="skeleton"
                  style={{ height: 14, borderRadius: 4, marginBottom: 8 }}
                />
                <div
                  className="skeleton"
                  style={{ height: 14, width: '85%', borderRadius: 4, marginBottom: 8 }}
                />
                <div
                  className="skeleton"
                  style={{ height: 14, width: '70%', borderRadius: 4 }}
                />
              </div>
            </div>
          ) : (
            <>
              {/* textarea */}
              <div
                style={{
                  width: '50%',
                  flex: '0 0 50%',
                  borderRight: '1px solid var(--color-border)',
                  minHeight: 0,
                  display: 'flex',
                }}
              >
                <textarea
                  value={markdown}
                  onChange={(e) => setMarkdown(e.target.value)}
                  placeholder={
                    selectedEpisodes.length === 0
                      ? '请先在左侧选择 Episode，再点击"生成"。'
                      : '点击"生成 / Regenerate"生成报告，或直接在此编辑 Markdown…'
                  }
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    padding: 'var(--space-lg)',
                    fontSize: 13,
                    lineHeight: 1.7,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                    color: 'var(--color-text-main)',
                    background: 'var(--color-surface)',
                  }}
                />
              </div>
              {/* 预览 */}
              <div
                style={{
                  width: '50%',
                  flex: '0 0 50%',
                  minHeight: 0,
                  overflow: 'auto',
                  padding: 'var(--space-lg)',
                  background: 'var(--color-surface-subtle)',
                }}
              >
                {markdown ? (
                  <Preview md={markdown} />
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      color: 'var(--color-text-light)',
                      gap: 'var(--space-sm)',
                      fontSize: 13,
                    }}
                  >
                    <FileText size={28} />
                    <span>预览区：生成或输入 Markdown 后实时渲染</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ===== 预览（使用富文本 HTML，保证与复制一致） ===== */
function Preview({ md }: { md: string }): JSX.Element {
  const html = useMemo(() => markdownToRichHtml(md), [md]);
  return (
    <div
      className="fade-in"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ color: 'var(--color-text-main)' }}
    />
  );
}

/* ===== Markdown → 富文本 HTML（内联样式，复制友好） ===== */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineFormat(text: string): string {
  let t = escapeHtml(text);
  // [[wikilink]] → 蓝色加粗
  t = t.replace(
    /\[\[([^\]]+)\]\]/g,
    '<strong style="color:#2563EB">$1</strong>',
  );
  // `code` → 行内代码
  t = t.replace(
    /`([^`]+)`/g,
    '<code style="background:#f0f0f0;padding:2px 4px;border-radius:3px;font-family:ui-monospace,monospace;font-size:13px">$1</code>',
  );
  // **bold** → 加粗
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return t;
}

function markdownToRichHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  let inQuote = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const closeQuote = () => {
    if (inQuote) {
      out.push('</blockquote>');
      inQuote = false;
    }
  };

  for (const raw of lines) {
    if (/^###\s+/.test(raw)) {
      closeList();
      closeQuote();
      out.push(
        `<h3 style="font-size:16px;font-weight:bold;margin:10px 0 4px">${inlineFormat(
          raw.replace(/^###\s+/, ''),
        )}</h3>`,
      );
      continue;
    }
    if (/^##\s+/.test(raw)) {
      closeList();
      closeQuote();
      out.push(
        `<h2 style="font-size:18px;font-weight:bold;margin:12px 0 6px">${inlineFormat(
          raw.replace(/^##\s+/, ''),
        )}</h2>`,
      );
      continue;
    }
    if (/^#\s+/.test(raw)) {
      closeList();
      closeQuote();
      out.push(
        `<h1 style="font-size:20px;font-weight:bold;margin:14px 0 8px">${inlineFormat(
          raw.replace(/^#\s+/, ''),
        )}</h1>`,
      );
      continue;
    }
    if (/^[-*]\s+/.test(raw)) {
      closeQuote();
      if (!inList) {
        out.push('<ul style="padding-left:20px;margin:4px 0">');
        inList = true;
      }
      out.push(
        `<li style="margin:2px 0">${inlineFormat(raw.replace(/^[-*]\s+/, ''))}</li>`,
      );
      continue;
    }
    if (/^>\s?/.test(raw)) {
      closeList();
      if (!inQuote) {
        out.push(
          '<blockquote style="border-left:3px solid #ccc;padding-left:10px;color:#666;margin:6px 0">',
        );
        inQuote = true;
      }
      out.push(`<div>${inlineFormat(raw.replace(/^>\s?/, ''))}</div>`);
      continue;
    }
    if (raw.trim() === '') {
      closeList();
      closeQuote();
      continue;
    }
    closeList();
    closeQuote();
    out.push(
      `<p style="margin:4px 0;line-height:1.6">${inlineFormat(raw)}</p>`,
    );
  }
  closeList();
  closeQuote();
  return out.join('');
}

/* ===== 富文本复制：ClipboardItem 同时写 text/html + text/plain（用例 5） ===== */
async function copyRichText(html: string, plain: string): Promise<boolean> {
  try {
    const ClipboardItemCtor =
      (typeof window !== 'undefined'
        ? (window as unknown as { ClipboardItem?: typeof ClipboardItem })
            .ClipboardItem
        : undefined) ?? (typeof ClipboardItem !== 'undefined' ? ClipboardItem : undefined);

    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      ClipboardItemCtor
    ) {
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([plain], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItemCtor({
          'text/html': htmlBlob,
          'text/plain': textBlob,
        }),
      ]);
      return true;
    }
    // 降级：仅纯文本
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(plain);
      return true;
    }
    return false;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[copyRichText] 失败', err);
    return false;
  }
}

/* ===== 导出 Markdown 文件 ===== */
function exportMarkdown(filename: string, content: string): void {
  try {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[exportMarkdown] 失败', err);
  }
}

/* ===== 无 Key 降级 Bullet 模板（05_INTERACTION.md §4.2） ===== */
function buildFallbackReport(date: string, episodes: CleanEpisode[]): string {
  const lines: string[] = [];
  lines.push(`# 今日工作日报 - ${date}`);
  lines.push('');
  if (episodes.length === 0) {
    lines.push('> 今日暂无活动记录。');
    return lines.join('\n');
  }
  let totalMin = 0;
  lines.push('## 今日交付');
  for (const ep of episodes) {
    const dur = durationMinutes(ep.startTime, ep.endTime);
    totalMin += dur;
    lines.push(`- ${fmtHM(ep.startTime)}-${fmtHM(ep.endTime)} ${ep.title}（${dur}min）`);
    if (ep.summary) lines.push(`  ${ep.summary}`);
  }
  lines.push('');
  lines.push(
    `> 今日电脑运行了 ${Math.floor(totalMin / 60)} 小时 ${totalMin % 60} 分。`,
  );

  const todos = episodes.flatMap((e) => e.todos ?? []);
  if (todos.length) {
    lines.push('');
    lines.push('## 明日计划');
    for (const t of todos) lines.push(`- ${t}`);
  }
  const blockers = episodes.flatMap((e) => e.blockers ?? []);
  if (blockers.length) {
    lines.push('');
    lines.push('## 阻塞项');
    for (const b of blockers) lines.push(`- ${b}`);
  }
  return lines.join('\n');
}

/* ===== 按钮样式 ===== */
const miniBtn: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    border: 'none',
    borderRadius: 'var(--radius-md)',
    background: disabled ? 'var(--color-border)' : 'var(--color-primary)',
    color: '#FFFFFF',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}

function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 500,
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface)',
    color: disabled ? 'var(--color-text-light)' : 'var(--color-text-muted)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}
