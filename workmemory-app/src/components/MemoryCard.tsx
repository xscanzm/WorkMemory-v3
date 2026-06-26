/**
 * 记忆卡片 (04_UI_SPEC.md §3.1)
 *
 * 一条 Episode 在时间线上的卡片呈现，支持 6 种状态：
 *   Normal / Hover / Active / Loading(骨架) / Deleted(撤销浮条) / Private(紫色斜条)
 *
 * 卡片左侧贴 TimelineRail（由父级 TimelineRail 提供 24px 缩进），
 * 通过 showRailDot 在左上角渲染落在轨道虚线上的圆点。
 */
import { useEffect, useRef, useState } from 'react';
import { Star, BookMarked, Check } from 'lucide-react';
import type { CleanEpisode } from '@/types';
import SourceBadge from './SourceBadge';

export interface MemoryCardProps {
  episode: CleanEpisode;
  onToggleImportant?: (id: string) => void;
  onSaveToWiki?: (id: string) => void;
  onEditTitle?: (id: string, title: string, summary: string) => void;
  /** 删除后撤销回调（Deleted 状态下点击"撤销"或在 8s 内恢复） */
  onUndo?: (id: string) => void;
  /** 应用来源名（用于 SourceBadge 与隐私标题），默认取 episode.project */
  appName?: string;
  /** 是否重要（控制五角星填充），默认 false；点击星标会触发 onToggleImportant */
  isImportant?: boolean;
  /** 隐私窗口，渲染紫色斜条 + 标题替换 */
  isPrivate?: boolean;
  /** 已删除态：opacity 0.4 + 顶部撤销浮条 */
  isDeleted?: boolean;
  /** 加载态：渲染骨架 */
  isLoading?: boolean;
  /** 当前激活（圆点用 --color-primary） */
  isActive?: boolean;
  /** 是否渲染落在轨道上的圆点，默认 true */
  showRailDot?: boolean;
}

/* ===== 时间计算工具 ===== */
function parseTimeToSec(t: string): number {
  const parts = t.split(':').map(Number);
  const [h = 0, m = 0, s = 0] = parts;
  return h * 3600 + m * 60 + s;
}
function fmtHM(t: string): string {
  const [h, m] = t.split(':');
  return `${h}:${m}`;
}
function durationMinutes(start: string, end: string): number {
  const diff = parseTimeToSec(end) - parseTimeToSec(start);
  return Math.max(0, Math.round(diff / 60));
}

const transition = 'transform 200ms cubic-bezier(0.16,1,0.3,1), box-shadow 200ms cubic-bezier(0.16,1,0.3,1)';

function MemoryCard(props: MemoryCardProps): JSX.Element {
  const {
    episode,
    onToggleImportant,
    onSaveToWiki,
    onEditTitle,
    onUndo,
    appName,
    isImportant = false,
    isPrivate = false,
    isDeleted = false,
    isLoading = false,
    isActive = false,
    showRailDot = true,
  } = props;

  const [hovered, setHovered] = useState(false);
  const [important, setImportant] = useState(isImportant);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(episode.title);
  const [showUndo, setShowUndo] = useState(true);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Deleted 态：进入后 8 秒自动消失浮条
  useEffect(() => {
    if (!isDeleted) {
      setShowUndo(true);
      return;
    }
    setShowUndo(true);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      setShowUndo(false);
    }, 8000);
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, [isDeleted]);

  // 同步外部 isImportant 变化
  useEffect(() => {
    setImportant(isImportant);
  }, [isImportant]);

  if (isLoading) {
    return <SkeletonCard showRailDot={showRailDot} />;
  }

  const app = appName ?? episode.project ?? '未知应用';
  const durMin = durationMinutes(episode.startTime, episode.endTime);
  const evidenceCount = episode.segmentIds?.length ?? 0;
  const wikiSaved = episode.wikiStatus === 'saved';

  const handleStar = () => {
    const next = !important;
    setImportant(next);
    onToggleImportant?.(episode.id);
  };

  const startEdit = () => {
    if (isPrivate) return;
    setDraftTitle(episode.title);
    setEditing(true);
  };

  const commitEdit = () => {
    const next = draftTitle.trim() || episode.title;
    onEditTitle?.(episode.id, next, episode.summary);
    setEditing(false);
  };

  const cancelEdit = () => {
    setDraftTitle(episode.title);
    setEditing(false);
  };

  const cardStyle: React.CSSProperties = {
    position: 'relative',
    background: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    boxShadow: hovered && !editing ? 'var(--shadow-overlay)' : 'var(--shadow-card)',
    transform: hovered && !editing ? 'translateY(-2px)' : 'translateY(0)',
    transition,
    padding: 'var(--space-lg)',
    opacity: isDeleted ? 0.4 : 1,
    overflow: 'visible',
  };

  const dotStyle: React.CSSProperties = {
    position: 'absolute',
    left: -24,
    top: 18,
    width: 12,
    height: 12,
    borderRadius: 'var(--radius-round)',
    background: isActive ? 'var(--color-primary)' : 'var(--color-surface)',
    border: isActive
      ? '2px solid var(--color-primary)'
      : '2px solid var(--color-border-hover)',
    boxShadow: '0 0 0 2px var(--color-surface)',
    zIndex: 1,
  };

  return (
    <div
      role="listitem"
      className={isPrivate ? 'privacy-stripes' : undefined}
      style={cardStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {showRailDot && <span style={dotStyle} aria-hidden />}

      {/* Deleted 撤销浮条 */}
      {isDeleted && showUndo && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            background: 'var(--color-danger)',
            color: 'var(--color-on-primary)',
            fontSize: 12,
            padding: '4px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
            zIndex: 2,
          }}
        >
          <span>已删除</span>
          <button
            type="button"
            onClick={() => {
              onUndo?.(episode.id);
              setShowUndo(false);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-on-primary)',
              cursor: 'pointer',
              textDecoration: 'underline',
              fontSize: 12,
              padding: 0,
              fontWeight: 600,
            }}
          >
            撤销 Undo
          </button>
        </div>
      )}

      {/* 顶部：时间戳 + 操作区 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-sm)',
          marginBottom: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            fontSize: 13,
            color: 'var(--color-text-muted)',
          }}
        >
          <span>
            {fmtHM(episode.startTime)} - {fmtHM(episode.endTime)}
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--color-text-light)',
              background: 'var(--color-surface-subtle)',
              padding: '1px 6px',
              borderRadius: 'var(--radius-round)',
            }}
          >
            {durMin}min
          </span>
        </div>

        {!isPrivate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              onClick={handleStar}
              title={important ? '取消重要' : '标记重要'}
              aria-label={important ? '取消重要' : '标记重要'}
              style={iconBtnStyle}
            >
              <Star
                size={16}
                fill={important ? 'var(--color-warning)' : 'none'}
                color={important ? 'var(--color-warning)' : 'var(--color-text-light)'}
              />
            </button>
            <button
              type="button"
              onClick={() => onSaveToWiki?.(episode.id)}
              title={wikiSaved ? '已保存到 Wiki' : '保存到 Wiki'}
              aria-label="保存到 Wiki"
              disabled={!episode.wikiEligible && !wikiSaved}
              style={{
                ...iconBtnStyle,
                opacity: wikiSaved ? 1 : episode.wikiEligible ? 1 : 0.4,
                cursor: wikiSaved || episode.wikiEligible ? 'pointer' : 'not-allowed',
                color: wikiSaved ? 'var(--color-primary)' : 'var(--color-text-light)',
              }}
            >
              {wikiSaved ? <Check size={16} /> : <BookMarked size={16} />}
            </button>
          </div>
        )}
      </div>

      {/* 标题 / 隐私标题 */}
      {isPrivate ? (
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--color-private)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>🔒 已保护隐私窗口 ({app})</span>
        </div>
      ) : editing ? (
        <input
          autoFocus
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitEdit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          }}
          onBlur={commitEdit}
          style={{
            width: '100%',
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--color-text-main)',
            border: '1px solid var(--color-primary)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 6px',
            outline: 'none',
            background: 'var(--color-surface)',
            marginBottom: 4,
          }}
        />
      ) : (
        <div
          onDoubleClick={startEdit}
          title="双击编辑标题"
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--color-text-main)',
            cursor: 'text',
            lineHeight: 1.4,
            marginBottom: 4,
            wordBreak: 'break-word',
          }}
        >
          {episode.title}
        </div>
      )}

      {/* 摘要（隐私态隐藏） */}
      {!isPrivate && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--color-text-muted)',
            lineHeight: 1.6,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            wordBreak: 'break-word',
          }}
        >
          {episode.summary || '（暂无摘要）'}
        </div>
      )}

      {/* 底栏 Chip（隐私态隐藏） */}
      {!isPrivate && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-xs)',
            marginTop: 'var(--space-md)',
          }}
        >
          <SourceBadge appName={app} />
          {episode.project && (
            <Chip>🏷️ {episode.project}</Chip>
          )}
          <Chip>🔗 {evidenceCount} 证据</Chip>
        </div>
      )}
    </div>
  );
}

/** 底栏小标签 */
function Chip({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 12,
        color: 'var(--color-text-muted)',
        background: 'var(--color-surface-subtle)',
        borderRadius: 'var(--radius-round)',
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-light)',
  transition: 'background var(--duration-fast) var(--ease-out-expo)',
};

/** 骨架卡片（Loading 态） */
function SkeletonCard({ showRailDot }: { showRailDot: boolean }): JSX.Element {
  const dotStyle: React.CSSProperties = {
    position: 'absolute',
    left: -24,
    top: 18,
    width: 12,
    height: 12,
    borderRadius: 'var(--radius-round)',
    background: 'var(--color-border)',
    border: '2px solid var(--color-surface)',
    zIndex: 1,
  };
  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-card)',
        padding: 'var(--space-lg)',
      }}
    >
      {showRailDot && <span style={dotStyle} aria-hidden />}
      <div
        className="skeleton"
        style={{ height: 14, width: 120, borderRadius: 'var(--radius-sm)', marginBottom: 12 }}
      />
      <div
        className="skeleton"
        style={{ height: 18, width: '60%', borderRadius: 'var(--radius-sm)', marginBottom: 10 }}
      />
      <div
        className="skeleton"
        style={{ height: 12, width: '90%', borderRadius: 'var(--radius-sm)', marginBottom: 6 }}
      />
      <div
        className="skeleton"
        style={{ height: 12, width: '75%', borderRadius: 'var(--radius-sm)', marginBottom: 14 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="skeleton" style={{ height: 18, width: 80, borderRadius: 'var(--radius-round)' }} />
        <div className="skeleton" style={{ height: 18, width: 70, borderRadius: 'var(--radius-round)' }} />
        <div className="skeleton" style={{ height: 18, width: 60, borderRadius: 'var(--radius-round)' }} />
      </div>
    </div>
  );
}

export default MemoryCard;
