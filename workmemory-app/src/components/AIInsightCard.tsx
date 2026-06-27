/**
 * AI 见解卡片 (AIInsightCard) - Task 16.3
 *
 * - 占位实现：AIEngine 尚未接入，根据现有数据生成模板化见解
 * - 优先级：streak>=7 > productivityScore>=80 > tasksCompleted===0 > 默认
 * - 视觉：毛玻璃表面 + 渐变描边（accent → primary）+ 左侧灯泡图标
 * - 接收外部传入的 stats / streak / productivityScore，自身不拉取数据
 */
import type { CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';

/** 与后端 DailyStats (camelCase) 对齐；totalFocusTime 后端以秒存储 */
interface DailyStats {
  date: string;
  tasksCompleted: number;
  totalFocusTime: number;
  streakCount: number;
  createdAt: string;
  updatedAt: string;
}

interface AIInsightCardProps {
  stats: DailyStats | null;
  streak: number;
  productivityScore: number;
}

const cardStyle: CSSProperties = {
  position: 'relative',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-lg) var(--space-xl)',
  background: 'var(--color-surface-glass)',
  backdropFilter: 'var(--blur-acrylic)',
  WebkitBackdropFilter: 'var(--blur-acrylic)',
  boxShadow: 'var(--shadow-card)',
  overflow: 'hidden',
};

/** 渐变描边：用 padding + 内层背景模拟 1px 渐变边框 */
const gradientBorderStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  padding: 1,
  borderRadius: 'var(--radius-lg)',
  background:
    'linear-gradient(135deg, var(--color-accent) 0%, var(--color-primary) 100%)',
  WebkitMask:
    'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
  WebkitMaskComposite: 'xor',
  maskComposite: 'exclude',
  pointerEvents: 'none',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-sm)',
  marginBottom: 'var(--space-xs)',
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-accent)',
  letterSpacing: 0.3,
};

const messageStyle: CSSProperties = {
  fontSize: 14,
  color: 'var(--color-text-main)',
  lineHeight: 1.6,
};

/**
 * 根据数据生成模板化见解文案
 * 优先级：连续打卡 >= 7 → 生产力 >= 80 → 今日零任务 → 默认汇总
 */
function buildInsight(
  stats: DailyStats | null,
  streak: number,
  productivityScore: number,
): string {
  if (streak >= 7) {
    return `🔥 你已连续打卡 ${streak} 天，保持节奏！`;
  }
  if (productivityScore >= 80) {
    return `⚡ 今日生产力 ${productivityScore} 分，表现优异！`;
  }
  const tasks = stats?.tasksCompleted ?? 0;
  if (tasks === 0) {
    return '🌱 今天还没有完成任务，从一个小任务开始吧。';
  }
  // 后端 totalFocusTime 以秒存储，转换为分钟展示
  const minutes = Math.round((stats?.totalFocusTime ?? 0) / 60);
  return `📊 今日完成 ${tasks} 个任务，专注 ${minutes} 分钟。`;
}

export default function AIInsightCard({
  stats,
  streak,
  productivityScore,
}: AIInsightCardProps): JSX.Element {
  const message = buildInsight(stats, streak, productivityScore);
  return (
    <article
      style={cardStyle}
      aria-label="AI 见解"
      aria-live="polite"
    >
      <span style={gradientBorderStyle} aria-hidden />
      <div style={headerStyle}>
        <Sparkles size={16} strokeWidth={2} color="var(--color-accent)" />
        <span style={titleStyle}>AI 见解</span>
      </div>
      <div style={messageStyle}>{message}</div>
    </article>
  );
}
