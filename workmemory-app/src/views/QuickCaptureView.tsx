/**
 * QuickCaptureView - 桌面悬浮快速捕获窗口 (audit-v4-hardening Task 12)
 *
 * 极简闪念输入界面（参考 macOS Spotlight Quick Note）：
 *   - 单个多行 textarea + 提交按钮 + 截图按钮 + 关闭按钮
 *   - textarea autofocus，placeholder "记录一个闪念…"
 *   - Ctrl/Cmd+Enter 提交 → invoke('save_quick_thought') → 清空 + hide + toast
 *     （后端无 save_quick_thought 时回退到 invoke('save_to_wiki')）
 *   - 截图按钮 → invoke('trigger_manual_capture') → OCR 文本追加到 textarea
 *   - Esc / 关闭按钮 → invoke('hide_quick_capture')
 *   - 窗口失焦（blur）自动隐藏
 *
 * 样式：圆角 12px，半透明背景 rgba(30, 30, 35, 0.95)，顶部 8px 拖拽区域。
 * 该路由独立于主布局（不包裹 Sidebar/TopBar），对应 tauri.conf.json quick-capture 窗口。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Camera, Check, X } from 'lucide-react';
import { api } from '@/src-tauri/api';
import { toast } from '@/store/toastStore';

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100vw',
  height: '100vh',
  background: 'rgba(30, 30, 35, 0.95)',
  borderRadius: 12,
  overflow: 'hidden',
  color: '#E6EAF0',
  fontFamily: 'var(--font-sans)',
  boxShadow: 'var(--shadow-overlay)',
};

const dragRegionStyle: CSSProperties = {
  height: 8,
  width: '100%',
  background: 'transparent',
  cursor: 'grab',
  flexShrink: 0,
};

const bodyStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  padding: '4px 14px 12px',
  minHeight: 0,
};

const textareaStyle: CSSProperties = {
  flex: 1,
  resize: 'none',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: '#E6EAF0',
  fontSize: 15,
  lineHeight: 1.5,
  fontFamily: 'inherit',
  padding: 0,
  minHeight: 0,
};

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingTop: 8,
};

const hintStyle: CSSProperties = {
  fontSize: 11,
  color: 'rgba(230, 234, 240, 0.5)',
  flex: 1,
};

const iconBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  height: 28,
  minWidth: 28,
  padding: '0 10px',
  background: 'transparent',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 6,
  color: '#E6EAF0',
  fontSize: 12,
  cursor: 'pointer',
};

const primaryBtnStyle: CSSProperties = {
  ...iconBtnStyle,
  background: 'var(--color-primary)',
  border: 'none',
  color: '#FFFFFF',
  fontWeight: 500,
};

export default function QuickCaptureView(): JSX.Element {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hide = useCallback(async () => {
    try {
      await api.invoke('hide_quick_capture');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[QuickCaptureView] hide_quick_capture failed', err);
    }
  }, []);

  // autofocus
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // 窗口失焦自动隐藏
  useEffect(() => {
    const onBlur = (): void => {
      void hide();
    };
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
    };
  }, [hide]);

  const submit = useCallback(async (): Promise<void> => {
    const text = content.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      try {
        await api.invoke('save_quick_thought', { content: text, screenshot: null });
      } catch (err1) {
        // 后端无 save_quick_thought 命令时回退到 save_to_wiki（创建一条 draft Wiki 页面）
        // eslint-disable-next-line no-console
        console.warn(
          '[QuickCaptureView] save_quick_thought unavailable, fallback to save_to_wiki',
          err1,
        );
        await api.invoke('save_to_wiki', {
          episodeId: '',
          title: text.slice(0, 32),
          content: text,
          tags: ['闪念'],
        });
      }
      toast.success('已记录');
      setContent('');
      await hide();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[QuickCaptureView] submit failed', err);
      toast.error('记录失败');
    } finally {
      setSubmitting(false);
    }
  }, [content, submitting, hide]);

  const captureScreen = useCallback(async (): Promise<void> => {
    if (capturing) return;
    setCapturing(true);
    try {
      const ocrText = await api.invoke<string>('trigger_manual_capture');
      if (ocrText) {
        setContent((c) => (c ? `${c}\n${ocrText}` : ocrText));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[QuickCaptureView] trigger_manual_capture failed', err);
      toast.error('截图失败');
    } finally {
      setCapturing(false);
      textareaRef.current?.focus();
    }
  }, [capturing]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // Ctrl/Cmd + Enter 提交
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
      return;
    }
    // Esc 关闭
    if (e.key === 'Escape') {
      e.preventDefault();
      void hide();
    }
  };

  return (
    <div style={containerStyle}>
      <div data-tauri-drag-region style={dragRegionStyle} />
      <div style={bodyStyle}>
        <textarea
          ref={textareaRef}
          style={textareaStyle}
          placeholder="记录一个闪念…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="闪念内容"
          autoFocus
          spellCheck={false}
        />
        <div style={footerStyle}>
          <span style={hintStyle}>Ctrl+Enter 提交 · Esc 关闭</span>
          <button
            type="button"
            style={iconBtnStyle}
            onClick={() => void captureScreen()}
            disabled={capturing}
            aria-label="截图追加"
            title="截图追加 OCR 文本"
          >
            <Camera size={14} />
            {capturing ? '截图中…' : '截图'}
          </button>
          <button
            type="button"
            style={primaryBtnStyle}
            onClick={() => void submit()}
            disabled={submitting || !content.trim()}
            aria-label="提交"
            title="提交 (Ctrl+Enter)"
          >
            <Check size={14} />
            提交
          </button>
          <button
            type="button"
            style={iconBtnStyle}
            onClick={() => void hide()}
            aria-label="关闭"
            title="关闭 (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
