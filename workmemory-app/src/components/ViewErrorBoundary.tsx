/**
 * 视图级错误边界 (ViewErrorBoundary)
 *
 * 复用 ErrorBoundary 类，提供更轻量、适配单个视图区域的兜底 UI：
 * - 不占满整个视口高度，仅在视图容器内居中
 * - 提供“重试”按钮重置视图内部状态
 *
 * 用法：在 App.tsx 路由中包裹每个视图，使单视图渲染异常不影响整窗布局。
 *   <Route path="/home" element={<ViewErrorBoundary><HomeView /></ViewErrorBoundary>} />
 */
import type { ReactNode } from 'react';
import ErrorBoundary from './ErrorBoundary';

interface Props {
  children: ReactNode;
}

/** 视图级兜底 UI：轻量居中、不占满 100vh */
function ViewFallback({ error, retry }: { error: Error; retry: () => void }): JSX.Element {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 240,
        gap: 'var(--space-md)',
        padding: 'var(--space-2xl)',
        color: 'var(--color-text-main)',
        fontFamily: 'var(--font-sans)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '40px', lineHeight: 1 }} aria-hidden>
        😴
      </div>
      <div style={{ fontSize: '15px', fontWeight: 600 }}>
        当前视图加载出错
      </div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: '13px', maxWidth: '420px' }}>
        该视图遇到了一个渲染异常，其它功能不受影响。你可以尝试重试。
      </div>
      <details style={{ maxWidth: '600px', fontSize: '12px', color: 'var(--color-text-light)' }}>
        <summary style={{ cursor: 'pointer' }}>技术详情</summary>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: 'var(--space-sm)' }}>
          {error.stack || error.message}
        </pre>
      </details>
      <button
        type="button"
        onClick={retry}
        style={{
          padding: 'var(--space-sm) var(--space-xl)',
          background: 'var(--color-primary)',
          color: 'var(--color-on-primary)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 500,
        }}
      >
        重试
      </button>
    </div>
  );
}

export default function ViewErrorBoundary({ children }: Props): JSX.Element {
  return (
    <ErrorBoundary fallback={(error, retry) => <ViewFallback error={error} retry={retry} />}>
      {children}
    </ErrorBoundary>
  );
}
