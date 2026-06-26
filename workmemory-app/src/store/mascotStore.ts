/**
 * Mascot 状态映射工具 (04_UI_SPEC.md §5.5)
 * RecorderState → MascotStateName 默认映射。
 */
import type { MascotStateName, RecorderState } from '@/types';

/**
 * 录制状态机映射到桌面伙伴动画状态。
 * 严格遵循 04_UI_SPEC.md §5.5 规格逐字实现。
 */
export function recorderStateToMascotState(rs: RecorderState): MascotStateName {
  switch (rs) {
    case 'Recording':
      return 'idle';
    case 'Idle':
      return 'sleep';
    case 'Paused':
      return 'sit';
    case 'PrivacyMode':
      return 'special';
    default:
      return 'idle';
  }
}
