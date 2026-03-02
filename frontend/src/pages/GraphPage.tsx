import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState, useCallback } from "react";
import { WorkflowEditor } from "../components/WorkflowEditor";
import { API_BASE } from "../api/client";

type UUID = string;

type WorkspaceDefaults = {
  workspaceId: UUID;
  humanAgentId: UUID;
  assistantAgentId: UUID;
  defaultGroupId: UUID;
};

type GraphNode = { id: UUID; role: string; parentId: UUID | null };
type GraphEdge = { from: UUID; to: UUID; count: number; lastSendTime: string };

const SESSION_KEY = "agent-wechat.session.v1";

function loadSession(): WorkspaceDefaults | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkspaceDefaults;
  } catch {
    return null;
  }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

// 角色图标配置
const ROLE_CONFIG: Record<string, { icon: string; color: string; bgColor: string; label: string; description: string }> = {
  human: { 
    icon: "👤", 
    color: "#2563eb", 
    bgColor: "#dbeafe", 
    label: "Human",
    description: "Human user in the system"
  },
  assistant: { 
    icon: "🤖", 
    color: "#7c3aed", 
    bgColor: "#ede9fe", 
    label: "Assistant",
    description: "Main assistant agent"
  },
  coder: { 
    icon: "💻", 
    color: "#059669", 
    bgColor: "#d1fae5", 
    label: "Coder",
    description: "Software engineer for coding tasks"
  },
  productmanager: { 
    icon: "📋", 
    color: "#dc2626", 
    bgColor: "#fee2e2", 
    label: "Product Manager",
    description: "Product strategy and requirements"
  },
  designer: { 
    icon: "🎨", 
    color: "#ea580c", 
    bgColor: "#ffedd5", 
    label: "Designer",
    description: "UI/UX design and visual creativity"
  },
  tester: { 
    icon: "🧪", 
    color: "#0891b2", 
    bgColor: "#cffafe", 
    label: "Tester",
    description: "Quality assurance and testing"
  },
  analyst: { 
    icon: "📊", 
    color: "#c026d3", 
    bgColor: "#fae8ff", 
    label: "Analyst",
    description: "Data analysis and insights"
  },
  ceo: { 
    icon: "👔", 
    color: "#ca8a04", 
    bgColor: "#fef3c7", 
    label: "CEO",
    description: "Executive leadership"
  },
};

function getRoleConfig(role: string) {
  return ROLE_CONFIG[role.toLowerCase()] ?? { icon: "⚡", color: "#6b7280", bgColor: "#f3f4f6", label: role };
}

type LayoutNode = {
  id: string;
  x: number;
  y: number;
  role: string;
  parentId: string | null;
};

// 简单的层次布局算法
function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): LayoutNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const children = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  
  nodes.forEach(n => {
    children.set(n.id, []);
    inDegree.set(n.id, 0);
  });
  
  edges.forEach(e => {
    const existing = children.get(e.from) ?? [];
    if (!existing.includes(e.to)) {
      existing.push(e.to);
      children.set(e.from, existing);
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
  });
  
  const layers: string[][] = [];
  const queue: string[] = [];
  const layerMap = new Map<string, number>();
  
  nodes.forEach(n => {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      queue.push(n.id);
      layerMap.set(n.id, 0);
    }
  });
  
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const layer = layerMap.get(nodeId) ?? 0;
    
    if (!layers[layer]) layers[layer] = [];
    layers[layer]!.push(nodeId);
    
    const nodeChildren = children.get(nodeId) ?? [];
    nodeChildren.forEach(childId => {
      const currentLayer = layerMap.get(childId) ?? 0;
      const newLayer = layer + 1;
      if (newLayer > currentLayer) {
        layerMap.set(childId, newLayer);
      }
      queue.push(childId);
    });
  }
  
  const NODE_WIDTH = 180;
  const NODE_HEIGHT = 80;
  const LAYER_GAP = 200;
  const NODE_GAP = 120;
  
  const layoutNodes: LayoutNode[] = [];
  
  layers.forEach((layerNodes, layerIndex) => {
    const layerWidth = layerNodes.length * (NODE_WIDTH + NODE_GAP) - NODE_GAP;
    const startX = -layerWidth / 2;
    
    layerNodes.forEach((nodeId, nodeIndex) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;
      
      layoutNodes.push({
        id: nodeId,
        x: startX + nodeIndex * (NODE_WIDTH + NODE_GAP),
        y: layerIndex * LAYER_GAP,
        role: node.role,
        parentId: node.parentId,
      });
    });
  });
  
  return layoutNodes;
}

export default function GraphPage() {
  const [searchParams] = useSearchParams();
  const workspaceIdParam = searchParams.get("workspaceId");
  const [session] = useState<WorkspaceDefaults | null>(() => loadSession());
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, scale: 1 });

  const workspaceId = workspaceIdParam || session?.workspaceId;

  useEffect(() => {
    if (!workspaceId) return;
    void (async () => {
      try {
        const q = new URLSearchParams({ workspaceId, limitMessages: "2000" });
        const res = await api<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/agent-graph?${q.toString()}`);
        setNodes(res.nodes);
        setEdges(res.edges);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [workspaceId]);

  const layoutNodes = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);
  
  const edgesByNode = useMemo(() => {
    const outgoing = new Map<string, GraphEdge[]>();
    const incoming = new Map<string, GraphEdge[]>();
    
    edges.forEach(e => {
      const out = outgoing.get(e.from) ?? [];
      out.push(e);
      outgoing.set(e.from, out);
      
      const inc = incoming.get(e.to) ?? [];
      inc.push(e);
      incoming.set(e.to, inc);
    });
    
    return { outgoing, incoming };
  }, [edges]);

  const stats = useMemo(() => {
    const totalMessages = edges.reduce((sum, e) => sum + e.count, 0);
    return { totalAgents: nodes.length, totalConnections: edges.length, totalMessages };
  }, [nodes, edges]);

  const handleZoomIn = useCallback(() => {
    setViewBox(prev => ({ ...prev, scale: Math.min(prev.scale * 1.2, 3) }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewBox(prev => ({ ...prev, scale: Math.max(prev.scale / 1.2, 0.3) }));
  }, []);

  const handleResetView = useCallback(() => {
    setViewBox({ x: 0, y: 0, scale: 1 });
  }, []);

  const handleUpdateNode = useCallback(async (nodeId: string, config: { role?: string; guidance?: string }) => {
    if (!workspaceId) return;
    
    try {
      await api(`/api/agents/${nodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      
      const q = new URLSearchParams({ workspaceId, limitMessages: "2000" });
      const res = await api<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/agent-graph?${q.toString()}`);
      setNodes(res.nodes);
      setEdges(res.edges);
    } catch (error) {
      throw new Error(`更新失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [workspaceId]);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (!workspaceId) return;
    
    try {
      await api(`/api/agents/${nodeId}`, { method: "DELETE" });
      
      const q = new URLSearchParams({ workspaceId, limitMessages: "2000" });
      const res = await api<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/agent-graph?${q.toString()}`);
      setNodes(res.nodes);
      setEdges(res.edges);
    } catch (error) {
      throw new Error(`删除失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [workspaceId]);

  if (!workspaceId) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Agent Workflow</h1>
        <p className="muted">No session yet. Open IM first.</p>
        <Link className="btn btn-primary" to="/im">
          Open IM
        </Link>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0f172a" }}>
      {/* 顶部工具栏 */}
      <div style={{ 
        padding: "16px 24px", 
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(15, 23, 42, 0.95)",
        backdropFilter: "blur(10px)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "white" }}>
            🔀 Agent Workflow
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ 
              padding: "4px 12px", 
              borderRadius: 6, 
              background: "rgba(59, 130, 246, 0.2)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              fontSize: 12,
              color: "#93c5fd"
            }}>
              {stats.totalAgents} Agents
            </div>
            <div style={{ 
              padding: "4px 12px", 
              borderRadius: 6, 
              background: "rgba(168, 85, 247, 0.2)",
              border: "1px solid rgba(168, 85, 247, 0.3)",
              fontSize: 12,
              color: "#d8b4fe"
            }}>
              {stats.totalConnections} Connections
            </div>
            <div style={{ 
              padding: "4px 12px", 
              borderRadius: 6, 
              background: "rgba(34, 197, 94, 0.2)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              fontSize: 12,
              color: "#86efac"
            }}>
              {stats.totalMessages} Messages
            </div>
          </div>
        </div>
        
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={handleZoomOut} className="btn" style={{ padding: "6px 12px" }}>-</button>
          <span style={{ color: "#94a3b8", fontSize: 12, minWidth: 50, textAlign: "center" }}>
            {Math.round(viewBox.scale * 100)}%
          </span>
          <button onClick={handleZoomIn} className="btn" style={{ padding: "6px 12px" }}>+</button>
          <button onClick={handleResetView} className="btn" style={{ padding: "6px 12px", fontSize: 12 }}>Reset</button>
          <Link className="btn" to="/im" style={{ padding: "6px 16px", fontSize: 14 }}>
            ← Back to IM
          </Link>
        </div>
      </div>

      {error && (
        <div className="toast" style={{ margin: "16px 24px" }}>{error}</div>
      )}

      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Canvas */}
        <svg
          style={{ 
            width: "100%", 
            height: "100%",
            background: "linear-gradient(to bottom, #0f172a, #1e293b)"
          }}
          viewBox={`${viewBox.x} ${viewBox.y} ${1600 / viewBox.scale} ${900 / viewBox.scale}`}
        >
          <defs>
            <linearGradient id="edgeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(59, 130, 246, 0.6)" />
              <stop offset="50%" stopColor="rgba(147, 51, 234, 0.5)" />
              <stop offset="100%" stopColor="rgba(168, 85, 247, 0.6)" />
            </linearGradient>
            <filter id="edgeGlow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            <marker id="arrowhead" markerWidth="12" markerHeight="12" refX="11" refY="4" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 L 2 4 Z" fill="url(#edgeGradient)" />
            </marker>
          </defs>

          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
          </pattern>
          <rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#grid)" />

          {/* 渲染边 */}
          <g>
            {edges.map(edge => {
              const fromNode = layoutNodes.find(n => n.id === edge.from);
              const toNode = layoutNodes.find(n => n.id === edge.to);
              if (!fromNode || !toNode) return null;

              const isHighlighted = selectedNode === edge.from || selectedNode === edge.to;
              const fromX = fromNode.x + 90;
              const fromY = fromNode.y + 80;
              const toX = toNode.x + 90;
              const toY = toNode.y;
              
              const dy = toY - fromY;
              const curvature = Math.abs(dy) * 0.5;
              const path = `M ${fromX} ${fromY} C ${fromX} ${fromY + curvature}, ${toX} ${toY - curvature}, ${toX} ${toY}`;

              return (
                <g key={`${edge.from}-${edge.to}`}>
                  <path
                    d={path}
                    stroke="url(#edgeGradient)"
                    strokeWidth={isHighlighted ? 3 : 2.5}
                    fill="none"
                    strokeLinecap="round"
                    markerEnd="url(#arrowhead)"
                    filter={isHighlighted ? "url(#edgeGlow)" : undefined}
                    opacity={isHighlighted ? 1 : 0.7}
                  />
                </g>
              );
            })}
          </g>

          {/* 渲染节点 */}
          <g>
            {layoutNodes.map(node => {
              const config = getRoleConfig(node.role);
              const isSelected = selectedNode === node.id;
              
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => setSelectedNode(isSelected ? null : node.id)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    width="180"
                    height="80"
                    rx="12"
                    fill={isSelected ? "rgba(59, 130, 246, 0.2)" : "rgba(30, 41, 59, 0.9)"}
                    stroke={isSelected ? "#3b82f6" : config.color}
                    strokeWidth={isSelected ? 3 : 2}
                  />
                  <circle cx="40" cy="40" r="24" fill={config.bgColor} opacity="0.2" />
                  <text x="40" y="48" fontSize="24" textAnchor="middle">{config.icon}</text>
                  <text x="90" y="35" fill="white" fontSize="14" fontWeight="600" textAnchor="middle">
                    {config.label}
                  </text>
                  <text x="90" y="52" fill="#94a3b8" fontSize="10" textAnchor="middle">{node.role}</text>
                </g>
              );
            })}
          </g>
        </svg>

        <WorkflowEditor
          nodes={nodes}
          layoutNodes={layoutNodes}
          onNodeSelect={setSelectedNode}
          selectedNode={selectedNode}
          onUpdateNode={handleUpdateNode}
          onDeleteNode={handleDeleteNode}
        />

        {nodes.length === 0 && (
          <div style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            color: "#64748b"
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
            <div style={{ fontSize: 16, marginBottom: 8 }}>No agents yet</div>
            <div style={{ fontSize: 14 }}>Send some messages in IM to see the workflow</div>
          </div>
        )}
      </div>
    </div>
  );
}
