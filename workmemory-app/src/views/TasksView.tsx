/**
 * 任务管理视图 (TasksView) - WorkMemory-v3 Task 9 / Task 22 性能优化
 *
 * - 顶部：标题 + 状态筛选 chips（全部/Inbox/待办/进行中/已完成/已归档）+ 搜索输入
 * - 列表：按筛选状态过滤 useTaskStore.tasks；搜索时调用 searchTasks（300ms 防抖）
 * - 加载/空状态友好提示；右下角 FAB 触发新建任务表单
 * - Task 22.1：列表条目 > 100 时启用 @tanstack/react-virtual 虚拟滚动（80px 估算行高）；
 *   ≤ 100 条沿用普通渲染以保留原有间距/样式。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useTaskStore } from '../store/taskStore';
import type { Task } from '../store/taskStore';
import TaskCard from '../components/TaskCard';
import TaskForm from '../components/TaskForm';
import FAB from '../components/FAB';

type StatusFilter = 'all' | Task['status'];

/** 启用虚拟滚动的任务数阈值（SubTask 22.1：> 100 时启用） */
const VIRTUALIZATION_THRESHOLD = 100;
/** 虚拟列表行高估算（px），实际行高通过 measureElement 动态测量 */
const ROW_ESTIMATE = 80;

const FILTER_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'todo', label: '待办' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'archived', label: '已归档' },
];

export default function TasksView(): JSX.Element {
  const tasks = useTaskStore((s) => s.tasks);
  const isLoading = useTaskStore((s) => s.isLoading);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const searchTasks = useTaskStore((s) => s.searchTasks);

  const [filter, setFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Task[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // 挂载时确保任务数据已加载（App 启动亦会加载，此处保证视图自洽）
  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // 搜索防抖 300ms；空查询回退到全量列表
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void searchTasks(q).then(setSearchResults);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchTasks]);

  // 数据源：搜索时用搜索结果，否则用 store tasks；再按状态筛选
  const source = searchResults ?? tasks;
  const visibleTasks = useMemo(() => {
    if (filter === 'all') return source;
    return source.filter((t) => t.status === filter);
  }, [source, filter]);

  // Task 22.1：> 100 条时启用虚拟滚动；≤ 100 条走标准渲染
  const shouldVirtualize = visibleTasks.length > VIRTUALIZATION_THRESHOLD;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? visibleTasks.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 5,
  });

  // Task 23.5：拖拽排序仅在「全部」筛选 + 无搜索 + 非虚拟滚动时启用
  // （筛选/搜索为子集，重排后无法直接映射回全量 sort_order；虚拟滚动与 dnd-kit 组合复杂）
  const canDrag = filter === 'all' && !query.trim() && !shouldVirtualize;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleTasks.findIndex((t) => t.id === active.id);
    const newIndex = visibleTasks.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(visibleTasks, oldIndex, newIndex);
    // 乐观更新 store 顺序（canDrag 为真时 visibleTasks 即全量 tasks）
    useTaskStore.setState({ tasks: reordered });
    // 持久化 sort_order 发生变化的项
    for (let idx = 0; idx < reordered.length; idx++) {
      const t = reordered[idx];
      if (t.sortOrder !== idx) {
        // eslint-disable-next-line no-await-in-loop
        await useTaskStore.getState().updateTask({ ...t, sortOrder: idx });
      }
    }
  };

  const openCreate = (): void => {
    setEditingTask(null);
    setFormOpen(true);
  };

  const openEdit = (task: Task): void => {
    setEditingTask(task);
    setFormOpen(true);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 头部：标题 + 筛选 + 搜索 */}
      <header
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
          marginBottom: 'var(--space-lg)',
          flexShrink: 0,
        }}
      >
        <h1
          style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text-main)', margin: 0 }}
        >
          任务
        </h1>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setFilter(chip.value)}
              style={chipStyle(filter === chip.value)}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索任务…"
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: 13,
            color: 'var(--color-text-main)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </header>

      {/* 列表区域（内部滚动，避免与外层 main 双滚动条） */}
      <div ref={scrollContainerRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {isLoading && tasks.length === 0 ? (
          <div style={centerHint}>加载中...</div>
        ) : visibleTasks.length === 0 ? (
          <div style={centerHint}>
            {tasks.length === 0
              ? '还没有任务，点击右下角 + 创建第一个任务'
              : '没有符合条件的任务'}
          </div>
        ) : shouldVirtualize ? (
          // Task 22.1：> 100 条任务时启用虚拟滚动，仅渲染可见窗口内的 TaskCard
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: virtualizer.getTotalSize(),
              paddingBottom: 80,
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const task = visibleTasks[virtualRow.index];
              return (
                <div
                  key={task.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    marginBottom: 'var(--space-md)',
                  }}
                >
                  <TaskCard task={task} onEdit={openEdit} />
                </div>
              );
            })}
          </div>
        ) : canDrag ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visibleTasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-md)',
                  paddingBottom: 80,
                }}
              >
                {visibleTasks.map((task) => (
                  <SortableTaskCard key={task.id} task={task} onEdit={openEdit} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-md)',
              paddingBottom: 80,
            }}
          >
            {visibleTasks.map((task) => (
              <TaskCard key={task.id} task={task} onEdit={openEdit} />
            ))}
          </div>
        )}
      </div>

      <FAB onClick={openCreate} />

      <TaskForm open={formOpen} task={editingTask} onClose={() => setFormOpen(false)} />
    </div>
  );
}

/* ===== 样式 ===== */
/**
 * 可拖拽排序的任务卡片包装（Task 23.5）
 *
 * - 使用专用拖拽手柄（⠿）承载 dnd-kit listeners，避免与 TaskCard 卡体滑动手势（Task 23.6）冲突
 * - 手柄与卡体并排；拖拽时整体降透明度并提升层级
 */
function SortableTaskCard({
  task,
  onEdit,
}: {
  task: Task;
  onEdit: (task: Task) => void;
}): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : 'auto',
        display: 'flex',
        alignItems: 'stretch',
        gap: 'var(--space-xs)',
      }}
    >
      <button
        type="button"
        aria-label="拖拽排序"
        {...attributes}
        {...listeners}
        style={{
          flex: '0 0 auto',
          width: 24,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-surface-subtle)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          cursor: isDragging ? 'grabbing' : 'grab',
          color: 'var(--color-text-muted)',
          padding: 0,
          touchAction: 'none',
        }}
      >
        <GripVertical size={14} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TaskCard task={task} onEdit={onEdit} />
      </div>
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--color-on-primary)' : 'var(--color-text-muted)',
    background: active ? 'var(--color-primary)' : 'var(--color-surface)',
    border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
    borderRadius: 'var(--radius-round)',
    cursor: 'pointer',
    transition:
      'background var(--duration-fast) var(--ease-out-expo), color var(--duration-fast) var(--ease-out-expo)',
  };
}

const centerHint: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-2xl) var(--space-lg)',
  color: 'var(--color-text-muted)',
  fontSize: 14,
  textAlign: 'center',
};
