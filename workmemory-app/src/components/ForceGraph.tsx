/**
 * ForceGraph - 自研轻量力导向图引擎组件
 * P2 - 基于 Canvas 的力导向布局，禁止 d3/cytoscape 等重量库。
 * 严格遵循 Task 20 规范：5 类节点不同颜色 + 双击节点穿梭回 Episode。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import type { GraphNode, GraphEdge } from '@/types';

interface ForceGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeDoubleClick?: (node: GraphNode) => void;
}

// 节点类型 → 颜色映射（对应 04_UI_SPEC.md 设计 token）
const NODE_COLORS: Record<string, string> = {
  person: '#2563EB',    // --color-primary
  episode: '#10B981',   // --color-success
  project: '#F59E0B',   // --color-warning
  time: '#0D9488',      // --color-memory
  document: '#8B5CF6',  // --color-private
};

interface SimNode {
  id: string;
  label: string;
  type: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  fixed: boolean;
}

export function ForceGraph({ nodes, edges, onNodeDoubleClick }: ForceGraphProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<{ source: string; target: string; label: string }[]>([]);
  const animRef = useRef<number | null>(null);
  const dragNodeRef = useRef<SimNode | null>(null);
  const hoverNodeRef = useRef<SimNode | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // 同步 props 到模拟状态
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    setSize({ w, h });

    // 保留已有位置（若 id 一致），否则随机初始化
    const prev = new Map(simNodesRef.current.map((n) => [n.id, n]));
    simNodesRef.current = nodes.map((n) => {
      const existing = prev.get(n.id);
      const radius = n.type === 'episode' ? 10 : 8;
      if (existing) {
        return { ...existing, label: n.label, type: n.type, color: NODE_COLORS[n.type] ?? '#6B7280', radius };
      }
      return {
        id: n.id,
        label: n.label,
        type: n.type,
        color: NODE_COLORS[n.type] ?? '#6B7280',
        x: w / 2 + (Math.random() - 0.5) * 200,
        y: h / 2 + (Math.random() - 0.5) * 200,
        vx: 0,
        vy: 0,
        radius,
        fixed: false,
      };
    });
    simEdgesRef.current = edges.map((e) => ({ source: e.source, target: e.target, label: e.label }));
  }, [nodes, edges]);

  // 力导向迭代
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const DPR = window.devicePixelRatio || 1;
    canvas.width = size.w * DPR;
    canvas.height = size.h * DPR;
    ctx.scale(DPR, DPR);

    const tick = () => {
      const ns = simNodesRef.current;
      const es = simEdgesRef.current;
      const cx = size.w / 2;
      const cy = size.h / 2;

      // 库仑斥力（节点间）
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i];
          const b = ns[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) dist = 1;
          const force = 1200 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
          if (!b.fixed) { b.vx += fx; b.vy += fy; }
        }
      }

      // 弹簧引力（边）
      const nodeMap = new Map(ns.map((n) => [n.id, n]));
      for (const e of es) {
        const a = nodeMap.get(e.source);
        const b = nodeMap.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = 90;
        const force = (dist - targetDist) * 0.04;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.fixed) { a.vx += fx; a.vy += fy; }
        if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
      }

      // 中心引力 + 阻尼 + 位置更新
      let totalSpeed = 0;
      for (const n of ns) {
        if (n.fixed) continue;
        n.vx += (cx - n.x) * 0.002;
        n.vy += (cy - n.y) * 0.002;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
        // 边界约束
        n.x = Math.max(n.radius, Math.min(size.w - n.radius, n.x));
        n.y = Math.max(n.radius, Math.min(size.h - n.radius, n.y));
        totalSpeed += Math.abs(n.vx) + Math.abs(n.vy);
      }

      // 渲染
      ctx.clearRect(0, 0, size.w, size.h);

      // 画边
      for (const e of es) {
        const a = nodeMap.get(e.source);
        const b = nodeMap.get(e.target);
        if (!a || !b) continue;
        const highlighted = hoverNodeRef.current && (hoverNodeRef.current.id === a.id || hoverNodeRef.current.id === b.id);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = highlighted ? 'rgba(37,99,235,0.8)' : 'rgba(229,233,240,0.6)';
        ctx.lineWidth = highlighted ? 1.5 : 1;
        ctx.stroke();
      }

      // 画节点
      for (const n of ns) {
        const isHover = hoverNodeRef.current?.id === n.id;
        const r = isHover ? n.radius + 3 : n.radius;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
        if (isHover) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#FFFFFF';
          ctx.stroke();
        }
        // 标签
        ctx.fillStyle = '#1E2330';
        ctx.font = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y + n.radius + 14);
      }

      // 收敛后停止（速度足够小）
      if (totalSpeed < 0.5 && !dragNodeRef.current) {
        animRef.current = null;
        return;
      }
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [size, nodes, edges]);

  // 找最近节点
  const findNode = useCallback((x: number, y: number): SimNode | null => {
    for (const n of simNodesRef.current) {
      const dx = n.x - x;
      const dy = n.y - y;
      if (Math.sqrt(dx * dx + dy * dy) <= n.radius + 4) return n;
    }
    return null;
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const n = findNode(x, y);
    if (n) {
      n.fixed = true;
      dragNodeRef.current = n;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const drag = dragNodeRef.current;
    if (drag) {
      drag.x = x;
      drag.y = y;
      drag.vx = 0;
      drag.vy = 0;
      // 拖拽中保持动画运行
      if (!animRef.current) {
        const tick = () => {
          animRef.current = requestAnimationFrame(tick);
        };
        animRef.current = requestAnimationFrame(tick);
      }
    } else {
      const n = findNode(x, y);
      hoverNodeRef.current = n;
      e.currentTarget.style.cursor = n ? 'pointer' : 'default';
    }
  };

  const handleMouseUp = () => {
    if (dragNodeRef.current) {
      dragNodeRef.current.fixed = false;
      dragNodeRef.current = null;
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const n = findNode(x, y);
    if (n && onNodeDoubleClick) {
      onNodeDoubleClick({
        id: n.id,
        label: n.label,
        type: n.type,
        color: n.color,
      });
    }
  };

  // 重新布局：打乱位置重启
  const relayout = () => {
    for (const n of simNodesRef.current) {
      n.x = size.w / 2 + (Math.random() - 0.5) * 200;
      n.y = size.h / 2 + (Math.random() - 0.5) * 200;
      n.vx = 0;
      n.vy = 0;
      n.fixed = false;
    }
    if (!animRef.current) {
      const tick = () => { animRef.current = requestAnimationFrame(tick); };
      animRef.current = requestAnimationFrame(tick);
    }
  };

  // 暴露 relayout 给父组件（通过 ref 或 props.onReady）— 简化：用 data 属性触发
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        data-relayout-trigger="0"
      />
      <button
        onClick={relayout}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          padding: '4px 10px',
          fontSize: 12,
          background: 'var(--color-surface-glass)',
          backdropFilter: 'var(--blur-acrylic)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          color: 'var(--color-text-main)',
        }}
      >
        重新布局
      </button>
    </div>
  );
}
