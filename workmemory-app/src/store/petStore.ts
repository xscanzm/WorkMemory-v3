/**
 * 宠物状态管理 (Zustand) - WorkMemory-v3 Task 6
 *
 * 对接后端 pet_engine.rs 的 IPC 命令：
 *   - get_pet_state / save_pet_state
 *   - feed_pet / play_pet / rest_pet / clean_pet
 *
 * 字段与 src-tauri/src/models.rs::PetState 对齐（serde camelCase）。
 * 所有 action 捕获异常并 toast 提示，永不向调用方抛出。
 *
 * Task 23.3：每次后端返回新 PetState 时比较 prev_level → new_level，
 * 检测到升级则递增 levelupSignal 并 toast "升级！"，
 * PetView 据此触发 MascotSprite 的 special 状态 2 秒。
 *
 * 注意：get_pet_state 在宠物未初始化时返回 NotFound 错误（pet_engine.rs），
 * loadPetState 据此静默处理，保持 petState 为 null（首次启动属正常情况）。
 */
import { create } from 'zustand';
import { invoke } from '../src-tauri/api';
import { toast } from './toastStore';

export interface PetState {
    id: string;
    species: string;
    level: number;
    xp: number;
    hunger: number;
    energy: number;
    happiness: number;
    cleanliness: number;
    bondLevel: number;
    mood: string;
    lastUpdated: string;
}

interface PetStoreState {
    petState: PetState | null;
    isLoading: boolean;
    /** 升级信号：每次检测到 level 增长时 +1，PetView 监听以触发升级动画 */
    levelupSignal: number;
    loadPetState: () => Promise<void>;
    savePetState: (pet: PetState) => Promise<boolean>;
    feed: () => Promise<void>;
    play: () => Promise<void>;
    rest: () => Promise<void>;
    clean: () => Promise<void>;
}

export const usePetStore = create<PetStoreState>((set, get) => ({
    petState: null,
    isLoading: false,
    levelupSignal: 0,

    loadPetState: async () => {
        set({ isLoading: true });
        try {
            const pet = await invoke<PetState>('get_pet_state');
            set({ petState: pet, isLoading: false });
        } catch (err) {
            // 宠物状态未初始化属正常情况（首次启动），静默保持 null
            console.debug('[petStore] 宠物状态未初始化', err);
            set({ petState: null, isLoading: false });
        }
    },

    savePetState: async (pet) => {
        try {
            await invoke('save_pet_state', { pet });
            // 检测升级（换装场景下 level 通常不变，但仍统一处理）
            const prev = get().petState;
            if (prev && pet.level > prev.level) {
                set({ petState: pet, levelupSignal: get().levelupSignal + 1 });
                toast.success(`🎉 升级！Lv.${pet.level}`);
            } else {
                set({ petState: pet });
            }
            toast.success('宠物状态已保存');
            return true;
        } catch (err) {
            console.error('[petStore] savePetState 失败', err);
            toast.error('保存宠物状态失败');
            return false;
        }
    },

    feed: async () => {
        const prev = get().petState; // 快照用于回滚（审计意见 2.3）
        try {
            const pet = await invoke<PetState>('feed_pet');
            if (prev && pet.level > prev.level) {
                set({ petState: pet, levelupSignal: get().levelupSignal + 1 });
                toast.success(`🎉 升级！Lv.${pet.level}`);
            } else {
                set({ petState: pet });
            }
            toast.success('喂食成功');
        } catch (err) {
            console.error('[petStore] feed 失败', err);
            set({ petState: prev }); // IPC 失败回滚
            toast.error('操作失败，已回滚');
        }
    },

    play: async () => {
        const prev = get().petState; // 快照用于回滚（审计意见 2.3）
        try {
            const pet = await invoke<PetState>('play_pet');
            if (prev && pet.level > prev.level) {
                set({ petState: pet, levelupSignal: get().levelupSignal + 1 });
                toast.success(`🎉 升级！Lv.${pet.level}`);
            } else {
                set({ petState: pet });
            }
            toast.success('玩耍成功');
        } catch (err) {
            console.error('[petStore] play 失败', err);
            set({ petState: prev }); // IPC 失败回滚
            toast.error('操作失败，已回滚');
        }
    },

    rest: async () => {
        const prev = get().petState; // 快照用于回滚（审计意见 2.3）
        try {
            const pet = await invoke<PetState>('rest_pet');
            if (prev && pet.level > prev.level) {
                set({ petState: pet, levelupSignal: get().levelupSignal + 1 });
                toast.success(`🎉 升级！Lv.${pet.level}`);
            } else {
                set({ petState: pet });
            }
            toast.success('休息成功');
        } catch (err) {
            console.error('[petStore] rest 失败', err);
            set({ petState: prev }); // IPC 失败回滚
            toast.error('操作失败，已回滚');
        }
    },

    clean: async () => {
        const prev = get().petState; // 快照用于回滚（审计意见 2.3）
        try {
            const pet = await invoke<PetState>('clean_pet');
            if (prev && pet.level > prev.level) {
                set({ petState: pet, levelupSignal: get().levelupSignal + 1 });
                toast.success(`🎉 升级！Lv.${pet.level}`);
            } else {
                set({ petState: pet });
            }
            toast.success('清洁成功');
        } catch (err) {
            console.error('[petStore] clean 失败', err);
            set({ petState: prev }); // IPC 失败回滚
            toast.error('操作失败，已回滚');
        }
    },
}));
