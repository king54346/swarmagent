import { useState } from "react";
import { API_BASE } from "../api/client";

interface DeleteWorkspaceButtonProps {
  workspaceId: string;
  workspaceName: string;
  onDeleted?: () => void;
}

export function DeleteWorkspaceButton({
  workspaceId,
  workspaceName,
  onDeleted,
}: DeleteWorkspaceButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!window.confirm(`确定要删除 Workspace "${workspaceName}" 吗？\n\n这将删除所有 Agents、群组和消息。`)) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "删除失败");
      }

      onDeleted?.();
    } catch (error) {
      alert(error instanceof Error ? error.message : "删除失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      className="btn"
      onClick={handleDelete}
      disabled={loading}
      style={{
        padding: "4px 8px",
        fontSize: 12,
        background: "rgba(239, 68, 68, 0.1)",
        borderColor: "rgba(239, 68, 68, 0.4)",
        color: "#ef4444",
      }}
      title="删除 Workspace"
    >
      {loading ? "删除中..." : "删除"}
    </button>
  );
}
