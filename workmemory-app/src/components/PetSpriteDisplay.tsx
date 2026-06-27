/**
 * 宠物精灵显示组件 - Task 10 / Task 23.2 / Task 23.3
 *
 * 包装现有 MascotSprite，负责：
 *  - 将 petStore 的 mood 字符串映射到 MascotStateName
 *  - 在非 Tauri 环境 / 精灵图加载失败时降级为 emoji
 *  - Task 23.2：通过 mascotId prop 选择不同形象（1-9 映射 /pet/{id}/spritesheet.webp）
 *  - Task 23.3：levelupKey 变化时切换到 special 状态 2 秒后回到 mood 对应状态
 *
 * 注意：src-tauri/resources/pet/ 当前仅含占位文件，打包前 spritesheet.webp 不存在，
 * 故必须优雅降级（避免空白方框）。
 */
import { useEffect, useState } from 'react';
import MascotSprite from './mascot/MascotSprite';
import type { MascotStateName } from '@/types';

export interface PetSpriteDisplayProps {
  mood: string;
  scale?: number;
  /** 形象 ID 1-9，默认 1（Task 23.2） */
  mascotId?: number;
  /** 升级信号：每次递增触发 special 状态 2 秒（Task 23.3） */
  levelupKey?: number;
}

/** pet mood → MascotStateName 映射（覆盖 9 状态中最贴近的动画） */
function moodToState(mood: string): MascotStateName {
  switch (mood) {
    case 'ecstatic':
      // 兴奋用 jump 非循环动画
      return 'jump';
    case 'happy':
    case 'content':
      return 'idle';
    case 'neutral':
      return 'sit';
    case 'sad':
    case 'angry':
      // fall 是最贴近"低落"的非循环动画
      return 'fall';
    case 'sleeping':
      return 'sleep';
    default:
      return 'idle';
  }
}

/** pet mood → emoji 降级映射 */
function moodToEmoji(mood: string): string {
  switch (mood) {
    case 'ecstatic':
      return '🤩';
    case 'happy':
    case 'content':
      return '😊';
    case 'neutral':
      return '😐';
    case 'sad':
      return '😢';
    case 'angry':
      return '😠';
    case 'sleeping':
      return '😴';
    default:
      return '😊';
  }
}

/** 是否运行在 Tauri 桌面环境（与 MascotSprite 保持一致） */
function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 计算与 MascotSprite 一致的 Spritesheet 资源路径，用于探测可加载性 */
function buildSpriteSrc(mascotId: number): string {
  if (isTauriEnv()) {
    return `asset://localhost/pet/${mascotId}/spritesheet.webp`;
  }
  return `/pet/${mascotId}/spritesheet.webp`;
}

export default function PetSpriteDisplay(props: PetSpriteDisplayProps): JSX.Element {
  const { mood, scale = 1.5, mascotId = 1, levelupKey = 0 } = props;
  const emoji = moodToEmoji(mood);
  const moodState = moodToState(mood);

  // 升级动画覆盖状态：非空时使用该状态，2 秒后清除
  const [overrideState, setOverrideState] = useState<MascotStateName | null>(null);

  // 探测 spritesheet 可用性：null=未探测、true=可加载、false=降级
  const [imgOk, setImgOk] = useState<boolean | null>(null);

  // mascotId 变化时重新探测资源可用性
  useEffect(() => {
    if (!isTauriEnv()) {
      setImgOk(false);
      return;
    }
    let cancelled = false;
    setImgOk(null);
    const probe = new Image();
    probe.onload = () => {
      if (!cancelled) setImgOk(true);
    };
    probe.onerror = () => {
      if (!cancelled) setImgOk(false);
    };
    probe.src = buildSpriteSrc(mascotId);
    return () => {
      cancelled = true;
    };
  }, [mascotId]);

  // Task 23.3：levelupKey 变化时切换到 special 状态 2 秒
  useEffect(() => {
    if (levelupKey <= 0) return;
    setOverrideState('special');
    const timer = setTimeout(() => {
      setOverrideState(null);
    }, 2000);
    return () => clearTimeout(timer);
  }, [levelupKey]);

  const activeState = overrideState ?? moodState;

  // 探测期间或失败时显示 emoji 降级
  if (imgOk !== true) {
    return (
      <div
        role="img"
        aria-label={`pet-emoji-${mood}`}
        style={{
          fontSize: 64 * scale,
          lineHeight: 1,
          userSelect: 'none',
          // 升级时轻微弹跳反馈（内联 keyframes 降级环境亦可用）
          transform: overrideState === 'special' ? 'scale(1.18)' : 'scale(1)',
          transition: 'transform 200ms var(--ease-out-expo, ease-out)',
        }}
      >
        {emoji}
      </div>
    );
  }

  return <MascotSprite mascotId={mascotId} state={activeState} scale={scale} />;
}
