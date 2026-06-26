/**
 * 图谱视图 (GraphView) - 占位
 * P2 - 由 Task 19 实现双链知识图谱可视化。
 */
export default function GraphView(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 320,
        color: 'var(--color-text-light)',
        gap: 'var(--space-md)',
      }}
    >
      <div style={{ fontSize: 32 }}>🕸️</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-muted)' }}>
        知识图谱
      </div>
      <div style={{ fontSize: 12 }}>P2 占位 · 由 Task 19 实现（双链图谱可视化 / 力导向布局）</div>
    </div>
  );
}
