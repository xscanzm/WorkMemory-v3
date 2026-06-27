/**
 * 音景混音器 (SoundscapeMixer) - Task 25 / Task 22.4 懒加载
 *
 * - 挂载时拉取已启用音景包 (get_soundscape_packs)
 * - 空态："暂无音景包，请在设置中添加"（当前无实际音频资源，常态空态）
 * - 每个音景包：图标+名称+描述 / 播放暂停按钮 / 音量滑块 (0-100)
 * - 多包可同时播放（多层混合）
 * - 主控"全部停止"按钮
 * - 卸载时停止所有音频
 *
 * Task 22.4 音景资源懒加载：
 * - audio 元素仅在用户点击"播放"时创建（不在挂载时预加载、不在调音量时预创建）
 * - 每个 pack 至多一个 HTMLAudioElement（playingRef Map 单元素模式）
 * - 调音量时若 pack 尚未播放，仅记录到 pendingVolumes state，待点击播放时再应用到新建 audio
 * - 卸载/停止时 pause + 清空 src 释放资源
 *
 * 注意：实际音频文件资源尚未提供，asset:// 路径在 dev 环境无法解析，
 * Audio onerror 会静默触发，UI 仍保持响应（graceful degradation）。
 */
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, Volume2, Music } from 'lucide-react';
import { invoke, isTauri } from '@/src-tauri/api';

/** 音景包 DTO（与后端 models.rs::SoundscapePack 对齐，camelCase） */
interface SoundscapePack {
  id: string;
  name: string;
  description: string;
  layers: string[]; // JSON 数组：每项为音频文件路径
  enabled: boolean;
  createdAt: string;
}

/** 单个音景包的播放状态 */
interface PlayingState {
  audio: HTMLAudioElement;
  volume: number;
  isPlaying: boolean;
}

/* ===== 样式 ===== */
const wrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-md)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-sm)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-text-main)',
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-xs)',
};

const stopAllBtnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 500,
  color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-main)',
  background: 'var(--color-surface-subtle)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-xs)',
});

const emptyStyle: React.CSSProperties = {
  padding: 'var(--space-xl) var(--space-md)',
  textAlign: 'center',
  color: 'var(--color-text-muted)',
  fontSize: 12,
  background: 'var(--color-surface-subtle)',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-md)',
};

const packListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-sm)',
};

const packCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-sm)',
  padding: 'var(--space-md)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
};

const packHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-sm)',
};

const packIconStyle: React.CSSProperties = {
  fontSize: 18,
  color: 'var(--color-primary)',
  flexShrink: 0,
};

const packTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-text-main)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const packDescStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  marginTop: 2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const playBtnStyle = (isPlaying: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-on-primary)',
  background: isPlaying ? 'var(--color-text-muted)' : 'var(--color-primary)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-xs)',
  flexShrink: 0,
});

const volumeRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-sm)',
};

const volumeIconStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  flexShrink: 0,
};

const sliderStyle: React.CSSProperties = {
  flex: 1,
  cursor: 'pointer',
  accentColor: 'var(--color-primary)',
};

const volumeValueStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  minWidth: 28,
  textAlign: 'right',
};

/**
 * 构造音频 URL：
 * - Tauri 环境：asset://localhost/{path}
 * - Web/dev：直接使用 path（基本无法解析，Audio onerror 静默处理）
 */
function buildAudioUrl(layer: string): string {
  if (isTauri()) {
    return `asset://localhost/${layer}`;
  }
  return layer;
}

export default function SoundscapeMixer(): JSX.Element {
  const [packs, setPacks] = useState<SoundscapePack[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // 播放状态：packId → PlayingState；用 useRef 持有 Audio 元素避免重建
  const playingRef = useRef<Map<string, PlayingState>>(new Map());
  // Task 22.4：尚未播放的 pack 的待生效音量（用户调音量时未创建 audio，先记这里）
  const [pendingVolumes, setPendingVolumes] = useState<Record<string, number>>({});
  // 强制重渲：ref 变更不触发渲染，需配合 state
  const [, setTick] = useState<number>(0);
  const forceUpdate = (): void => setTick((t) => t + 1);

  /** 拉取已启用音景包 */
  async function loadPacks(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<SoundscapePack[]>('get_soundscape_packs');
      setPacks(list);
    } catch (err) {
      console.error('[SoundscapeMixer] 拉取音景包失败', err);
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  }

  // 挂载时拉取
  useEffect(() => {
    void loadPacks();
  }, []);

  // 卸载时停止所有音频并释放资源
  useEffect(() => {
    const map = playingRef.current;
    return () => {
      map.forEach((state) => {
        state.audio.pause();
        state.audio.src = '';
      });
      map.clear();
    };
  }, []);

  /**
   * Task 22.4：为某 pack 创建新的 Audio 元素（仅在用户点击播放时调用）。
   * 应用 pendingVolumes 中记录的待生效音量，缺省 60。
   * 无音频层时返回 null 并打 warn。
   */
  function createAudioForPlay(pack: SoundscapePack): HTMLAudioElement | null {
    // 取首个 layer 作为音频源；无 layer 则无法播放
    const layer = pack.layers[0];
    if (!layer) return null;
    const url = buildAudioUrl(layer);
    const audio = new Audio(url);
    audio.loop = true; // 音景循环播放
    // 应用待生效音量（用户在播放前调整过）；默认 60
    const vol = pendingVolumes[pack.id] ?? 60;
    audio.volume = vol / 100;
    // 错误处理：asset 路径不存在时静默（dev 环境常态）
    audio.addEventListener('error', () => {
      console.warn(`[SoundscapeMixer] 音频加载失败: ${url}`);
    });
    return audio;
  }

  /** 切换播放/暂停 */
  function handleTogglePlay(pack: SoundscapePack): void {
    const existing = playingRef.current.get(pack.id);
    if (existing) {
      if (existing.isPlaying) {
        existing.audio.pause();
        existing.isPlaying = false;
      } else {
        void existing.audio.play().catch((e) => {
          console.warn('[SoundscapeMixer] 播放失败', e);
        });
        existing.isPlaying = true;
      }
    } else {
      // Task 22.4：仅在用户点击播放时创建 audio 元素（懒加载，不预加载、不在调音量时预创建）
      const audio = createAudioForPlay(pack);
      if (!audio) {
        console.warn('[SoundscapeMixer] 该音景包无音频层');
        return;
      }
      void audio.play().catch((e) => {
        console.warn('[SoundscapeMixer] 播放失败', e);
      });
      playingRef.current.set(pack.id, {
        audio,
        volume: pendingVolumes[pack.id] ?? 60,
        isPlaying: true,
      });
    }
    forceUpdate();
  }

  /** 调整音量（0-100）。Task 22.4：未播放的 pack 仅记录到 pendingVolumes，不创建 audio */
  function handleVolumeChange(pack: SoundscapePack, volume: number): void {
    const state = playingRef.current.get(pack.id);
    if (state) {
      // 已在播放（或已暂停但 audio 已创建）：直接应用到 audio 元素
      state.volume = volume;
      state.audio.volume = volume / 100;
    } else {
      // Task 22.4：包尚未播放 → 仅记录待生效音量，不创建 audio（懒加载）
      setPendingVolumes((prev) => ({ ...prev, [pack.id]: volume }));
    }
    forceUpdate();
  }

  /** 全部停止 */
  function handleStopAll(): void {
    playingRef.current.forEach((state) => {
      state.audio.pause();
      state.audio.currentTime = 0;
      state.isPlaying = false;
    });
    forceUpdate();
  }

  /** 是否有任一包正在播放 */
  const anyPlaying = Array.from(playingRef.current.values()).some((s) => s.isPlaying);

  return (
    <div style={wrapperStyle}>
      <div style={headerStyle}>
        <h3 style={titleStyle}>
          <Music size={14} aria-hidden="true" />
          音景
        </h3>
        {packs.length > 0 && (
          <button
            type="button"
            aria-label="停止所有音景"
            style={stopAllBtnStyle(!anyPlaying)}
            disabled={!anyPlaying}
            onClick={handleStopAll}
          >
            <Square size={12} aria-hidden="true" />
            全部停止
          </button>
        )}
      </div>

      {loading ? (
        <div style={emptyStyle}>加载中…</div>
      ) : error ? (
        <div style={emptyStyle}>{error}</div>
      ) : packs.length === 0 ? (
        <div style={emptyStyle}>暂无音景包，请在设置中添加</div>
      ) : (
        <div style={packListStyle}>
          {packs.map((pack) => {
            const state = playingRef.current.get(pack.id);
            const isPlaying = state?.isPlaying ?? false;
            // Task 22.4：未播放的 pack 显示 pendingVolumes 中记录的待生效音量，缺省 60
            const volume = state?.volume ?? pendingVolumes[pack.id] ?? 60;
            const hasLayer = pack.layers.length > 0;
            return (
              <div key={pack.id} style={packCardStyle}>
                <div style={packHeaderStyle}>
                  <span style={packIconStyle} aria-hidden="true">🎵</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={packTitleStyle}>{pack.name}</div>
                    {pack.description && (
                      <div style={packDescStyle}>{pack.description}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={isPlaying ? `暂停 ${pack.name}` : `播放 ${pack.name}`}
                    style={playBtnStyle(isPlaying)}
                    disabled={!hasLayer}
                    onClick={() => handleTogglePlay(pack)}
                  >
                    {isPlaying ? (
                      <Pause size={12} aria-hidden="true" />
                    ) : (
                      <Play size={12} aria-hidden="true" />
                    )}
                    {isPlaying ? '暂停' : '播放'}
                  </button>
                </div>
                <div style={volumeRowStyle}>
                  <Volume2 size={14} style={volumeIconStyle} aria-hidden="true" />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volume}
                    onChange={(e) => handleVolumeChange(pack, Number(e.target.value))}
                    style={sliderStyle}
                    aria-label={`${pack.name} 音量`}
                  />
                  <span style={volumeValueStyle}>{volume}</span>
                </div>
                {!hasLayer && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-light)' }}>
                    该音景包未配置音频层
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
