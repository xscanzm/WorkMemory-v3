import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SourceBadge from '../SourceBadge';

// SourceBadge 组件渲染测试 - WorkMemory-v3 Task 21
// 验证应用名 → emoji 映射与"已保护"占位逻辑（04_UI_SPEC.md §3.1）
describe('SourceBadge', () => {
  it('渲染浏览器应用名并映射为 🌐', () => {
    render(<SourceBadge appName="Microsoft Edge" />);
    expect(screen.getByText('Microsoft Edge')).toBeInTheDocument();
    expect(screen.getByText('🌐')).toBeInTheDocument();
  });

  it('渲染 VS Code 并映射为 💻', () => {
    render(<SourceBadge appName="VS Code" />);
    expect(screen.getByText('💻')).toBeInTheDocument();
  });

  it('渲染飞书并映射为 💬', () => {
    render(<SourceBadge appName="飞书" />);
    expect(screen.getByText('💬')).toBeInTheDocument();
  });

  it('未匹配应用名时使用默认图标 📄', () => {
    render(<SourceBadge appName="未知应用" />);
    expect(screen.getByText('📄')).toBeInTheDocument();
    expect(screen.getByText('未知应用')).toBeInTheDocument();
  });

  it('空 appName 显示已保护占位', () => {
    const { container } = render(<SourceBadge appName="" />);
    expect(screen.getByText('已保护')).toBeInTheDocument();
    expect(screen.getByText('🔒')).toBeInTheDocument();
    // title 属性也应为"已保护"
    const span = container.querySelector('span[title]');
    expect(span?.getAttribute('title')).toBe('已保护');
  });

  it('appName 为 🔒 时同样显示已保护占位', () => {
    render(<SourceBadge appName="🔒" />);
    expect(screen.getByText('已保护')).toBeInTheDocument();
  });

  it('显式传入 icon 时优先使用传入值', () => {
    render(<SourceBadge appName="自定义" icon="🚀" />);
    expect(screen.getByText('🚀')).toBeInTheDocument();
    expect(screen.getByText('自定义')).toBeInTheDocument();
  });
});
