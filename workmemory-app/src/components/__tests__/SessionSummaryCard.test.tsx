/**
 * SessionSummaryCard 测试 - audit-v4-hardening Task 18
 *
 * 覆盖：
 *   - open=false 时不渲染
 *   - sessionId=null 时不渲染
 *   - 渲染时显示核心指标（计划时长 / 实际专注 / 暂停次数 / 暂停总时长）
 *   - 应用时长分布显示
 *   - 注意力流失点显示
 *   - 关联任务显示（标题 + 完成状态徽章）
 *   - 点击「继续专注」触发 onOpenChange(false)
 *   - 点击「查看完整洞察」触发 navigate('/insights')
 *
 * Mock：
 *   - `@tauri-apps/api/core` 的 invoke（避免真实 IPC 调用）
 *   - `react-router-dom` 的 useNavigate（避免真实路由依赖）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// vi.mock 工厂会被提升到文件顶部，因此用 vi.hoisted 声明 mock 以确保可访问。
const { mockInvoke, mockNavigate } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import { MemoryRouter } from 'react-router-dom';
import SessionSummaryCard from '../SessionSummaryCard';

/** 与后端 models.rs::SessionSummary 对齐的 mock 数据 */
interface MockSessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  plannedDurationSeconds: number;
  actualFocusSeconds: number;
  pauseCount: number;
  pauseTotalSeconds: number;
  appDistribution: Array<{
    appName: string;
    durationSeconds: number;
    percentage: number;
  }>;
  attentionLossPoints: Array<{
    timestamp: string;
    reason: string;
    durationSeconds: number;
  }>;
  relatedTask: {
    taskId: string;
    taskTitle: string;
    completed: boolean;
  } | null;
  achievementsUnlocked: string[];
}

function makeSummary(
  overrides: Partial<MockSessionSummary> = {},
): MockSessionSummary {
  return {
    sessionId: 'sess-1',
    startedAt: '2026-06-28T10:00:00+08:00',
    endedAt: '2026-06-28T10:25:00+08:00',
    plannedDurationSeconds: 1500,
    actualFocusSeconds: 1500,
    pauseCount: 2,
    pauseTotalSeconds: 120,
    appDistribution: [
      { appName: 'VS Code', durationSeconds: 1200, percentage: 80.0 },
      { appName: 'Chrome', durationSeconds: 300, percentage: 20.0 },
    ],
    attentionLossPoints: [
      {
        timestamp: '2026-06-28T10:05:00+08:00',
        reason: '应用切换频繁',
        durationSeconds: 60,
      },
    ],
    relatedTask: {
      taskId: 'task-1',
      taskTitle: '编写单元测试',
      completed: false,
    },
    achievementsUnlocked: ['focus_10'],
    ...overrides,
  };
}

/** 包装组件在 MemoryRouter 中（useNavigate 已 mock，但 Router 上下文仍需提供） */
function renderCard(
  props: React.ComponentProps<typeof SessionSummaryCard>,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <SessionSummaryCard {...props} />
    </MemoryRouter>,
  );
}

describe('SessionSummaryCard 专注结束总结卡片', () => {
  beforeEach(() => {
    cleanup();
    mockInvoke.mockReset();
    mockNavigate.mockReset();
    // 默认 IPC 返回 mock summary
    mockInvoke.mockResolvedValue(makeSummary());
  });

  it('open=false 时不渲染', () => {
    renderCard({
      sessionId: 'sess-1',
      open: false,
      onOpenChange: vi.fn(),
    });
    expect(screen.queryByTestId('session-summary-title')).not.toBeInTheDocument();
  });

  it('渲染时显示核心指标', async () => {
    renderCard({
      sessionId: 'sess-1',
      open: true,
      onOpenChange: vi.fn(),
    });
    // 等待数据加载完成
    await waitFor(() => {
      expect(screen.getByTestId('session-summary-metrics')).toBeInTheDocument();
    });
    // 标题
    expect(screen.getByTestId('session-summary-title')).toHaveTextContent('专注结束');
    // 核心指标：计划时长 1500s = 00:25:00
    expect(screen.getByTestId('metric-planned')).toHaveTextContent('00:25:00');
    // 实际专注
    expect(screen.getByTestId('metric-actual')).toHaveTextContent('00:25:00');
    // 暂停次数
    expect(screen.getByTestId('metric-pauseCount')).toHaveTextContent('2');
    // 暂停总时长 120s = 00:02:00
    expect(screen.getByTestId('metric-pauseTotal')).toHaveTextContent('00:02:00');
  });

  it('应用时长分布显示', async () => {
    renderCard({
      sessionId: 'sess-1',
      open: true,
      onOpenChange: vi.fn(),
    });
    await waitFor(() => {
      expect(screen.getByTestId('app-slice-VS Code')).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-slice-VS Code')).toHaveTextContent('VS Code');
    expect(screen.getByTestId('app-slice-Chrome')).toHaveTextContent('Chrome');
    // 百分比显示
    expect(screen.getByTestId('app-slice-VS Code')).toHaveTextContent('80.0%');
  });

  it('注意力流失点显示', async () => {
    renderCard({
      sessionId: 'sess-1',
      open: true,
      onOpenChange: vi.fn(),
    });
    await waitFor(() => {
      expect(screen.getByTestId('attention-loss-0')).toBeInTheDocument();
    });
    expect(screen.getByTestId('attention-loss-0')).toHaveTextContent('应用切换频繁');
    // 持续时长 60s = 00:01:00
    expect(screen.getByTestId('attention-loss-0')).toHaveTextContent('00:01:00');
  });

  it('无注意力流失点时显示鼓励文案', async () => {
    mockInvoke.mockResolvedValue(
      makeSummary({ attentionLossPoints: [] }),
    );
    renderCard({
      sessionId: 'sess-1',
      open: true,
      onOpenChange: vi.fn(),
    });
    await waitFor(() => {
      expect(screen.getByText('本次专注非常专注！')).toBeInTheDocument();
    });
  });

  it('关联任务显示（标题 + 未完成状态）', async () => {
    renderCard({
      sessionId: 'sess-1',
      open: true,
      onOpenChange: vi.fn(),
    });
    await waitFor(() => {
      expect(screen.getByTestId('session-summary-task')).toBeInTheDocument();
    });
    expect(screen.getByTestId('session-summary-task')).toHaveTextContent('编写单元测试');
    expect(screen.getByTestId('session-summary-task')).toHaveTextContent('未完成');
  });

  it('关联任务完成时显示已完成徽章', async () => {
    mockInvoke.mockResolvedValue(
      makeSummary({
        relatedTask: { taskId: 'task-1', taskTitle: '已完成任务', completed: true },
      }),
    );
    renderCard({
      sessionId: 'sess-1',
      open: true,
      onOpenChange: vi.fn(),
    });
    await waitFor(() => {
      expect(screen.getByTestId('session-summary-task')).toBeInTheDocument();
    });
    expect(screen.getByTestId('session-summary-task')).toHaveTextContent('已完成');
  });

  it('无关联任务时不渲染任务区块', async () => {
    mockInvoke.mockResolvedValue(
      makeSummary({ relatedTask: null }),
    );
    renderCard({
      sessionId: 'sess-1',
      open: true,
      onOpenChange: vi.fn(),
    });
    await waitFor(() => {
      expect(screen.getByTestId('session-summary-metrics')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('session-summary-task')).not.toBeInTheDocument();
  });

  it('解锁成就显示', async () => {
    renderCard({
      sessionId: 'sess-1',
      open: true,
      onOpenChange: vi.fn(),
    });
    await waitFor(() => {
      expect(screen.getByTestId('session-summary-achievements')).toBeInTheDocument();
    });
    expect(screen.getByTestId('achievement-focus_10')).toHaveTextContent('focus_10');
  });

  it('点击「继续专注」触发 onOpenChange(false)', async () => {
    const onOpenChange = vi.fn();
    renderCard({
      sessionId: 'sess-1',
      open: true,
      onOpenChange,
    });
    await waitFor(() => {
      expect(screen.getByTestId('session-summary-metrics')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '继续专注' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('点击「查看完整洞察」触发 navigate("/insights")', async () => {
    const onOpenChange = vi.fn();
    renderCard({
      sessionId: 'sess-1',
      open: true,
      onOpenChange,
    });
    await waitFor(() => {
      expect(screen.getByTestId('session-summary-metrics')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '查看完整洞察' }));
    expect(mockNavigate).toHaveBeenCalledWith('/insights');
    // 同时关闭弹窗
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('调用 invoke 时传入正确的 sessionId 参数', async () => {
    renderCard({
      sessionId: 'sess-abc-123',
      open: true,
      onOpenChange: vi.fn(),
    });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_session_summary', {
        sessionId: 'sess-abc-123',
      });
    });
  });
});