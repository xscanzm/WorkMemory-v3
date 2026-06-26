/**
 * 自定义无边框窗口标题栏 (06_DESIGN_GOVERNANCE.md §2.1)
 *
 * - 顶层 .titlebar-drag-region（-webkit-app-region: drag），高度 36px
 * - 左侧：WorkMemory logo 文字（.no-drag 排除拖拽）
 * - 右侧：Windows 11 风格三按钮（最小化/最大化/关闭），lucide-react 图标
 * - 非 Tauri 环境（Web）隐藏窗口控制按钮
 * - 毛玻璃 + 底部 1px 内描边
 */
import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '@/src-tauri/api';

const TITLEBAR_HEIGHT = 36;
const BTN_SIZE = 46;

const titlebarStyle: React.CSSProperties = {
  height: TITLEBAR_HEIGHT,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  background: 'var(--color-surface-glass)',
  backdropFilter: 'var(--blur-acrylic)',
  WebkitBackdropFilter: 'var(--blur-acrylic)',
  borderBottom: '1px solid var(--color-border)',
  flex: '0 0 auto',
  userSelect: 'none',
};

const logoStyle: React.CSSProperties = {
  paddingLeft: 12,
  paddingRight: 12,
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.4,
  color: 'var(--color-text-main)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: '100%',
};

const baseBtnStyle: React.CSSProperties = {
  width: BTN_SIZE,
  height: TITLEBAR_HEIGHT,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-main)',
  cursor: 'default',
  transition: 'background var(--duration-fast) var(--ease-out-expo)',
};

function Titlebar(): JSX.Element {
  const isTauriEnv = api.isTauri();

  const handleMinimize = () => {
    if (!isTauriEnv) return;
    void getCurrentWindow().minimize();
  };

  const handleToggleMaximize = () => {
    if (!isTauriEnv) return;
    void getCurrentWindow().toggleMaximize();
  };

  const handleClose = () => {
    if (!isTauriEnv) return;
    void getCurrentWindow().close();
  };

  return (
    <div className="titlebar-drag-region" style={titlebarStyle}>
      <div className="no-drag" style={logoStyle}>
        <span
          style={{
            display: 'inline-flex',
            width: 16,
            height: 16,
            borderRadius: 'var(--radius-round)',
            background:
              'linear-gradient(135deg, var(--color-primary), var(--color-private))',
          }}
        />
        <span>WorkMemory</span>
      </div>

      {isTauriEnv && (
        <div className="no-drag" style={controlsStyle}>
          <button
            type="button"
            aria-label="最小化"
            title="最小化"
            style={baseBtnStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-surface-subtle)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            onClick={handleMinimize}
          >
            <Minus size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="最大化"
            title="最大化/还原"
            style={baseBtnStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-surface-subtle)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            onClick={handleToggleMaximize}
          >
            <Square size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            style={baseBtnStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-danger)';
              e.currentTarget.style.color = 'var(--color-on-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--color-text-main)';
            }}
            onClick={handleClose}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}

export default Titlebar;
