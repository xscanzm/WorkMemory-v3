/**
 * 全局错误边界 (React Class Component)
 *
 * - 捕获子树渲染异常，展示“出了点小问题”友好兜底页
 * - 提供“重试”按钮重置内部状态，并可展开技术详情（错误堆栈）
 * - 在 App.tsx 中包裹 MainLayout，保证主窗口渲染异常不会白屏
 * - 可选 `fallback` 渲染 prop：传入时用其替代默认兜底 UI（ViewErrorBoundary 用于视图级更轻量的兜底）
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 自定义兜底 UI（接收到错误对象与重试回调）。不传则使用默认全屏兜底页。 */
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] 捕获渲染异常', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const err = this.state.error ?? new Error('Unknown error');
      if (this.props.fallback) {
        return this.props.fallback(err, this.handleRetry);
      }
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: 'var(--space-lg)',
            padding: 'var(--space-2xl)',
            background: 'var(--color-bg-base)',
            color: 'var(--color-text-main)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <div style={{ fontSize: '64px', lineHeight: 1 }} aria-hidden>
            😴
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>
            出了点小问题
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', textAlign: 'center', maxWidth: '400px' }}>
            应用遇到了一个渲染异常。你可以尝试重试，或重启应用。
          </p>
          {this.state.error && (
            <details style={{ maxWidth: '600px', fontSize: '12px', color: 'var(--color-text-light)' }}>
              <summary style={{ cursor: 'pointer' }}>技术详情</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: 'var(--space-sm)' }}>
                {this.state.error.stack || this.state.error.message}
              </pre>
            </details>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: 'var(--space-sm) var(--space-xl)',
              background: 'var(--color-primary)',
              color: 'var(--color-on-primary)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

