/**
 * TagManagementView - 标签管理面板 (audit-v4-hardening Task 15)
 *
 * 功能：
 *   - 顶部工具栏：搜索框（过滤标签名）+ "合并模式"切换按钮
 *   - TagCloud 区域：所有标签以云形布局展示（字号根据 count 缩放，颜色根据 color）
 *   - 点击标签：弹出操作菜单（重命名、合并到...、设置颜色、删除、查看关联 Wiki）
 *   - 合并模式：多选标签 + 目标标签输入框 + 执行合并按钮
 *   - 颜色选择器：6 色预设 + 自定义 hex 输入
 *   - 重命名对话框：Radix Dialog + input
 *   - 关联 Wiki 列表：点击标签后显示该标签关联的 wiki_page 列表（前端过滤）
 *
 * 数据加载使用 useAsync hook（Task 10 已实现）。
 * 所有写入操作完成后调用 reload() 刷新数据。
 *
 * 禁止 Tailwind，全部 CSS 变量。
 */
import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Edit3,
  GitMerge,
  Palette,
  Search,
  Trash2,
  X,
  BookOpen,
} from 'lucide-react';
import { api } from '@/src-tauri/api';
import { useAsync } from '@/hooks/useAsync';
import { useDebouncedValue } from '@/utils/debounce';
import { toast } from '@/store/toastStore';
import TagCloud from '@/components/TagCloud';
import type { TagInfo, WikiPage } from '@/types';

const PRESET_COLORS = [
  '#2563EB', // 主色蓝
  '#10B981', // 成功绿
  '#F59E0B', // 警告黄
  '#EF4444', // 危险红
  '#8B5CF6', // 紫色
  '#06B6D4', // 青色
];

const TM_CSS = `
.tm-root { display:flex; flex-direction:column; height:100%; min-height:560px; gap: var(--space-md); }
.tm-toolbar {
  display:flex; align-items:center; gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: var(--color-surface); border:1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.tm-search {
  flex:1; height:32px; border:1px solid var(--color-border);
  border-radius: var(--radius-sm); padding: 0 var(--space-sm) 0 32px;
  font-size:13px; color: var(--color-text-main); background: var(--color-surface);
  outline:none; position:relative;
  transition: border-color var(--duration-fast) var(--ease-out-expo);
}
.tm-search:focus { border-color: var(--color-primary); }
.tm-search-wrap { position:relative; flex:1; display:flex; align-items:center; }
.tm-search-icon {
  position:absolute; left: var(--space-sm); top:50%; transform: translateY(-50%);
  color: var(--color-text-light); pointer-events:none;
}
.tm-btn {
  height:32px; padding: 0 var(--space-md); border:1px solid var(--color-border);
  background: var(--color-surface); color: var(--color-text-main);
  border-radius: var(--radius-sm); font-size:13px; font-weight:600; cursor:pointer;
  display:inline-flex; align-items:center; gap: var(--space-xs);
  transition: background var(--duration-fast) var(--ease-out-expo), border-color var(--duration-fast) var(--ease-out-expo);
}
.tm-btn:hover { background: var(--color-surface-subtle); border-color: var(--color-border-hover); }
.tm-btn:disabled { opacity:0.6; cursor:not-allowed; }
.tm-btn-primary { background: var(--color-primary); color: var(--color-on-primary); border-color: var(--color-primary); }
.tm-btn-primary:hover { background: var(--color-primary); filter: brightness(1.06); }
.tm-btn-danger { background: var(--color-danger); color: var(--color-on-danger); border-color: var(--color-danger); }
.tm-btn-active { background: var(--color-primary-soft); color: var(--color-primary); border-color: var(--color-primary); }

.tm-cloud-panel {
  flex:1; min-height:0; overflow:auto;
  background: var(--color-surface); border:1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.tm-merge-bar {
  display:flex; align-items:center; gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: var(--color-primary-soft); border:1px solid var(--color-primary);
  border-radius: var(--radius-md); font-size:13px; color: var(--color-text-main);
}
.tm-merge-bar input {
  height:28px; flex:1; max-width:240px;
  border:1px solid var(--color-border); border-radius: var(--radius-sm);
  padding: 0 var(--space-sm); font-size:13px; background: var(--color-surface);
  outline:none;
}
.tm-merge-bar input:focus { border-color: var(--color-primary); }

.tm-empty {
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  height:100%; color: var(--color-text-light); gap: var(--space-md);
  text-align:center; padding: var(--space-xl);
}

.tm-wiki-list {
  display:flex; flex-direction:column; gap: var(--space-xs); margin-top: var(--space-md);
  max-height:280px; overflow:auto;
}
.tm-wiki-item {
  padding: var(--space-sm) var(--space-md);
  background: var(--color-surface); border:1px solid var(--color-border);
  border-radius: var(--radius-sm); font-size:13px; color: var(--color-text-main);
  display:flex; flex-direction:column; gap: 2px;
}
.tm-wiki-item-title { font-weight:600; }
.tm-wiki-item-meta { font-size:11px; color: var(--color-text-muted); }

.tm-dialog-overlay {
  background: rgba(0,0,0,0.4); position:fixed; inset:0; z-index:50;
}
.tm-dialog-content {
  position:fixed; top:50%; left:50%; transform: translate(-50%, -50%);
  background: var(--color-surface); border:1px solid var(--color-border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-overlay);
  padding: var(--space-xl); min-width:360px; max-width:480px; z-index:51;
  display:flex; flex-direction:column; gap: var(--space-md);
}
.tm-dialog-title { font-size:15px; font-weight:700; color: var(--color-text-main); margin:0; }
.tm-dialog-input {
  height:32px; border:1px solid var(--color-border); border-radius: var(--radius-sm);
  padding: 0 var(--space-md); font-size:13px; color: var(--color-text-main);
  background: var(--color-surface); outline:none; width:100%;
}
.tm-dialog-input:focus { border-color: var(--color-primary); }
.tm-dialog-row { display:flex; align-items:center; gap: var(--space-md); justify-content:flex-end; }
.tm-color-grid { display:grid; grid-template-columns: repeat(6, 32px); gap: var(--space-sm); }
.tm-color-swatch {
  width:32px; height:32px; border-radius: var(--radius-md); cursor:pointer;
  border:2px solid transparent; transition: border-color var(--duration-fast) var(--ease-out-expo);
}
.tm-color-swatch:hover { border-color: var(--color-border-hover); }
.tm-color-swatch[data-active="true"] { border-color: var(--color-text-main); }

.tm-dropdown-content {
  min-width:200px; background: var(--color-surface); border:1px solid var(--color-border);
  border-radius: var(--radius-md); box-shadow: var(--shadow-overlay); padding: var(--space-xs);
}
.tm-dropdown-item {
  display:flex; align-items:center; gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm); font-size:13px; color: var(--color-text-main);
  cursor:pointer; border-radius: var(--radius-sm); outline:none;
}
.tm-dropdown-item:hover { background: var(--color-surface-subtle); }
.tm-dropdown-item[data-variant="danger"] { color: var(--color-danger); }
`;

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 560,
  gap: 'var(--space-md)',
};

interface OperationMenuState {
  tag: TagInfo;
  // 锚点位置（用于 dropdown menu 定位）
  x: number;
  y: number;
}

export default function TagManagementView(): JSX.Element {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [mergeTarget, setMergeTarget] = useState('');
  const [operationMenu, setOperationMenu] = useState<OperationMenuState | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ tag: TagInfo; newName: string } | null>(null);
  const [colorDialog, setColorDialog] = useState<{ tag: TagInfo; color: string } | null>(null);
  const [relatedWiki, setRelatedWiki] = useState<{ tag: string; pages: WikiPage[] } | null>(null);

  // 加载标签列表
  const { data: tags, loading, error, reload } = useAsync<TagInfo[]>(
    () => api.listTags(),
    { deps: [] },
  );

  // 搜索过滤
  const filteredTags = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return tags ?? [];
    return (tags ?? []).filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, debouncedSearch]);

  const handleTagClick = useCallback((tag: TagInfo) => {
    setOperationMenu({ tag, x: 0, y: 0 });
  }, []);

  const handleToggleSelect = useCallback((tagName: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName],
    );
  }, []);

  const handleRename = useCallback(async (): Promise<void> => {
    if (!renameDialog) return;
    const newName = renameDialog.newName.trim();
    if (!newName || newName === renameDialog.tag.name) {
      setRenameDialog(null);
      return;
    }
    try {
      const affected = await api.renameTag(renameDialog.tag.name, newName);
      toast.success(`已重命名，影响 ${affected} 个 Wiki 页面`);
      setRenameDialog(null);
      reload();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[TagManagementView] rename_tag failed', err);
      toast.error('重命名失败');
    }
  }, [renameDialog, reload]);

  const handleSetTagColor = useCallback(async (): Promise<void> => {
    if (!colorDialog) return;
    try {
      await api.setTagColor(colorDialog.tag.name, colorDialog.color);
      toast.success(colorDialog.color ? '已设置颜色' : '已清除颜色');
      setColorDialog(null);
      reload();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[TagManagementView] set_tag_color failed', err);
      toast.error('设置颜色失败');
    }
  }, [colorDialog, reload]);

  const handleMerge = useCallback(async (): Promise<void> => {
    const target = mergeTarget.trim();
    if (selectedTags.length === 0) {
      toast.error('请先选择至少一个源标签');
      return;
    }
    if (!target) {
      toast.error('请输入目标标签名');
      return;
    }
    if (selectedTags.includes(target)) {
      toast.error('目标标签不能在源标签列表中');
      return;
    }
    try {
      const affected = await api.mergeTags(selectedTags, target);
      toast.success(`已合并 ${selectedTags.length} 个标签到 "${target}"，影响 ${affected} 个 Wiki 页面`);
      setSelectedTags([]);
      setMergeTarget('');
      setMergeMode(false);
      reload();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[TagManagementView] merge_tags failed', err);
      toast.error('合并失败');
    }
  }, [selectedTags, mergeTarget, reload]);

  // 查看关联 Wiki：拉取所有 wiki_pages 后前端过滤
  const handleViewRelatedWiki = useCallback(async (tag: TagInfo): Promise<void> => {
    try {
      const pages = await api.getWikiPages();
      const related = pages.filter((p) => p.tags.includes(tag.name));
      setRelatedWiki({ tag: tag.name, pages: related });
      setOperationMenu(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[TagManagementView] get_wiki_pages failed', err);
      toast.error('加载关联 Wiki 失败');
    }
  }, []);

  // 删除标签：实现为重命名为空字符串？不允许，因此采用"从所有 wiki_pages 中移除"的策略
  // 这里复用 mergeTags 的逻辑：将单个标签"合并"到一个不存在的占位标签，但 spec 未明确要求后端删除命令。
  // 为保持与 spec 一致（不新增 delete_tag 命令），删除通过遍历 wiki_pages 在前端调用 update_wiki_page 实现。
  const handleDeleteTag = useCallback(
    async (tag: TagInfo): Promise<void> => {
      try {
        const pages = await api.getWikiPages();
        const related = pages.filter((p) => p.tags.includes(tag.name));
        for (const page of related) {
          const newTags = page.tags.filter((t) => t !== tag.name);
          await api.invoke('save_to_wiki', {
            episodeId: page.sourceEpisodeId ?? '',
            title: page.title,
            content: page.content,
            tags: newTags,
          });
        }
        // 同时清除颜色
        try {
          await api.setTagColor(tag.name, '');
        } catch {
          // 颜色清除失败不阻断
        }
        toast.success(`已从 ${related.length} 个 Wiki 页面移除标签 "${tag.name}"`);
        setOperationMenu(null);
        reload();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[TagManagementView] delete tag failed', err);
        toast.error('删除标签失败');
      }
    },
    [reload],
  );

  return (
    <div style={rootStyle}>
      <style>{TM_CSS}</style>

      {/* 顶部工具栏：搜索框 + 合并模式切换 */}
      <div className="tm-toolbar">
        <div className="tm-search-wrap">
          <Search size={14} className="tm-search-icon" />
          <input
            type="text"
            className="tm-search"
            placeholder="搜索标签名..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="搜索标签"
          />
        </div>
        <button
          type="button"
          className={mergeMode ? 'tm-btn tm-btn-active' : 'tm-btn'}
          onClick={() => {
            setMergeMode((m) => !m);
            setSelectedTags([]);
            setMergeTarget('');
          }}
          aria-pressed={mergeMode}
          title="切换合并模式"
        >
          <GitMerge size={14} />
          {mergeMode ? '退出合并' : '合并模式'}
        </button>
      </div>

      {/* 合并模式工具条 */}
      {mergeMode && (
        <div className="tm-merge-bar">
          <span>
            已选 <strong>{selectedTags.length}</strong> 个源标签
          </span>
          <input
            type="text"
            placeholder="目标标签名"
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            aria-label="目标标签名"
          />
          <button
            type="button"
            className="tm-btn tm-btn-primary"
            onClick={() => void handleMerge()}
            disabled={selectedTags.length === 0 || !mergeTarget.trim()}
          >
            <GitMerge size={14} />
            执行合并
          </button>
          <button
            type="button"
            className="tm-btn"
            onClick={() => {
              setSelectedTags([]);
              setMergeTarget('');
            }}
          >
            清空选择
          </button>
        </div>
      )}

      {/* 标签云 */}
      <div className="tm-cloud-panel">
        {loading ? (
          <div className="tm-empty">加载中…</div>
        ) : error ? (
          <div className="tm-empty">加载失败：{error.message}</div>
        ) : (
          <TagCloud
            tags={filteredTags}
            selectedTags={selectedTags}
            mergeMode={mergeMode}
            onTagClick={handleTagClick}
            onToggleSelect={handleToggleSelect}
          />
        )}
      </div>

      {/* 关联 Wiki 列表 */}
      {relatedWiki && (
        <div className="tm-cloud-panel" style={{ flex: '0 0 auto', maxHeight: 320 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-sm) var(--space-md)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-main)' }}>
              <BookOpen size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              标签 "{relatedWiki.tag}" 关联的 Wiki（{relatedWiki.pages.length}）
            </span>
            <button
              type="button"
              className="tm-btn"
              onClick={() => setRelatedWiki(null)}
              style={{ height: 24, padding: '0 var(--space-sm)', fontSize: 12 }}
            >
              <X size={12} />
              关闭
            </button>
          </div>
          <div className="tm-wiki-list" style={{ marginTop: 0, padding: 'var(--space-sm)' }}>
            {relatedWiki.pages.length === 0 ? (
              <div style={{ padding: 'var(--space-md)', color: 'var(--color-text-light)', fontSize: 13 }}>
                没有关联的 Wiki 页面
              </div>
            ) : (
              relatedWiki.pages.map((p) => (
                <div key={p.id} className="tm-wiki-item">
                  <span className="tm-wiki-item-title">{p.title}</span>
                  <span className="tm-wiki-item-meta">
                    标签：{p.tags.join('、') || '（无）'} · 更新于 {p.updatedAt}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 点击标签后的操作菜单（使用 Radix DropdownMenu，无锚点时挂在屏幕外） */}
      {operationMenu && (
        <DropdownMenu.Root
          open
          onOpenChange={(open) => {
            if (!open) setOperationMenu(null);
          }}
        >
          <DropdownMenu.Trigger asChild>
            <span
              style={{
                position: 'fixed',
                left: operationMenu.x,
                top: operationMenu.y,
                width: 0,
                height: 0,
                pointerEvents: 'none',
              }}
              aria-hidden
            />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="tm-dropdown-content" sideOffset={4}>
              <DropdownMenu.Item
                className="tm-dropdown-item"
                onSelect={() => {
                  setRenameDialog({ tag: operationMenu.tag, newName: operationMenu.tag.name });
                  setOperationMenu(null);
                }}
              >
                <Edit3 size={14} />
                重命名
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="tm-dropdown-item"
                onSelect={() => {
                  // 进入合并模式并选中当前标签
                  setMergeMode(true);
                  setSelectedTags([operationMenu.tag.name]);
                  setMergeTarget('');
                  setOperationMenu(null);
                }}
              >
                <GitMerge size={14} />
                合并到...
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="tm-dropdown-item"
                onSelect={() => {
                  setColorDialog({
                    tag: operationMenu.tag,
                    color: operationMenu.tag.color ?? '',
                  });
                  setOperationMenu(null);
                }}
              >
                <Palette size={14} />
                设置颜色
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="tm-dropdown-item"
                onSelect={() => {
                  void handleViewRelatedWiki(operationMenu.tag);
                }}
              >
                <BookOpen size={14} />
                查看关联 Wiki
              </DropdownMenu.Item>
              <DropdownMenu.Separator style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
              <DropdownMenu.Item
                className="tm-dropdown-item"
                data-variant="danger"
                onSelect={() => {
                  void handleDeleteTag(operationMenu.tag);
                }}
              >
                <Trash2 size={14} />
                删除标签
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}

      {/* 重命名对话框 */}
      <Dialog.Root
        open={renameDialog !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialog(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="tm-dialog-overlay" />
          <Dialog.Content className="tm-dialog-content">
            <Dialog.Title className="tm-dialog-title">重命名标签</Dialog.Title>
            <Dialog.Description style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
              将 "{renameDialog?.tag.name}" 重命名为：
            </Dialog.Description>
            <input
              type="text"
              className="tm-dialog-input"
              value={renameDialog?.newName ?? ''}
              onChange={(e) =>
                setRenameDialog((prev) =>
                  prev ? { ...prev, newName: e.target.value } : prev,
                )
              }
              autoFocus
              maxLength={30}
              aria-label="新标签名"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRename();
              }}
            />
            <div className="tm-dialog-row">
              <button
                type="button"
                className="tm-btn"
                onClick={() => setRenameDialog(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="tm-btn tm-btn-primary"
                onClick={() => void handleRename()}
                disabled={
                  !renameDialog ||
                  !renameDialog.newName.trim() ||
                  renameDialog.newName.trim() === renameDialog.tag.name
                }
              >
                确认
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* 颜色选择对话框 */}
      <Dialog.Root
        open={colorDialog !== null}
        onOpenChange={(open) => {
          if (!open) setColorDialog(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="tm-dialog-overlay" />
          <Dialog.Content className="tm-dialog-content">
            <Dialog.Title className="tm-dialog-title">设置标签颜色</Dialog.Title>
            <Dialog.Description style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
              为 "{colorDialog?.tag.name}" 选择颜色（留空清除）
            </Dialog.Description>
            <div className="tm-color-grid">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="tm-color-swatch"
                  data-active={colorDialog?.color === c}
                  style={{ background: c }}
                  onClick={() =>
                    setColorDialog((prev) => (prev ? { ...prev, color: c } : prev))
                  }
                  aria-label={`选择颜色 ${c}`}
                />
              ))}
            </div>
            <input
              type="text"
              className="tm-dialog-input"
              placeholder="#RRGGBB（留空清除）"
              value={colorDialog?.color ?? ''}
              onChange={(e) =>
                setColorDialog((prev) =>
                  prev ? { ...prev, color: e.target.value } : prev,
                )
              }
              maxLength={7}
              aria-label="自定义 hex 颜色"
            />
            <div className="tm-dialog-row">
              <button
                type="button"
                className="tm-btn"
                onClick={() => setColorDialog(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="tm-btn tm-btn-primary"
                onClick={() => void handleSetTagColor()}
              >
                确认
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
