/**
 * 桌面伙伴 Spritesheet 动画渲染组件 (04_UI_SPEC.md §5.4)
 *
 * 严格逐字遵循 04_UI_SPEC.md §5.4 规格：
 * - 常量 CELL_W=192、CELL_H=208
 * - STATE_ROWS 含 9 个状态：idle/walk/run/sleep/sit/jump/fall/drag/special
 * - frame 步进按 fps；非循环动画到末帧停 + 调 onAnimationEnd
 * - backgroundPosition 步进 bgX=-(frame*CELL_W)、bgY=-(config.row*CELL_H)
 * - backgroundSize `auto ${CELL_H*scale*9}px`
 * - imageRendering:'pixelated'、cursor:'grab'、userSelect:'none'
 *
 * Task 22.2：新增 `mode: 'canvas' | 'dom'`（默认 'dom'）。
 * - 'dom'（默认）：原有 background-position 帧步进，样式不变。
 * - 'canvas'：通过 <canvas> + ctx.drawImage 切片渲染每帧，作为性能模式。
 *   复用 CELL_W / CELL_H / STATE_ROWS；spritesheet 由 new Image() 挂载时加载一次。
 */
import { useEffect, useRef, useState } from 'react';
import type { MascotStateName } from '@/types';

/** 单帧宽（与 pet.json layout.cellWidth 一致） */
const CELL_W = 192;
/** 单帧高（与 pet.json layout.rowHeight 一致） */
const CELL_H = 208;

/** 9 个动画状态在 Spritesheet 中的行号、帧数、帧率、是否循环 */
const STATE_ROWS = {
  idle:    { row: 0, frames: 6, fps: 8,  loop: true  },
  walk:    { row: 1, frames: 8, fps: 10, loop: true  },
  run:     { row: 2, frames: 8, fps: 12, loop: true  },
  sleep:   { row: 3, frames: 4, fps: 4,  loop: true  },
  sit:     { row: 4, frames: 5, fps: 6,  loop: true  },
  jump:    { row: 5, frames: 8, fps: 12, loop: false },
  fall:    { row: 6, frames: 6, fps: 10, loop: false },
  drag:    { row: 7, frames: 6, fps: 10, loop: true  },
  special: { row: 8, frames: 6, fps: 8,  loop: true  },
} as const;

type StateConfig = (typeof STATE_ROWS)[MascotStateName];

export interface MascotSpriteProps {
  mascotId: number;
  state: MascotStateName;
  scale?: number;
  /** 渲染模式：'dom'（默认，background-position 帧步进）/ 'canvas'（drawImage 切片，性能模式） */
  mode?: 'canvas' | 'dom';
  onAnimationEnd?: () => void;
}

/** 是否运行在 Tauri 桌面环境 */
function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 计算 Spritesheet 资源路径。
 * Tauri 环境通过 asset://localhost 协议读取打包资源；Web 环境降级为 /pet/<id>/...
 */
function buildSpriteSrc(mascotId: number): string {
  if (isTauriEnv()) {
    return `asset://localhost/pet/${mascotId}/spritesheet.webp`;
  }
  return `/pet/${mascotId}/spritesheet.webp`;
}

function MascotSprite(props: MascotSpriteProps): JSX.Element {
  const { mascotId, state, scale = 1.0, mode = 'dom', onAnimationEnd } = props;
  const config: StateConfig = STATE_ROWS[state];

  const [frame, setFrame] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // onAnimationEnd 用 ref 持有，避免 effect 因回调引用变化而重启动画
  const onEndRef = useRef(onAnimationEnd);
  onEndRef.current = onAnimationEnd;

  // ===== Canvas 模式资源 =====
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spriteImgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const spriteSrc = buildSpriteSrc(mascotId);

  // Canvas 模式：挂载时加载一次 spritesheet Image（drawImage 切片源）
  useEffect(() => {
    if (mode !== 'canvas') {
      // 切回 DOM 模式时清理 canvas 资源状态
      spriteImgRef.current = null;
      setImgReady(false);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      spriteImgRef.current = img;
      setImgReady(true);
    };
    img.onerror = () => {
      // 静默降级：dev 环境资源缺失时 canvas 保持空白（与 DOM 模式 graceful degradation 一致）
      if (cancelled) return;
      spriteImgRef.current = null;
      setImgReady(false);
    };
    img.src = spriteSrc;
    return () => {
      cancelled = true;
      spriteImgRef.current = null;
      setImgReady(false);
    };
  }, [mode, spriteSrc]);

  // Canvas 模式：frame / row / scale / imgReady 任一变化时重绘当前帧
  useEffect(() => {
    if (mode !== 'canvas') return;
    const canvas = canvasRef.current;
    const img = spriteImgRef.current;
    if (!canvas || !img || !imgReady) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sx = frame * CELL_W;
    const sy = config.row * CELL_H;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      img,
      sx, sy, CELL_W, CELL_H,
      0, 0, CELL_W * scale, CELL_H * scale,
    );
  }, [mode, frame, imgReady, config.row, scale]);

  useEffect(() => {
    // 每次切换状态都从第 0 帧开始
    setFrame(0);

    // 清理上一个 interval
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const intervalMs = 1000 / config.fps;

    intervalRef.current = setInterval(() => {
      setFrame((prev) => {
        const next = prev + 1;
        if (config.loop) {
          // 循环动画：取模回到首帧
          return next % config.frames;
        }
        // 非循环动画：到达末帧后停止并触发回调
        if (next >= config.frames) {
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          // 触发一次性回调（在状态机之外，避免 setState 副作用嵌套）
          const cb = onEndRef.current;
          if (cb) {
            // 异步调用，避免在 setState updater 中执行副作用
            setTimeout(cb, 0);
          }
          return config.frames - 1; // 停在末帧
        }
        return next;
      });
    }, intervalMs);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state, mascotId, config.row, config.frames, config.fps, config.loop]);

  const w = CELL_W * scale;
  const h = CELL_H * scale;

  // ===== Canvas 模式：drawImage 切片渲染 =====
  if (mode === 'canvas') {
    // canvas 缓冲像素分辨率 = CELL × scale（向上取整保证非整数 scale 也不丢帧）
    const bufferW = Math.max(1, Math.round(CELL_W * scale));
    const bufferH = Math.max(1, Math.round(CELL_H * scale));
    return (
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`mascot-${state}`}
        width={bufferW}
        height={bufferH}
        style={{
          width: w,
          height: h,
          imageRendering: 'pixelated',
          cursor: 'grab',
          userSelect: 'none',
          // 透明窗口内不需要额外背景色
          backgroundColor: 'transparent',
        }}
      />
    );
  }

  // ===== DOM 模式（默认）：background-position 帧步进（保持原有样式与行为） =====
  const bgX = -(frame * CELL_W);
  const bgY = -(config.row * CELL_H);

  return (
    <div
      role="img"
      aria-label={`mascot-${state}`}
      style={{
        width: w,
        height: h,
        backgroundImage: `url("${spriteSrc}")`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        backgroundSize: `auto ${CELL_H * scale * 9}px`,
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
        cursor: 'grab',
        userSelect: 'none',
        // 透明窗口内不需要额外背景色
        backgroundColor: 'transparent',
      }}
    />
  );
}

export default MascotSprite;
