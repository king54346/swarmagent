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
type Group = {
  id: UUID;
  name: string | null;
  memberIds: UUID[];
  unreadCount: number;
  contextTokens: number;
  lastMessage?: { content: string; sendTime: string; senderId: UUID };
  updatedAt: string;
  createdAt: string;
};

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

const NODE_WIDTH = 180;
const NODE_HEIGHT = 100;
const LAYER_GAP = 160;
const NODE_GAP = 40;

// 层次布局算法：优先用 parentId 建立层级，回退用 edge 建立
function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): LayoutNode[] {
  if (nodes.length === 0) return [];

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // 判断是否有 parentId 信息
  const hasParentInfo = nodes.some(n => n.parentId && nodeMap.has(n.parentId));

  // 建立父节点映射
  const parentsMap = new Map<string, Set<string>>();
  nodes.forEach(n => parentsMap.set(n.id, new Set()));

  if (hasParentInfo) {
    // 用 parentId 建立层级（树形结构，不会有环）
    nodes.forEach(n => {
      if (n.parentId && nodeMap.has(n.parentId)) {
        parentsMap.get(n.id)!.add(n.parentId);
      }
    });
  } else {
    // 回退：用 edges 建立层级，但只取单向（避免双向通信造成的环）
    // 按消息数量取主要方向：count 多的方向视为 from -> to
    const edgePairs = new Map<string, { forward: number; backward: number }>();
    edges.forEach(e => {
      const key = [e.from, e.to].sort().join(":");
      const entry = edgePairs.get(key) ?? { forward: 0, backward: 0 };
      if (e.from < e.to) entry.forward += e.count;
      else entry.backward += e.count;
      edgePairs.set(key, entry);
    });
    edges.forEach(e => {
      const key = [e.from, e.to].sort().join(":");
      const pair = edgePairs.get(key)!;
      const dominantFrom = e.from < e.to ? pair.forward >= pair.backward : pair.backward > pair.forward;
      if (dominantFrom) {
        parentsMap.get(e.to)!.add(e.from);
      }
    });
  }

  // 用 inStack（当前递归路径）正确检测有向环，layerMap 作为缓存
  const layerMap = new Map<string, number>();

  function getLayer(nodeId: string, inStack: Set<string>): number {
    if (layerMap.has(nodeId)) return layerMap.get(nodeId)!;
    if (inStack.has(nodeId)) return 0; // 断开环，返回 0

    const stack = new Set(inStack);
    stack.add(nodeId);

    const nodeParents = [...(parentsMap.get(nodeId) ?? [])];
    if (nodeParents.length === 0) {
      layerMap.set(nodeId, 0);
      return 0;
    }

    const maxParentLayer = Math.max(...nodeParents.map(p => getLayer(p, stack)));
    const layer = maxParentLayer + 1;
    layerMap.set(nodeId, layer);
    return layer;
  }

  nodes.forEach(n => getLayer(n.id, new Set()));

  // 按层级分组
  const layers: string[][] = [];
  nodes.forEach(n => {
    const layer = layerMap.get(n.id) ?? 0;
    if (!layers[layer]) layers[layer] = [];
    layers[layer].push(n.id);
  });

  // 最大层宽决定画布总宽，每层居中排列
  const maxLayerCount = Math.max(...layers.filter(Boolean).map(l => l.length));
  const totalWidth = maxLayerCount * (NODE_WIDTH + NODE_GAP) - NODE_GAP;

  const layoutNodes: LayoutNode[] = [];

  layers.forEach((layerNodes, layerIndex) => {
    if (!layerNodes) return;
    const layerWidth = layerNodes.length * (NODE_WIDTH + NODE_GAP) - NODE_GAP;
    const startX = Math.round((totalWidth - layerWidth) / 2) + 50;

    layerNodes.forEach((nodeId, nodeIndex) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      layoutNodes.push({
        id: nodeId,
        x: startX + nodeIndex * (NODE_WIDTH + NODE_GAP),
        y: 50 + layerIndex * (NODE_HEIGHT + LAYER_GAP),
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, scale: 1 });

  const workspaceId = workspaceIdParam || session?.workspaceId;

  // 节点 ID -> role 的映射
  const nodeRoleById = useMemo(() => {
    const map = new Map<string, string>();
    nodes.forEach(n => map.set(n.id, n.role));
    return map;
  }, [nodes]);

  // Agent -> Groups 的映射
  const agentGroupsMap = useMemo(() => {
    const map = new Map<string, Group[]>();
    groups.forEach(g => {
      g.memberIds.forEach(memberId => {
        const existing = map.get(memberId) ?? [];
        existing.push(g);
        map.set(memberId, existing);
      });
    });
    return map;
  }, [groups]);

  // 获取选中 Group 的成员 ID 集合
  const selectedGroupMemberIds = useMemo(() => {
    if (!selectedGroup) return new Set<string>();
    const group = groups.find(g => g.id === selectedGroup);
    return new Set(group?.memberIds ?? []);
  }, [selectedGroup, groups]);

  useEffect(() => {
    if (!workspaceId) return;
    void (async () => {
      try {
        // 获取 agent graph
        const q = new URLSearchParams({ workspaceId, limitMessages: "2000" });
        const res = await api<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/agent-graph?${q.toString()}`);
        setNodes(res.nodes);
        setEdges(res.edges);
        
        // 获取 groups
        const groupsRes = await api<{ groups: Group[] }>(`/api/groups?workspaceId=${workspaceId}`);
        setGroups(groupsRes.groups);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [workspaceId]);

  const layoutNodes = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);

  // 每个节点的消息收发统计
  const nodeMsgStats = useMemo(() => {
    const map = new Map<string, { sent: number; received: number }>();
    nodes.forEach(n => map.set(n.id, { sent: 0, received: 0 }));
    edges.forEach(e => {
      const from = map.get(e.from);
      if (from) from.sent += e.count;
      const to = map.get(e.to);
      if (to) to.received += e.count;
    });
    return map;
  }, [nodes, edges]);

  const stats = useMemo(() => {
    const totalMessages = edges.reduce((sum, e) => sum + e.count, 0);
    return { totalAgents: nodes.length, totalConnections: edges.length, totalMessages, totalGroups: groups.length };
  }, [nodes, edges, groups]);

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
            <div style={{ 
              padding: "4px 12px", 
              borderRadius: 6, 
              background: "rgba(251, 191, 36, 0.2)",
              border: "1px solid rgba(251, 191, 36, 0.3)",
              fontSize: 12,
              color: "#fcd34d"
            }}>
              {stats.totalGroups} Groups
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

      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex" }}>
        {/* 左侧 Groups 列表 */}
        <div style={{
          width: 280,
          minWidth: 280,
          maxWidth: 280,
          borderRight: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(15, 23, 42, 0.95)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          flexShrink: 0,
        }}>
          <div style={{
            padding: "16px",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            fontWeight: 600,
            color: "#e2e8f0",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <span>📁</span> Groups ({groups.length})
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "8px" }}>
            {groups.map(group => {
              const isSelected = selectedGroup === group.id;
              const memberRoles = group.memberIds.map(id => nodeRoleById.get(id) || id.slice(0, 8)).join(", ");
              return (
                <div
                  key={group.id}
                  onClick={() => {
                    setSelectedGroup(isSelected ? null : group.id);
                    setSelectedNode(null); // 选择 Group 时取消节点选择
                  }}
                  style={{
                    padding: "12px",
                    marginBottom: 8,
                    borderRadius: 8,
                    background: isSelected ? "rgba(59, 130, 246, 0.2)" : "rgba(30, 41, 59, 0.6)",
                    border: isSelected ? "1px solid rgba(59, 130, 246, 0.5)" : "1px solid rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", marginBottom: 4 }}>
                    {group.name || `Group`}
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6 }}>
                    ID: {group.id.slice(0, 12)}...
                  </div>
                  <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 4 }}>
                    <span style={{ color: "#64748b" }}>成员:</span> {memberRoles}
                  </div>
                  <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
                    <span style={{ color: "#94a3b8" }}>
                      👥 {group.memberIds.length}
                    </span>
                    {group.lastMessage && (
                      <span style={{ color: "#64748b" }}>
                        💬 {new Date(group.lastMessage.sendTime).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {groups.length === 0 && (
              <div style={{ padding: 16, textAlign: "center", color: "#64748b", fontSize: 12 }}>
                No groups yet
              </div>
            )}
          </div>
        </div>

        {/* 右侧 Canvas */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 0 }}>
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
                <stop offset="0%" stopColor="#60a5fa" />
                <stop offset="50%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#c084fc" />
              </linearGradient>
              <linearGradient id="edgeGradientHighlight" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#93c5fd" />
                <stop offset="50%" stopColor="#c4b5fd" />
                <stop offset="100%" stopColor="#e879f9" />
              </linearGradient>
              <filter id="edgeGlow">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
                <path d="M 0 0 L 6 3 L 0 6 L 1.5 3 Z" fill="#c084fc" />
              </marker>
              <marker id="arrowheadHighlight" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
                <path d="M 0 0 L 6 3 L 0 6 L 1.5 3 Z" fill="#e879f9" />
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

                const isHighlighted = selectedNode === edge.from || selectedNode === edge.to ||
                  !!(selectedGroup && selectedGroupMemberIds.has(edge.from) && selectedGroupMemberIds.has(edge.to));

                const isSameLayer = fromNode.y === toNode.y;
                let path: string;
                let labelX: number;
                let labelY: number;

                if (isSameLayer) {
                  // 同层节点：水平弧形连接（从侧边出发，向上拱起）
                  const goingRight = toNode.x > fromNode.x;
                  const fX = goingRight ? fromNode.x + NODE_WIDTH : fromNode.x;
                  const fY = fromNode.y + NODE_HEIGHT / 2;
                  const tX = goingRight ? toNode.x : toNode.x + NODE_WIDTH;
                  const tY = toNode.y + NODE_HEIGHT / 2;
                  const arcH = Math.max(50, Math.abs(tX - fX) * 0.35);
                  const midX = (fX + tX) / 2;
                  const midY = fY - arcH;
                  path = `M ${fX} ${fY} Q ${midX} ${midY}, ${tX} ${tY}`;
                  labelX = midX;
                  labelY = midY - 4;
                } else {
                  // 不同层：从节点底部/顶部垂直连接
                  const goingDown = toNode.y > fromNode.y;
                  const fX = fromNode.x + NODE_WIDTH / 2;
                  const fY = goingDown ? fromNode.y + NODE_HEIGHT : fromNode.y;
                  const tX = toNode.x + NODE_WIDTH / 2;
                  const tY = goingDown ? toNode.y : toNode.y + NODE_HEIGHT;
                  const curvature = Math.abs(tY - fY) * 0.45;
                  const cp1Y = fY + (goingDown ? curvature : -curvature);
                  const cp2Y = tY + (goingDown ? -curvature : curvature);
                  path = `M ${fX} ${fY} C ${fX} ${cp1Y}, ${tX} ${cp2Y}, ${tX} ${tY}`;
                  labelX = (fX + tX) / 2;
                  labelY = (fY + tY) / 2;
                }

                return (
                  <g key={`${edge.from}-${edge.to}`}>
                    <path
                      d={path}
                      stroke={isHighlighted ? "url(#edgeGradientHighlight)" : "url(#edgeGradient)"}
                      strokeWidth={isHighlighted ? 4 : 3}
                      fill="none"
                      strokeLinecap="round"
                      markerEnd={isHighlighted ? "url(#arrowheadHighlight)" : "url(#arrowhead)"}
                      filter={isHighlighted ? "url(#edgeGlow)" : undefined}
                      opacity={isHighlighted ? 1 : 0.85}
                    />
                    {/* 消息数量标签 */}
                    <rect
                      x={labelX - 14}
                      y={labelY - 8}
                      width={28}
                      height={14}
                      rx={4}
                      fill="rgba(15,23,42,0.85)"
                      stroke={isHighlighted ? "rgba(232,121,249,0.5)" : "rgba(192,132,252,0.3)"}
                      strokeWidth={1}
                    />
                    <text
                      x={labelX}
                      y={labelY + 3}
                      fill={isHighlighted ? "#e879f9" : "#a78bfa"}
                      fontSize="9"
                      textAnchor="middle"
                      fontWeight="600"
                    >
                      {edge.count}
                    </text>
                  </g>
                );
              })}
            </g>

            {/* 渲染节点 - 增强版 */}
            <g>
              {layoutNodes.map(node => {
                const config = getRoleConfig(node.role);
                const isSelected = selectedNode === node.id;
                const isInSelectedGroup = selectedGroupMemberIds.has(node.id);
                const isHighlighted = isSelected || isInSelectedGroup;
                const parentRole = node.parentId ? nodeRoleById.get(node.parentId) : null;
                const nodeGroups = agentGroupsMap.get(node.id) ?? [];
                const groupNames = nodeGroups.map(g => g.name || "Group").slice(0, 2);
                const msgStats = nodeMsgStats.get(node.id) ?? { sent: 0, received: 0 };
                
                // 选择高亮颜色
                const highlightColor = isSelected ? "#3b82f6" : isInSelectedGroup ? "#fbbf24" : config.color;
                const fillColor = isSelected ? "rgba(59, 130, 246, 0.2)" : 
                                  isInSelectedGroup ? "rgba(251, 191, 36, 0.15)" : "rgba(30, 41, 59, 0.9)";
                
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    onClick={() => {
                      setSelectedNode(isSelected ? null : node.id);
                      if (!isSelected) setSelectedGroup(null); // 选择节点时取消 group 选择
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      width="180"
                      height="100"
                      rx="12"
                      fill={fillColor}
                      stroke={highlightColor}
                      strokeWidth={isHighlighted ? 3 : 2}
                    />
                    {/* Group 选中标记 */}
                    {isInSelectedGroup && !isSelected && (
                      <circle cx="165" cy="15" r="8" fill="#fbbf24" />
                    )}
                    <circle cx="30" cy="30" r="20" fill={config.bgColor} opacity="0.2" />
                    <text x="30" y="36" fontSize="20" textAnchor="middle">{config.icon}</text>
                    <text x="110" y="28" fill="white" fontSize="13" fontWeight="600" textAnchor="middle">
                      {config.label}
                    </text>
                    <text x="110" y="44" fill="#94a3b8" fontSize="9" textAnchor="middle">
                      {node.id.slice(0, 12)}...
                    </text>
                    {/* 消息统计 */}
                    <text x="110" y="57" fontSize="9" textAnchor="middle">
                      <tspan fill="#60a5fa">↑{msgStats.sent}</tspan>
                      <tspan dx="10" fill="#34d399">↓{msgStats.received}</tspan>
                    </text>
                    {/* Parent 信息 */}
                    <text x="10" y="70" fill="#64748b" fontSize="9">
                      Parent: <tspan fill="#a5b4fc">{parentRole || "—"}</tspan>
                    </text>
                    {/* Groups 信息 */}
                    <text x="10" y="83" fill="#64748b" fontSize="9">
                      Groups: <tspan fill="#86efac">{nodeGroups.length > 0 ? `${nodeGroups.length} (${groupNames.join(", ")})` : "—"}</tspan>
                    </text>
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
    </div>
  );
}
