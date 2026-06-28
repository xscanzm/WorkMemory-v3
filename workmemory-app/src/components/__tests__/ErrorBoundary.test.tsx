import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ErrorBoundary from '../ErrorBoundary';
import ViewErrorBoundary from '../ViewErrorBoundary';

// 全局 / 视图级错误边界测试 - audit-v4-hardening Task 10 (审计意见 2.5)
// React error boundary 捕获子树渲染异常，抑制 React 默认控制台错误噪音

// 始终抛错的子组件
function ThrowOnRender({ message }: { message: string }): JSX.Element {
  throw new Error(message);
}

// 可控抛错：shouldThrow=true 时抛错。不在组件内部复位（避免与 React 18
// 开发模式渲染重试机制冲突），由测试在看到 fallback 后手动复位以验证 retry。
let shouldThrow = false;
function RecoverableBomb(): JSX.Element {
  if (shouldThrow) {
    throw new Error('boom');
  }
  return <div>recovered</div>;
}

describe('ErrorBoundary 全局错误边界 (审计意见 2.5)', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanup();
    shouldThrow = false;
    // 抑制 React error boundary 的控制台错误噪音
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('正常子组件渲染通过', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('正常内容')).toBeInTheDocument();
  });

  it('子组件 throw 时显示默认 fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowOnRender message="render failed" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('出了点小问题')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('点击"重试"重新渲染子组件', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <RecoverableBomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('出了点小问题')).toBeInTheDocument();

    // 手动复位抛错条件，使 retry 后子组件正常渲染
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('自定义 fallback prop 被使用', () => {
    render(
      <ErrorBoundary
        fallback={(error, retry) => (
          <div>
            <span>自定义错误：{error.message}</span>
            <button onClick={retry}>自定义重试</button>
          </div>
        )}
      >
        <ThrowOnRender message="custom boom" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('自定义错误：custom boom')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '自定义重试' }),
    ).toBeInTheDocument();
  });
});

describe('ViewErrorBoundary 视图级错误边界', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanup();
    shouldThrow = false;
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('正常子组件渲染通过', () => {
    render(
      <ViewErrorBoundary>
        <div>视图正常</div>
      </ViewErrorBoundary>,
    );
    expect(screen.getByText('视图正常')).toBeInTheDocument();
  });

  it('子组件 throw 时显示视图级 fallback UI', () => {
    render(
      <ViewErrorBoundary>
        <ThrowOnRender message="view boom" />
      </ViewErrorBoundary>,
    );
    expect(screen.getByText('当前视图加载出错')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('点击"重试"重新渲染子组件', () => {
    shouldThrow = true;
    render(
      <ViewErrorBoundary>
        <RecoverableBomb />
      </ViewErrorBoundary>,
    );
    expect(screen.getByText('当前视图加载出错')).toBeInTheDocument();

    // 手动复位抛错条件，使 retry 后子组件正常渲染
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(screen.getByText('recovered')).toBeInTheDocument();
  });
});
