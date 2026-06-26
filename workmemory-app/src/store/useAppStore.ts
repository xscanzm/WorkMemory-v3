/**
 * WorkMemory 全局状态 (Zustand)
 * 严格遵循 03_CORE_ARCHITECTURE.md §2.2 前端状态分层与 04_UI_SPEC.md §2 三栏布局。
 */
import { create } from 'zustand';
import type {
  AppSetting,
  CleanEpisode,
  MascotStateName,
  RecorderState,
} from '@/types';

/** 返回今日 YYYY-MM-DD */
function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface AppStoreState {
  // ===== 状态 =====
  recorderState: RecorderState;
  episodes: CleanEpisode[];
  activeDate: string;
  activeView: string;
  settings: AppSetting | null;
  mascotId: number;
  mascotState: MascotStateName;
  isLoading: boolean;
  todaySummary: string;

  // ===== Actions =====
  setRecorderState: (s: RecorderState) => void;
  setEpisodes: (e: CleanEpisode[]) => void;
  setActiveDate: (d: string) => void;
  setActiveView: (v: string) => void;
  setSettings: (s: AppSetting) => void;
  setMascotId: (id: number) => void;
  setMascotState: (s: MascotStateName) => void;
  setTodaySummary: (s: string) => void;
  setLoading: (b: boolean) => void;
}

export const useAppStore = create<AppStoreState>((set) => ({
  // 默认值（04_UI_SPEC.md §5.5 默认状态映射）
  recorderState: 'Recording',
  episodes: [],
  activeDate: today(),
  activeView: 'today',
  settings: null,
  mascotId: 1,
  mascotState: 'idle',
  isLoading: false,
  todaySummary: '',

  setRecorderState: (recorderState) => set({ recorderState }),
  setEpisodes: (episodes) => set({ episodes }),
  setActiveDate: (activeDate) => set({ activeDate }),
  setActiveView: (activeView) => set({ activeView }),
  setSettings: (settings) => set({ settings }),
  setMascotId: (mascotId) => set({ mascotId }),
  setMascotState: (mascotState) => set({ mascotState }),
  setTodaySummary: (todaySummary) => set({ todaySummary }),
  setLoading: (isLoading) => set({ isLoading }),
}));
