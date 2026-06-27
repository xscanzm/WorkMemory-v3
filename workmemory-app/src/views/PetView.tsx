/**
 * 宠物视图 (PetView) - Task 10
 *
 * - 挂载时拉取宠物状态（loadPetState，与 App.tsx 调用幂等）
 * - 无宠物：显示领养引导，点击"领养"写入默认宠物
 * - 有宠物：顶部精灵展示 + 名字/等级/心情 + 5 项属性条 + 4 个动作按钮
 * - 动作按钮调用 petStore 对应方法，期间禁用并显示 loading；store 内部已 toast 结果
 */
import { useEffect, useState } from 'react';
import { usePetStore } from '@/store/petStore';
import type { PetState } from '@/store/petStore';
import { toast } from '@/store/toastStore';
import { useAppStore } from '@/store/useAppStore';
import { api } from '@/src-tauri/api';
import PetSpriteDisplay from '@/components/PetSpriteDisplay';

/** 4 个动作按钮配置 */
type ActionKey = 'feed' | 'play' | 'rest' | 'clean';

const ACTIONS: Array<{ key: ActionKey; label: string; emoji: string; ariaLabel: string }> = [
  { key: 'feed', label: '喂食', emoji: '🍖', ariaLabel: '喂食宠物' },
  { key: 'play', label: '玩耍', emoji: '🎾', ariaLabel: '和宠物玩耍' },
  { key: 'rest', label: '休息', emoji: '💤', ariaLabel: '让宠物休息' },
  { key: 'clean', label: '清洁', emoji: '🛁', ariaLabel: '清洁宠物' },
];

/** 9 个可选形象（Task 23.2 宠物换装，与 SettingsView 一致） */
const MASCOTS: Array<{ id: number; en: string; zh: string }> = [
  { id: 1, en: 'Boba', zh: '奶茶杯' },
  { id: 2, en: 'Doubao', zh: '豆包少女' },
  { id: 3, en: 'Nyanko v2', zh: '猫咪' },
  { id: 4, en: 'Bolt', zh: '机器人' },
  { id: 5, en: 'Doraemon', zh: '哆啦A梦' },
  { id: 6, en: 'Mochi', zh: '猫咪' },
  { id: 7, en: 'Sabo', zh: '绅士' },
  { id: 8, en: 'EVE', zh: '机器人' },
  { id: 9, en: 'Boxcat', zh: '盒子里的猫' },
];

/** 5 项属性展示配置（key 与 PetState 数值字段对齐） */
const STAT_CONFIG: Array<{ key: keyof PetState; label: string; color: string }> = [
  { key: 'hunger', label: '饱腹度', color: 'var(--color-warning)' },
  { key: 'energy', label: '能量', color: 'var(--color-secondary)' },
  { key: 'happiness', label: '心情', color: 'var(--color-primary)' },
  { key: 'cleanliness', label: '清洁度', color: 'var(--color-success)' },
  { key: 'bondLevel', label: '亲密度', color: 'var(--color-accent)' },
];

/** mood → 中文标签 */
function moodLabel(mood: string): string {
  switch (mood) {
    case 'ecstatic':
      return '兴奋';
    case 'happy':
      return '开心';
    case 'content':
      return '满足';
    case 'neutral':
      return '平静';
    case 'sad':
      return '难过';
    case 'angry':
      return '生气';
    case 'sleeping':
      return '困倦';
    default:
      return mood;
  }
}

/** 默认领养宠物（spec 给定的初值） */
function buildDefaultPet(): PetState {
  return {
    id: crypto.randomUUID(),
    species: '小助手',
    level: 1,
    xp: 0,
    hunger: 50,
    energy: 50,
    happiness: 50,
    cleanliness: 50,
    bondLevel: 0,
    mood: 'happy',
    lastUpdated: new Date().toISOString(),
  };
}

/* ===== 样式 ===== */
const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--space-lg)',
  padding: 'var(--space-xl)',
  maxWidth: 560,
  margin: '0 auto',
};

const spriteWrapStyle: React.CSSProperties = {
  // 192×208 × 1.5 = 288×312，与 scale 1.5 对齐，避免布局抖动
  width: 288,
  height: 312,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const titleStyle: React.CSSProperties = {
  textAlign: 'center',
};

const statsPanelStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-md)',
};

const statRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-xs)',
};

const statLabelStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 12,
  color: 'var(--color-text-main)',
};

const barTrackStyle: React.CSSProperties = {
  width: '100%',
  height: 8,
  background: 'var(--color-surface-subtle)',
  borderRadius: 'var(--radius-round)',
  overflow: 'hidden',
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 'var(--space-md)',
  width: '100%',
  justifyContent: 'center',
};

const actionBtnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--space-xs)',
  padding: 'var(--space-md)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: 12,
  color: 'var(--color-text-main)',
  transition: 'background var(--duration-fast) var(--ease-out-expo)',
};

/* Task 23.2：换装面板样式 */
const speciesPanelStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-md)',
};

const speciesTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-text-main)',
};

const speciesGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 'var(--space-sm)',
};

const speciesBtnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: 'var(--space-sm) var(--space-xs)',
  borderRadius: 'var(--radius-md)',
  transition:
    'background var(--duration-fast) var(--ease-out-expo), border-color var(--duration-fast) var(--ease-out-expo)',
};

const emptyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: 'var(--space-2xl)',
  textAlign: 'center',
};

const adoptBtnStyle: React.CSSProperties = {
  marginTop: 'var(--space-lg)',
  padding: 'var(--space-sm) var(--space-xl)',
  background: 'var(--color-primary)',
  color: 'var(--color-on-primary)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
};

export default function PetView(): JSX.Element {
  const petState = usePetStore((s) => s.petState);
  const isLoading = usePetStore((s) => s.isLoading);
  const levelupSignal = usePetStore((s) => s.levelupSignal);
  const mascotId = useAppStore((s) => s.mascotId);
  const setStoreMascotId = useAppStore((s) => s.setMascotId);
  // 当前执行中的动作 key（含 'adopt'），用于禁用按钮与显示 loading
  const [acting, setActing] = useState<string | null>(null);

  // 挂载时拉取宠物状态
  useEffect(() => {
    void usePetStore.getState().loadPetState();
  }, []);

  // 领养默认宠物
  async function handleAdopt(): Promise<void> {
    setActing('adopt');
    try {
      const ok = await usePetStore.getState().savePetState(buildDefaultPet());
      if (ok) {
        toast.success('领养成功，欢迎你的小伙伴');
      }
    } finally {
      setActing(null);
    }
  }

  // 执行动作（喂食/玩耍/休息/清洁），store 内部已 toast 结果
  async function handleAction(key: ActionKey): Promise<void> {
    setActing(key);
    try {
      const store = usePetStore.getState();
      if (key === 'feed') await store.feed();
      else if (key === 'play') await store.play();
      else if (key === 'rest') await store.rest();
      else await store.clean();
    } finally {
      setActing(null);
    }
  }

  // Task 23.2：切换形象 → 更新 pet.species + 持久化 mascotId
  async function handlePickSpecies(id: number): Promise<void> {
    if (!petState) return;
    const m = MASCOTS.find((x) => x.id === id);
    if (!m) return;
    if (id === mascotId && petState.species === m.en) return;
    setActing(`species-${id}`);
    try {
      // 持久化 mascotId（驱动精灵图选择）
      setStoreMascotId(id);
      try {
        await api.setMascotId(id);
      } catch (err) {
        console.error('[PetView] setMascotId 失败', err);
      }
      // 更新 pet.species 并保存（保留其余属性）
      await usePetStore.getState().savePetState({ ...petState, species: m.en });
    } finally {
      setActing(null);
    }
  }

  // 初次加载且无宠物：显示加载占位
  if (isLoading && petState === null) {
    return (
      <div style={containerStyle}>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>加载中…</div>
      </div>
    );
  }

  // 无宠物：领养引导
  if (petState === null) {
    return (
      <div style={containerStyle}>
        <div style={emptyStyle}>
          <div style={{ fontSize: 72 }}>🐣</div>
          <div
            style={{
              color: 'var(--color-text-main)',
              fontSize: 16,
              marginTop: 'var(--space-lg)',
            }}
          >
            还没有宠物，点击下方按钮领养一只
          </div>
          <button
            type="button"
            aria-label="领养宠物"
            onClick={() => void handleAdopt()}
            disabled={acting === 'adopt'}
            style={adoptBtnStyle}
          >
            {acting === 'adopt' ? '领养中…' : '领养'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* 顶部：精灵展示 */}
      <div style={spriteWrapStyle}>
        <PetSpriteDisplay
          mood={petState.mood}
          scale={1.5}
          mascotId={mascotId}
          levelupKey={levelupSignal}
        />
      </div>

      {/* 名字 + 等级 + 心情 */}
      <div style={titleStyle}>
        <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text-main)' }}>
          {petState.species}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
          Lv.{petState.level} · {moodLabel(petState.mood)}
        </div>
      </div>

      {/* 属性面板：5 项进度条 */}
      <div style={statsPanelStyle}>
        {STAT_CONFIG.map((cfg) => {
          const val = petState[cfg.key] as number;
          const pct = Math.max(0, Math.min(100, val));
          return (
            <div key={cfg.key} style={statRowStyle}>
              <div style={statLabelStyle}>
                <span>{cfg.label}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>{Math.round(val)}</span>
              </div>
              <div style={barTrackStyle}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: cfg.color,
                    borderRadius: 'var(--radius-round)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* 动作按钮行 */}
      <div style={actionRowStyle}>
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            aria-label={a.ariaLabel}
            onClick={() => void handleAction(a.key)}
            disabled={acting !== null}
            style={actionBtnStyle}
          >
            <span style={{ fontSize: 20 }}>{a.emoji}</span>
            <span>{a.label}</span>
          </button>
        ))}
      </div>

      {/* Task 23.2：宠物换装 / 外观选择 */}
      <div style={speciesPanelStyle}>
        <div style={speciesTitleStyle}>外观选择</div>
        <div style={speciesGridStyle}>
          {MASCOTS.map((m) => {
            const selected = m.id === mascotId;
            return (
              <button
                key={m.id}
                type="button"
                aria-label={`选择形象 ${m.en}`}
                aria-pressed={selected}
                onClick={() => void handlePickSpecies(m.id)}
                disabled={acting !== null}
                style={{
                  ...speciesBtnStyle,
                  border: selected
                    ? '2px solid var(--color-primary)'
                    : '1px solid var(--color-border)',
                  background: selected
                    ? 'var(--color-primary-soft)'
                    : 'var(--color-surface)',
                  cursor: acting !== null ? 'not-allowed' : 'pointer',
                  opacity: acting !== null ? 0.6 : 1,
                }}
              >
                <span style={{ fontSize: 22 }}>{m.id}</span>
                <span
                  style={{
                    fontSize: 11,
                    color: selected ? 'var(--color-primary)' : 'var(--color-text-main)',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {m.en}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
