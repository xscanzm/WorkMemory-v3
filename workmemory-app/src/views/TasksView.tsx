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
import {
  GripVertical,
  Pencil,
  Check,
  Pin,
  Archive,
  Copy,
  Download,
  Trash2,
  FileJson,
  FileText,
} from 'lucide-react';
import { useTaskStore } from '../store/taskStore';
import type { Task } from '../store/taskStore';
import { toast } from '../store/toastStore';
import { useDebouncedValue } from '../utils/debounce';
import { downloadText, timestampForFilename } from '../utils/download';
import { batchUpdateTasks, batchDeleteTasks } from '../src-tauri/api';
import TaskCard from '../components/TaskCard';
import TaskForm from '../components/TaskForm';
import FAB from '../components/FAB';
import ConfirmDialog from '../components/ConfirmDialog';
import BatchToolbar from '../components/BatchToolbar';
import { ContextMenuWrapper, type ContextMenuItem } from '../components/ContextMenu';

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
  // 右键删除二次确认目标（Task 20）
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  // Task 21：批量多选状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Shift+Click 范围选择的上次点击索引锚点
  const lastClickedIndexRef = useRef<number | null>(null);
  // 批量删除二次确认（与单条删除 deleteTarget 区分）
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  // 挂载时确保任务数据已加载（App 启动亦会加载，此处保证视图自洽）
  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // 搜索防抖 300ms（统一使用 useDebouncedValue，审计意见 2.2）；空查询回退到全量列表
  const debouncedQuery = useDebouncedValue(query, 300);
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    void searchTasks(q).then(setSearchResults);
  }, [debouncedQuery, searchTasks]);

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

  // ===== Task 20：右键菜单动作处理 =====
  const toggleComplete = (task: Task): void => {
    const next = task.status === 'completed' ? 'todo' : 'completed';
    void useTaskStore.getState().updateTask({ ...task, status: next });
    toast.success(next === 'completed' ? '已标记完成' : '已取消完成');
  };

  const togglePin = (task: Task): void => {
    void useTaskStore.getState().updateTask({ ...task, isPinned: !task.isPinned });
    toast.success(task.isPinned ? '已取消置顶' : '已置顶');
  };

  const toggleArchive = (task: Task): void => {
    const next = task.status === 'archived' ? 'todo' : 'archived';
    void useTaskStore.getState().updateTask({ ...task, status: next });
    toast.success(next === 'archived' ? '已归档' : '已取消归档');
  };

  const copyTitle = async (task: Task): Promise<void> => {
    try {
      await navigator.clipboard.writeText(task.title);
      toast.success('已复制标题');
    } catch {
      toast.error('复制失败');
    }
  };

  const exportTask = (task: Task, format: 'md' | 'json'): void => {
    if (format === 'md') {
      const lines: string[] = [
        `# ${task.title}`,
        '',
        `- **状态**: ${task.status}`,
        `- **优先级**: ${task.priority}`,
        `- **分类**: ${task.category || '无'}`,
        task.dueDate ? `- **到期**: ${task.dueDate}` : null,
        task.tags.length ? `- **标签**: ${task.tags.map((t) => `#${t}`).join(' ')}` : null,
        '',
        '## 描述',
        '',
        task.description || '（无描述）',
      ].filter((line): line is string => Boolean(line));
      downloadText(
        `task-${task.id.slice(0, 8)}-${timestampForFilename()}.md`,
        lines.join('\n') + '\n',
        'text/markdown;charset=utf-8',
      );
    } else {
      downloadText(
        `task-${task.id.slice(0, 8)}-${timestampForFilename()}.json`,
        JSON.stringify(task, null, 2),
        'application/json;charset=utf-8',
      );
    }
    toast.success('已导出');
  };

  const confirmDelete = (): void => {
    if (!deleteTarget) return;
    void useTaskStore.getState().deleteTask(deleteTarget.id);
    setDeleteTarget(null);
  };

  /** 构建单个 Task 的右键菜单项 */
  const buildTaskMenuItems = (task: Task): ContextMenuItem[] => [
    { type: 'action', label: '编辑', icon: <Pencil size={14} />, onSelect: () => openEdit(task) },
    {
      type: 'action',
      label: task.status === 'completed' ? '取消完成' : '标记完成',
      icon: <Check size={14} />,
      onSelect: () => toggleComplete(task),
    },
    {
      type: 'action',
      label: task.isPinned ? '取消置顶' : '置顶',
      icon: <Pin size={14} />,
      onSelect: () => togglePin(task),
    },
    {
      type: 'action',
      label: task.status === 'archived' ? '取消归档' : '归档',
      icon: <Archive size={14} />,
      onSelect: () => toggleArchive(task),
    },
    { type: 'action', label: '复制标题', icon: <Copy size={14} />, onSelect: () => void copyTitle(task) },
    {
      type: 'submenu',
      label: '导出',
      icon: <Download size={14} />,
      items: [
        { type: 'action', label: 'Markdown', icon: <FileText size={14} />, onSelect: () => exportTask(task, 'md') },
        { type: 'action', label: 'JSON', icon: <FileJson size={14} />, onSelect: () => exportTask(task, 'json') },
      ],
    },
    { type: 'separator' },
    {
      type: 'action',
      label: '删除',
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () => setDeleteTarget(task),
    },
  ];

  // ===== Task 21：批量多选交互 =====
  /**
   * 任务卡片点击：根据修饰键决定行为
   *   - Shift+Click：从上次点击项到当前项范围全选
   *   - Ctrl/Cmd+Click：toggle 单个选中
   *   - 普通点击：已有选中则清空选中；无选中则打开编辑
   *
   * 注意：与 TaskCard 的滑动手势（Task 23.6）正交——滑动是水平拖拽，
   * 点击是 pointerup 且无显著位移，不会触发选择逻辑。
   */
  const handleTaskClick = (e: React.MouseEvent, task: Task, index: number): void => {
    // Shift+Click：范围选择（保留已有选中，叠加范围）
    if (e.shiftKey && lastClickedIndexRef.current !== null) {
      const start = Math.min(lastClickedIndexRef.current, index);
      const end = Math.max(lastClickedIndexRef.current, index);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const id = visibleTasks[i]?.id;
          if (id) next.add(id);
        }
        return next;
      });
      return;
    }
    // Ctrl/Cmd+Click：toggle 单个
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(task.id)) {
          next.delete(task.id);
        } else {
          next.add(task.id);
        }
        return next;
      });
      lastClickedIndexRef.current = index;
      return;
    }
    // 普通点击：已有选中 → 清空；无选中 → 打开编辑
    if (selectedIds.size > 0) {
      setSelectedIds(new Set());
      lastClickedIndexRef.current = null;
      return;
    }
    lastClickedIndexRef.current = index;
    openEdit(task);
  };

  const handleSelectAll = (): void => {
    if (selectedIds.size === visibleTasks.length && visibleTasks.length > 0) {
      // 已全选 → 取消全选
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleTasks.map((t) => t.id)));
    }
  };

  const handleClearSelection = (): void => {
    setSelectedIds(new Set());
    lastClickedIndexRef.current = null;
  };

  const allSelected =
    visibleTasks.length > 0 && selectedIds.size === visibleTasks.length;

  /** 批量完成：调用 batch_update_tasks({ completed: true }) */
  const handleBatchComplete = async (): Promise<void> => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const affected = await batchUpdateTasks(ids, { completed: true });
      toast.success(`已完成 ${affected} 项`);
      handleClearSelection();
      await loadTasks();
    } catch (err) {
      toast.error('批量完成失败');
      // eslint-disable-next-line no-console
      console.error('[TasksView] batch complete failed', err);
    }
  };

  /** 批量归档：调用 batch_update_tasks({ archived: true }) */
  const handleBatchArchive = async (): Promise<void> => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const affected = await batchUpdateTasks(ids, { archived: true });
      toast.success(`已归档 ${affected} 项`);
      handleClearSelection();
      await loadTasks();
    } catch (err) {
      toast.error('批量归档失败');
      // eslint-disable-next-line no-console
      console.error('[TasksView] batch archive failed', err);
    }
  };

  /** 批量删除：先弹二次确认，确认后调用 batch_delete_tasks */
  const handleBatchDeleteClick = (): void => {
    setBatchDeleteOpen(true);
  };

  const confirmBatchDelete = async (): Promise<void> => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setBatchDeleteOpen(false);
      return;
    }
    try {
      const affected = await batchDeleteTasks(ids);
      toast.success(`已删除 ${affected} 项`);
      handleClearSelection();
      setBatchDeleteOpen(false);
      await loadTasks();
    } catch (err) {
      toast.error('批量删除失败');
      // eslint-disable-next-line no-console
      console.error('[TasksView] batch delete failed', err);
      setBatchDeleteOpen(false);
    }
  };

  /** 批量导出：将选中任务合并导出为单个 Markdown 文件 */
  const handleBatchExport = (): void => {
    const selected = visibleTasks.filter((t) => selectedIds.has(t.id));
    if (selected.length === 0) return;
    const lines: string[] = [`# 任务批量导出（${selected.length} 项）`, ''];
    selected.forEach((task, idx) => {
      lines.push(`## ${idx + 1}. ${task.title}`, '');
      lines.push(
        `- **状态**: ${task.status}`,
        `- **优先级**: ${task.priority}`,
        `- **分类**: ${task.category || '无'}`,
      );
      if (task.dueDate) lines.push(`- **到期**: ${task.dueDate}`);
      if (task.tags.length) {
        lines.push(`- **标签**: ${task.tags.map((t) => `#${t}`).join(' ')}`);
      }
      lines.push('', '### 描述', '', task.description || '（无描述）', '');
    });
    downloadText(
      `tasks-batch-${timestampForFilename()}.md`,
      lines.join('\n') + '\n',
      'text/markdown;charset=utf-8',
    );
    toast.success('已导出');
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

      {/* Task 21：批量多选工具条（选中数 > 0 时显示） */}
      {selectedIds.size > 0 && (
        <BatchToolbar
          selectedCount={selectedIds.size}
          allSelected={allSelected}
          onSelectAll={handleSelectAll}
          onClearSelection={handleClearSelection}
          onComplete={handleBatchComplete}
          onArchive={handleBatchArchive}
          onExport={handleBatchExport}
          onDelete={handleBatchDeleteClick}
        />
      )}

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
              const selected = selectedIds.has(task.id);
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
                  <ContextMenuWrapper items={buildTaskMenuItems(task)}>
                    <div
                      onClick={(e) => handleTaskClick(e, task, virtualRow.index)}
                      style={cardWrapperStyle(selected)}
                    >
                      <TaskCard task={task} onEdit={openEdit} />
                    </div>
                  </ContextMenuWrapper>
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
                {visibleTasks.map((task, index) => (
                  <SortableTaskCard
                    key={task.id}
                    task={task}
                    onEdit={openEdit}
                    menuItems={buildTaskMenuItems(task)}
                    selected={selectedIds.has(task.id)}
                    onClick={(e) => handleTaskClick(e, task, index)}
                  />
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
            {visibleTasks.map((task, index) => (
              <ContextMenuWrapper key={task.id} items={buildTaskMenuItems(task)}>
                <div
                  className="list-item-enter"
                  onClick={(e) => handleTaskClick(e, task, index)}
                  style={cardWrapperStyle(selectedIds.has(task.id))}
                >
                  <TaskCard task={task} onEdit={openEdit} />
                </div>
              </ContextMenuWrapper>
            ))}
          </div>
        )}
      </div>

      <FAB onClick={openCreate} />

      <TaskForm open={formOpen} task={editingTask} onClose={() => setFormOpen(false)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除任务"
        message={`确认删除「${deleteTarget?.title ?? ''}」？此操作不可撤销。`}
        confirmText="删除"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Task 21：批量删除二次确认 */}
      <ConfirmDialog
        open={batchDeleteOpen}
        title="批量删除任务"
        message={`确认删除选中的 ${selectedIds.size} 项任务？此操作不可撤销。`}
        confirmText="删除"
        danger
        onConfirm={() => void confirmBatchDelete()}
        onCancel={() => setBatchDeleteOpen(false)}
      />
    </div>
  );
}

/* ===== 样式 ===== */
/**
 * 可拖拽排序的任务卡片包装（Task 23.5）
 *
 * - 使用专用拖拽手柄（⠿）承载 dnd-kit listeners，避免与 TaskCard 卡体滑动手势（Task 23.6）冲突
 * - 手柄与卡体并排；拖拽时整体降透明度并提升层级
 * - Task 21：透传 selected / onClick 用于批量多选
 */
function SortableTaskCard({
  task,
  onEdit,
  menuItems,
  selected,
  onClick,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  menuItems: ContextMenuItem[];
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
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
      <ContextMenuWrapper items={menuItems}>
        <div
          className="list-item-enter"
          onClick={onClick}
          style={{ ...cardWrapperStyle(selected), flex: 1, minWidth: 0 }}
        >
          <TaskCard task={task} onEdit={onEdit} />
        </div>
      </ContextMenuWrapper>
    </div>
  );
}

/**
 * Task 21：批量选中卡片的包装样式
 * 选中时左侧主色边框高亮 + 淡色背景，提示用户当前在批量选择态。
 */
function cardWrapperStyle(selected: boolean): React.CSSProperties {
  return {
    borderLeft: selected
      ? '3px solid var(--color-primary)'
      : '3px solid transparent',
    background: selected ? 'var(--color-primary-soft)' : 'transparent',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition:
      'background var(--duration-fast) var(--ease-out-expo), border-color var(--duration-fast) var(--ease-out-expo)',
  };
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
