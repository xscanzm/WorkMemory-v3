/**
 * GraphView - 记忆关系图谱视图 (P2)
 * 严格遵循 07_ROADMAP.md Checkpoint 3：
 * - 5 类节点（人/事/项目/时间/文档）不同颜色
 * - 基于 SQLite 外键 + [[wikilink]] 关联计算边
 * - 双击节点穿梭回 Episode 详情
 * 禁止 d3/cytoscape，用自研 ForceGraph Canvas 引擎。
 */
import { useEffect, useState, useMemo } from 'react';
import { ForceGraph } from '@/components/ForceGraph';
import { api } from '@/src-tauri/api';
import type { GraphNode, GraphEdge, GraphData, CleanEpisode } from '@/types';
import { Share2, RefreshCw } from 'lucide-react';

const NODE_TYPE_LABELS: Record<string, string> = {
  person: '人',
  episode: '事',
  project: '项目',
  time: '时间',
  document: '文档',
};

const NODE_TYPE_COLORS: Record<string, string> = {
  person: 'var(--color-primary)',
  episode: 'var(--color-success)',
  project: 'var(--color-warning)',
  time: 'var(--color-memory)',
  document: 'var(--color-private)',
};

export default function GraphView(): JSX.Element {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<CleanEpisode | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(
    new Set(['person', 'episode', 'project', 'time', 'document'])
  );
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getGraphData()
      .then((data: GraphData) => {
        if (!cancelled) {
          setGraphData(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('加载图谱数据失败', err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const filteredNodes = useMemo<GraphNode[]>(() => {
    if (!graphData) return [];
    return graphData.nodes.filter((n) => typeFilter.has(n.type));
  }, [graphData, typeFilter]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const filteredEdges = useMemo<GraphEdge[]>(() => {
    if (!graphData) return [];
    return graphData.edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    );
  }, [graphData, filteredNodeIds]);

  // 双击节点穿梭回 Episode 详情
  const handleNodeDoubleClick = async (node: GraphNode) => {
    setSelectedNode(node);
    setSelectedEpisode(null);
    if (node.type === 'episode') {
      // 反查对应 Episode：node.id 通常为 episode_id
      try {
        // 简单实现：从今日 episodes 反查（实际生产可加 getEpisodeById IPC）
        const today = new Date().toISOString().slice(0, 10);
        const episodes = await api.getEpisodesByDate(today);
        const found = episodes.find((ep) => ep.id === node.id || ep.title === node.label);
        if (found) setSelectedEpisode(found);
      } catch (err) {
        console.warn('反查 Episode 失败', err);
      }
    }
  };

  const toggleType = (t: string) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="skeleton"
            style={{ height: 80, borderRadius: 'var(--radius-md)' }}
          />
        ))}
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 'var(--space-md)',
          color: 'var(--color-text-light)',
        }}
      >
        <Share2 size={40} strokeWidth={1.5} />
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-muted)' }}>
          还没有足够的数据生成图谱
        </div>
        <div style={{ fontSize: 12, maxWidth: 320, textAlign: 'center', lineHeight: 1.6 }}>
          多记录几天工作，小记会自动建立人、事、项目、时间的连接，在这里形成你的认知资产网络。
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      {/* 顶部工具栏：图例 + 类型过滤 + 刷新 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-lg)',
          padding: 'var(--space-md) var(--space-lg)',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface-glass)',
          backdropFilter: 'var(--blur-acrylic)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', fontSize: 12 }}>
          {Object.entries(NODE_TYPE_LABELS).map(([type, label]) => {
            const active = typeFilter.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-round)',
                  background: active ? 'var(--color-surface)' : 'transparent',
                  opacity: active ? 1 : 0.4,
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--color-text-main)',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: NODE_TYPE_COLORS[type],
                    display: 'inline-block',
                  }}
                />
                {label}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--color-text-main)',
          }}
        >
          <RefreshCw size={12} /> 刷新
        </button>
      </div>

      {/* 主体：图谱 + 右侧详情 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <ForceGraph
            nodes={filteredNodes}
            edges={filteredEdges}
            onNodeDoubleClick={handleNodeDoubleClick}
          />
        </div>

        {/* 右侧节点详情面板 */}
        <div
          style={{
            width: 280,
            borderLeft: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            padding: 'var(--space-lg)',
            overflowY: 'auto',
            flexShrink: 0,
          }}
        >
          {selectedNode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: NODE_TYPE_COLORS[selectedNode.type] ?? 'var(--color-text-muted)',
                  }}
                />
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {NODE_TYPE_LABELS[selectedNode.type] ?? selectedNode.type}
                </span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-main)' }}>
                {selectedNode.label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-light)' }}>
                ID: {selectedNode.id}
              </div>

              {/* 关联节点列表 */}
              <div style={{ marginTop: 'var(--space-md)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 'var(--space-sm)' }}>
                  关联节点
                </div>
                {filteredEdges
                  .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
                  .map((e, i) => {
                    const otherId = e.source === selectedNode.id ? e.target : e.source;
                    const other = filteredNodes.find((n) => n.id === otherId);
                    if (!other) return null;
                    return (
                      <div
                        key={i}
                        onClick={() => handleNodeDoubleClick(other)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-sm)',
                          padding: '6px 8px',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          fontSize: 12,
                          color: 'var(--color-text-main)',
                        }}
                        onMouseEnter={(ev) => (ev.currentTarget.style.background = 'var(--color-surface-subtle)')}
                        onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: NODE_TYPE_COLORS[other.type] ?? 'var(--color-text-muted)',
                          }}
                        />
                        {other.label}
                      </div>
                    );
                  })}
              </div>

              {/* Episode 详情（若是 episode 节点） */}
              {selectedEpisode && (
                <div
                  style={{
                    marginTop: 'var(--space-md)',
                    padding: 'var(--space-md)',
                    background: 'var(--color-surface-subtle)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{selectedEpisode.title}</div>
                  <div style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                    {selectedEpisode.summary}
                  </div>
                  <div style={{ marginTop: 6, color: 'var(--color-text-light)' }}>
                    {selectedEpisode.startTime} - {selectedEpisode.endTime}
                    {selectedEpisode.project ? ` · ${selectedEpisode.project}` : ''}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-text-light)',
                lineHeight: 1.6,
                textAlign: 'center',
                marginTop: 'var(--space-xl)',
              }}
            >
              双击图谱中的节点查看详情。
              <br />
              事件节点双击可穿梭回 Episode。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
