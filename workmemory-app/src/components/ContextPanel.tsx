/**
 * 右侧 348px 上下文面板 (04_UI_SPEC.md §2)
 *
 * 默认展示"来源反查"占位，含四个分区占位：
 *   📦 来源反查 / 📑 OCR 原始块 / 📁 关联文件 / 🛠️ 快捷归档
 * 实际内容由 Task 11/14 实现。
 */
const PANEL_WIDTH = 348;

const panelStyle: React.CSSProperties = {
  width: PANEL_WIDTH,
  flex: `0 0 ${PANEL_WIDTH}px`,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-surface)',
  borderLeft: '1px solid var(--color-border)',
  overflow: 'auto',
};

const sectionStyle: React.CSSProperties = {
  padding: 'var(--space-lg)',
  borderBottom: '1px solid var(--color-border)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  letterSpacing: 0.4,
  marginBottom: 'var(--space-sm)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const placeholderStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-light)',
  lineHeight: 1.6,
};

interface Section {
  emoji: string;
  title: string;
  hint: string;
}

const SECTIONS: Section[] = [
  {
    emoji: '📦',
    title: '来源反查',
    hint: '选中任一时间线片段，这里将展示其归属的原始 segments 与证据链。',
  },
  {
    emoji: '📑',
    title: 'OCR 原始块',
    hint: '展示该片段对应截图的 OCR 全文与置信度，支持高亮关键词。',
  },
  {
    emoji: '📁',
    title: '关联文件',
    hint: '展示该片段涉及的文档、代码、链接，可一键打开或归档。',
  },
  {
    emoji: '🛠️',
    title: '快捷归档',
    hint: '将当前片段沉淀为 Wiki 页面或加入日报草稿。',
  },
];

function ContextPanel(): JSX.Element {
  return (
    <aside style={panelStyle} aria-label="上下文面板">
      <div
        style={{
          padding: 'var(--space-lg)',
          borderBottom: '1px solid var(--color-border)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--color-text-main)',
        }}
      >
        上下文
      </div>

      {SECTIONS.map((s) => (
        <section key={s.title} style={sectionStyle}>
          <div style={titleStyle}>
            <span>{s.emoji}</span>
            <span>{s.title}</span>
          </div>
          <div style={placeholderStyle}>{s.hint}</div>
        </section>
      ))}

      <div
        style={{
          padding: 'var(--space-lg)',
          fontSize: 11,
          color: 'var(--color-text-light)',
          textAlign: 'center',
        }}
      >
        实际内容由 Task 11/14 实现
      </div>
    </aside>
  );
}

export default ContextPanel;
