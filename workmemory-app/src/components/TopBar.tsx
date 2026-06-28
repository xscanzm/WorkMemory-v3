/**
 * 顶部状态栏 (04_UI_SPEC.md §2 TopBar)
 *
 * - 左：录制状态指示圆点（绿=Recording / 灰=Paused / 紫=PrivacyMode / 暗黄=Idle）+ 状态文字
 * - 中：面包屑导航（Task 14，根据当前路由显示层级路径，占据中部主要空间）
 * - 右：全局搜索框（点击跳转搜索页，提示 "Ctrl+K 搜索"）+ 快捷控制（暂停/恢复 + 隐私模式切换）
 * - 毛玻璃 + 底部 1px 边框
 */
import { useNavigate } from 'react-router-dom';
import { Pause, Play, Shield, ShieldOff, Search } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '../store/toastStore';
import { api } from '@/src-tauri/api';
import type { RecorderState } from '@/types';
import Breadcrumbs from './Breadcrumbs';

const topbarStyle: React.CSSProperties = {
  flex: '0 0 auto',
  height: 52,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 var(--space-lg)',
  background: 'var(--color-surface-glass)',
  backdropFilter: 'var(--blur-acrylic)',
  WebkitBackdropFilter: 'var(--blur-acrylic)',
  borderBottom: '1px solid var(--color-border)',
  gap: 'var(--space-lg)',
};

const STATE_META: Record<
  RecorderState,
  { color: string; label: string; dotGlow: boolean }
> = {
  Recording: { color: 'var(--color-success)', label: '记录中', dotGlow: true },
  Paused: { color: 'var(--color-text-light)', label: '已暂停', dotGlow: false },
  PrivacyMode: {
    color: 'var(--color-private)',
    label: '隐私模式',
    dotGlow: false,
  },
  Idle: { color: 'var(--color-warning)', label: '空闲', dotGlow: false },
};

function TopBar(): JSX.Element {
  const navigate = useNavigate();
  const recorderState = useAppStore((s) => s.recorderState);

  const meta = STATE_META[recorderState];

  const handleTogglePause = async () => {
    const next: RecorderState =
      recorderState === 'Recording' ? 'Paused' : 'Recording';
    try {
      await api.setRecorderState(next);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[setRecorderState] 失败', err);
      toast.error('录制状态切换失败');
    }
  };

  const handleTogglePrivacy = async () => {
    const next: RecorderState =
      recorderState === 'PrivacyMode' ? 'Recording' : 'PrivacyMode';
    try {
      await api.setRecorderState(next);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[setRecorderState] 失败', err);
      toast.error('录制状态切换失败');
    }
  };

  const isPaused = recorderState === 'Paused';
  const isPrivacy = recorderState === 'PrivacyMode';

  return (
    <header style={topbarStyle}>
      {/* 左：录制状态指示 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          minWidth: 140,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 'var(--radius-round)',
            background: meta.color,
            boxShadow: meta.dotGlow
              ? `0 0 0 4px color-mix(in srgb, ${meta.color} 25%, transparent)`
              : 'none',
            flex: '0 0 auto',
          }}
        />
        <span
          style={{
            fontSize: 13,
            color: 'var(--color-text-main)',
            fontWeight: 500,
          }}
        >
          {meta.label}
        </span>
      </div>

      {/* 中：面包屑导航（Task 14，占据中部主要空间） */}
      <Breadcrumbs />

      {/* 右：搜索框 + 快捷控制 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          minWidth: 0,
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/search')}
          title="全局检索"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            height: 32,
            padding: '0 12px',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)',
            color: 'var(--color-text-light)',
            fontSize: 12,
            cursor: 'pointer',
            minWidth: 180,
            transition: 'border-color var(--duration-fast) var(--ease-out-expo)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border)';
          }}
        >
          <Search size={14} />
          <span>Ctrl+K 搜索</span>
        </button>

        <button
          type="button"
          onClick={handleTogglePause}
          title={isPaused ? '恢复记录' : '暂停记录'}
          aria-label={isPaused ? '恢复记录' : '暂停记录'}
          style={ctrlBtnStyle(isPaused)}
        >
          {isPaused ? <Play size={16} /> : <Pause size={16} />}
        </button>

        <button
          type="button"
          onClick={handleTogglePrivacy}
          title={isPrivacy ? '退出隐私模式' : '进入隐私模式'}
          aria-label={isPrivacy ? '退出隐私模式' : '进入隐私模式'}
          style={ctrlBtnStyle(isPrivacy)}
        >
          {isPrivacy ? <ShieldOff size={16} /> : <Shield size={16} />}
        </button>
      </div>
    </header>
  );
}

/** 快捷控制按钮统一样式 */
function ctrlBtnStyle(active: boolean): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: active ? 'var(--color-primary-soft)' : 'var(--color-surface)',
    color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
    cursor: 'pointer',
    transition:
      'background var(--duration-fast) var(--ease-out-expo), color var(--duration-fast) var(--ease-out-expo), border-color var(--duration-fast) var(--ease-out-expo)',
  };
}

export default TopBar;
