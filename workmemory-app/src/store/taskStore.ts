/**
 * 任务状态管理 (Zustand) - WorkMemory-v3 Task 6
 *
 * 对接后端 task_engine.rs 的 IPC 命令：
 *   - save_task / get_all_tasks / update_task / delete_task / search_tasks
 *
 * 字段与 src-tauri/src/models.rs::Task 对齐（serde camelCase）。
 * 所有 action 捕获异常并 toast 提示，永不向调用方抛出。
 */
import { create } from 'zustand';
import { invoke } from '../src-tauri/api';
import { toast } from './toastStore';

export interface Task {
    id: string;
    title: string;
    description: string;
    status: 'inbox' | 'todo' | 'in_progress' | 'completed' | 'archived';
    priority: 'none' | 'low' | 'medium' | 'high' | 'urgent';
    dueDate: string | null;
    moodTag: string | null;
    recurrenceRule: string | null;
    isPinned: boolean;
    sortOrder: number;
    subtasks: string[];
    category: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
}

interface TaskState {
    tasks: Task[];
    isLoading: boolean;
    /** 加载任务列表；可选分页参数（Task 22.3）。不传时由后端默认 limit=100, offset=0 */
    loadTasks: (opts?: { limit?: number; offset?: number }) => Promise<void>;
    saveTask: (task: Partial<Task>) => Promise<Task | null>;
    updateTask: (task: Task) => Promise<boolean>;
    deleteTask: (id: string) => Promise<boolean>;
    searchTasks: (query: string) => Promise<Task[]>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
    tasks: [],
    isLoading: false,
    loadTasks: async (opts) => {
        set({ isLoading: true });
        try {
            // 仅在显式传入时附加分页参数；后端默认 limit=100, offset=0
            const args: { limit?: number; offset?: number } = {};
            if (opts?.limit !== undefined) args.limit = opts.limit;
            if (opts?.offset !== undefined) args.offset = opts.offset;
            const tasks = await invoke<Task[]>('get_all_tasks', args);
            set({ tasks, isLoading: false });
        } catch (err) {
            console.error('[taskStore] loadTasks 失败', err);
            toast.error('加载任务失败');
            set({ isLoading: false });
        }
    },
    saveTask: async (task) => {
        try {
            // 后端生成 uuid v4，前端传空 id；其余字段补默认值
            const payload: Task = {
                id: '',
                title: '',
                description: '',
                status: 'inbox',
                priority: 'none',
                dueDate: null,
                moodTag: null,
                recurrenceRule: null,
                isPinned: false,
                sortOrder: 0,
                subtasks: [],
                category: '',
                tags: [],
                createdAt: '',
                updatedAt: '',
                ...task,
            };
            const saved = await invoke<Task>('save_task', { task: payload });
            set({ tasks: [saved, ...get().tasks] });
            toast.success('任务已创建');
            return saved;
        } catch (err) {
            console.error('[taskStore] saveTask 失败', err);
            toast.error('创建任务失败');
            return null;
        }
    },
    updateTask: async (task) => {
        try {
            await invoke('update_task', { task });
            set({ tasks: get().tasks.map((t) => (t.id === task.id ? task : t)) });
            return true;
        } catch (err) {
            console.error('[taskStore] updateTask 失败', err);
            toast.error('更新任务失败');
            return false;
        }
    },
    deleteTask: async (id) => {
        try {
            await invoke('delete_task', { id });
            set({ tasks: get().tasks.filter((t) => t.id !== id) });
            toast.success('任务已删除');
            return true;
        } catch (err) {
            console.error('[taskStore] deleteTask 失败', err);
            toast.error('删除任务失败');
            return false;
        }
    },
    searchTasks: async (query) => {
        try {
            return await invoke<Task[]>('search_tasks', { query });
        } catch (err) {
            console.error('[taskStore] searchTasks 失败', err);
            return [];
        }
    },
}));
