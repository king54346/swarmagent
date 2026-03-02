import { useState, useCallback, useMemo } from "react";
import { X, Save, Settings, Trash2 } from "lucide-react";

type UUID = string;

type GraphNode = {
  id: UUID;
  role: string;
  parentId: UUID | null;
};

type LayoutNode = {
  id: string;
  x: number;
  y: number;
  role: string;
  parentId: string | null;
};

type AgentConfig = {
  role: string;
  guidance?: string;
  llmHistory?: string;
};

const ROLE_CONFIG: Record<string, { icon: string; color: string; bgColor: string; label: string; description: string }> = {
  human: {
    icon: "👤",
    color: "#1e40af",
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
    icon: "👨‍💻",
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
    icon: "💼",
    color: "#ca8a04",
    bgColor: "#fef3c7",
    label: "CEO",
    description: "Executive leadership"
  },
};

function getRoleConfig(role: string) {
  return ROLE_CONFIG[role.toLowerCase()] ?? {
    icon: "⚡",
    color: "#6b7280",
    bgColor: "#f3f4f6",
    label: role,
    description: "Custom agent role"
  };
}

interface WorkflowEditorProps {
  nodes: GraphNode[];
  layoutNodes: LayoutNode[];
  onNodeSelect: (nodeId: string | null) => void;
  selectedNode: string | null;
  onUpdateNode?: (nodeId: string, config: Partial<AgentConfig>) => Promise<void>;
  onDeleteNode?: (nodeId: string) => Promise<void>;
}

export function WorkflowEditor({
  nodes,
  layoutNodes,
  onNodeSelect,
  selectedNode,
  onUpdateNode,
  onDeleteNode,
}: WorkflowEditorProps) {
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<AgentConfig>({ role: "", guidance: "" });
  const [saving, setSaving] = useState(false);

  const selectedNodeData = useMemo(() => {
    if (!selectedNode) return null;
    const layoutNode = layoutNodes.find(n => n.id === selectedNode);
    const graphNode = nodes.find(n => n.id === selectedNode);
    if (!layoutNode || !graphNode) return null;
    return { ...layoutNode, ...graphNode };
  }, [selectedNode, layoutNodes, nodes]);

  const handleEditNode = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    setEditingNode(nodeId);
    setEditConfig({
      role: node.role,
      guidance: "",
    });
  }, [nodes]);

  const handleSaveNode = useCallback(async () => {
    if (!editingNode || !onUpdateNode) return;

    setSaving(true);
    try {
      await onUpdateNode(editingNode, editConfig);
      setEditingNode(null);
    } catch (error) {
      console.error("Failed to save node:", error);
      alert("保存失败: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  }, [editingNode, editConfig, onUpdateNode]);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (!onDeleteNode) return;
    if (!confirm("确定要删除这个 Agent 吗？")) return;

    try {
      await onDeleteNode(nodeId);
      setEditingNode(null);
      onNodeSelect(null);
    } catch (error) {
      console.error("Failed to delete node:", error);
      alert("删除失败: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [onDeleteNode, onNodeSelect]);

  return (
    <>
      {selectedNodeData && (
        <div style={{
          position: "absolute",
          right: 24,
          top: 24,
          width: 360,
          maxHeight: "calc(100vh - 120px)",
          background: "rgba(15, 23, 42, 0.98)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(100, 150, 255, 0.3)",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}>
          <div style={{
            padding: 16,
            borderBottom: "1px solid rgba(100, 150, 255, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(to bottom, rgba(59, 130, 246, 0.1), transparent)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                background: getRoleConfig(selectedNodeData.role).bgColor + "22",
                border: `2px solid ${getRoleConfig(selectedNodeData.role).color}44`,
              }}>
                {getRoleConfig(selectedNodeData.role).icon}
              </div>
              <div>
                <div style={{ color: "white", fontWeight: 600, fontSize: 16 }}>
                  {getRoleConfig(selectedNodeData.role).label}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>
                  {selectedNodeData.role}
                </div>
              </div>
            </div>
            <button
              onClick={() => onNodeSelect(null)}
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: 8,
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "#94a3b8",
              }}
            >
              <X size={18} />
            </button>
          </div>

          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: 16,
          }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#64748b", fontSize: 11, marginBottom: 6, fontWeight: 600 }}>
                NODE ID
              </div>
              <div style={{
                padding: 10,
                borderRadius: 8,
                background: "rgba(0, 0, 0, 0.3)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                fontFamily: "monospace",
                fontSize: 11,
                color: "#94a3b8",
                wordBreak: "break-all",
              }}>
                {selectedNodeData.id}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#64748b", fontSize: 11, marginBottom: 6, fontWeight: 600 }}>
                DESCRIPTION
              </div>
              <div style={{
                padding: 10,
                borderRadius: 8,
                background: "rgba(0, 0, 0, 0.3)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                fontSize: 13,
                color: "#cbd5e1",
                lineHeight: 1.6,
              }}>
                {getRoleConfig(selectedNodeData.role).description}
              </div>
            </div>

            {selectedNodeData.parentId && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: "#64748b", fontSize: 11, marginBottom: 6, fontWeight: 600 }}>
                  PARENT AGENT
                </div>
                <div style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(168, 85, 247, 0.1)",
                  border: "1px solid rgba(168, 85, 247, 0.2)",
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "#d8b4fe",
                }}>
                  {nodes.find(n => n.id === selectedNodeData.parentId)?.role ?? "Unknown"}
                </div>
              </div>
            )}

            {editingNode === selectedNode ? (
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: "#64748b", fontSize: 11, marginBottom: 6, fontWeight: 600 }}>
                  GUIDANCE / SYSTEM PROMPT
                </div>
                <textarea
                  value={editConfig.guidance}
                  onChange={(e) => setEditConfig({ ...editConfig, guidance: e.target.value })}
                  placeholder="添加自定义指导语或系统提示词..."
                  style={{
                    width: "100%",
                    minHeight: 120,
                    padding: 10,
                    borderRadius: 8,
                    background: "rgba(0, 0, 0, 0.4)",
                    border: "1px solid rgba(100, 150, 255, 0.3)",
                    color: "#e4e4e7",
                    fontSize: 13,
                    fontFamily: "monospace",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
              </div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: "#64748b", fontSize: 11, marginBottom: 6, fontWeight: 600 }}>
                  ACTIONS
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button
                    onClick={() => selectedNode && handleEditNode(selectedNode)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: "rgba(59, 130, 246, 0.15)",
                      border: "1px solid rgba(59, 130, 246, 0.3)",
                      color: "#60a5fa",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                    }}
                  >
                    <Settings size={16} />
                    Edit Configuration
                  </button>

                  {selectedNodeData.role !== "human" && selectedNodeData.role !== "assistant" && (
                    <button
                      onClick={() => selectedNode && handleDeleteNode(selectedNode)}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 8,
                        background: "rgba(239, 68, 68, 0.15)",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        color: "#f87171",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        transition: "all 0.2s",
                      }}
                    >
                      <Trash2 size={16} />
                      Delete Agent
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {editingNode === selectedNode && (
            <div style={{
              padding: 16,
              borderTop: "1px solid rgba(100, 150, 255, 0.2)",
              display: "flex",
              gap: 8,
              background: "rgba(0, 0, 0, 0.2)",
            }}>
              <button
                onClick={handleSaveNode}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: 8,
                  background: saving ? "rgba(34, 197, 94, 0.3)" : "rgba(34, 197, 94, 0.15)",
                  border: "1px solid rgba(34, 197, 94, 0.3)",
                  color: saving ? "#86efac" : "#4ade80",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <Save size={16} />
                {saving ? "Saving..." : "Save Changes"}
              </button>
              <button
                onClick={() => setEditingNode(null)}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: 8,
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#94a3b8",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
