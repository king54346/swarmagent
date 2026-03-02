import { motion } from "framer-motion";
import {
  Briefcase,
  Code2,
  Palette,
  FlaskConical,
  BarChart3,
  Crown,
  Bot,
  UserCircle,
  Network,
} from "lucide-react";

export interface AgentNode {
  id: string;
  role: string;
  parentId: string | null;
  createdAt: number;
}

interface AgentNodeCardProps {
  agent: AgentNode;
  position: { x: number; y: number };
  status: "IDLE" | "BUSY" | "ERROR" | "DONE";
  isActive?: boolean;
  isExpanded?: boolean;
  onDoubleClick?: () => void;
  onDelete?: () => void;
  onEditPrompt?: () => void;
  onViewHistory?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
}

const statusColorMap: Record<string, string> = {
  IDLE: "#6b7280",
  BUSY: "#ef4444",
  ERROR: "#dc2626",
  DONE: "#22c55e",
};

const statusColor = (status: string): string => statusColorMap[status] ?? "#6b7280";

export function AgentNodeCard({
  agent,
  position,
  status,
  isActive = false,
  isExpanded = false,
  onDoubleClick,
  onDelete,
  onEditPrompt,
  onViewHistory,
  onPointerDown,
  onMouseDown,
  onTouchStart,
}: AgentNodeCardProps) {
  const ring = statusColor(status);

  const Icon =
    agent.role === "productmanager"
      ? Briefcase
      : agent.role === "coder"
        ? Code2
        : agent.role === "designer"
          ? Palette
          : agent.role === "tester"
            ? FlaskConical
            : agent.role === "analyst"
              ? BarChart3
              : agent.role === "ceo"
                ? Crown
                : agent.role === "assistant"
                  ? Bot
                  : agent.role === "human"
                    ? UserCircle
                    : Network;

  const cardWidth = isExpanded ? 340 : 200;
  const cardHeight = isExpanded ? 480 : 100;

  return (
    <motion.div
      key={agent.id}
      initial={{ scale: 0, opacity: 0, x: position.x, y: position.y }}
      animate={{
        scale: 1,
        opacity: 1,
        x: position.x,
        y: position.y,
        width: cardWidth,
        height: cardHeight,
      }}
      transition={{ type: "spring", stiffness: 220, damping: 18 }}
      className="viz-node"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        marginLeft: -cardWidth / 2,
        marginTop: -cardHeight / 2,
        cursor: "pointer",
      }}
      title={agent.id}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown?.(e);
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown?.(e);
      }}
      onTouchStart={(e) => {
        e.stopPropagation();
        onTouchStart?.(e);
      }}
    >
      {isActive && (
        <div className="viz-reticle">
          <div className="viz-reticle-pulse" />
        </div>
      )}

      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 16,
          border: `1px solid ${ring}55`,
          display: "flex",
          flexDirection: "column",
          background: "rgba(15, 23, 42, 0.7)",
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)`,
          position: "relative",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "50%",
            background: "radial-gradient(ellipse at top, rgba(59, 130, 246, 0.08) 0%, transparent 60%)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "absolute",
            top: 0,
            left: "10%",
            right: "10%",
            height: 1,
            background: "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "absolute",
            bottom: -6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(99, 179, 237, 0.9) 0%, rgba(139, 92, 246, 0.9) 100%)",
            border: "2px solid rgba(15, 23, 42, 0.95)",
            boxShadow: "0 0 12px rgba(99, 179, 237, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
            zIndex: 10,
          }}
        />

        <div
          style={{
            position: "absolute",
            top: -6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(168, 85, 247, 0.9) 0%, rgba(217, 70, 239, 0.9) 100%)",
            border: "2px solid rgba(15, 23, 42, 0.95)",
            boxShadow: "0 0 12px rgba(168, 85, 247, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.3)",
            zIndex: 10,
          }}
        />

        <div
          style={{
            padding: isExpanded ? "10px 14px" : "8px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderBottom: isExpanded ? "1px solid rgba(99, 179, 237, 0.15)" : "none",
            background: "linear-gradient(90deg, rgba(99, 179, 237, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%)",
            position: "relative",
            zIndex: 1,
            minHeight: 0,
          }}
        >
          <Icon size={isExpanded ? 22 : 18} color={ring} strokeWidth={2.5} />
          <div
            style={{
              flex: 1,
              fontSize: isExpanded ? 14 : 12,
              fontWeight: 700,
              color: "#f1f5f9",
              letterSpacing: "0.02em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agent.role}
          </div>

          {!isExpanded && (
            <div
              style={{
                fontSize: 8,
                fontWeight: 700,
                color: ring,
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(0, 0, 0, 0.4)",
                border: `1px solid ${ring}33`,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {status}
            </div>
          )}

          {isExpanded && (
            <>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: ring,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: "rgba(0, 0, 0, 0.4)",
                  border: `1px solid ${ring}33`,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {status}
              </div>
              {status === "BUSY" && (
                <motion.div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: "2.5px solid #ef4444",
                    borderTopColor: "transparent",
                  }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                />
              )}
            </>
          )}
        </div>

        {!isExpanded ? (
          <div
            style={{
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flex: 1,
              justifyContent: "center",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "#cbd5e1",
                fontFamily: "monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {agent.id.slice(0, 12)}...
            </div>
            <div
              style={{
                fontSize: 9,
                color: "#94a3b8",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {new Date(agent.createdAt).toLocaleTimeString()}
            </div>
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "14px",
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(99, 179, 237, 0.3) rgba(0, 0, 0, 0.2)",
            }}
          >
            <div style={{ marginBottom: 14 }}>
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <tbody>
                  <tr style={{ borderBottom: "1px solid rgba(99, 179, 237, 0.1)" }}>
                    <td style={{ padding: "8px 10px", color: "#94a3b8", fontWeight: 600, width: "35%" }}>
                      ID
                    </td>
                    <td
                      style={{
                        padding: "8px 10px",
                        color: "#e2e8f0",
                        fontFamily: "monospace",
                        fontSize: 10,
                      }}
                    >
                      {agent.id.slice(0, 8)}...
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid rgba(99, 179, 237, 0.1)" }}>
                    <td style={{ padding: "8px 10px", color: "#94a3b8", fontWeight: 600 }}>Parent</td>
                    <td
                      style={{
                        padding: "8px 10px",
                        color: "#e2e8f0",
                        fontFamily: "monospace",
                        fontSize: 10,
                      }}
                    >
                      {agent.parentId ? `${agent.parentId.slice(0, 8)}...` : "—"}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid rgba(99, 179, 237, 0.1)" }}>
                    <td style={{ padding: "8px 10px", color: "#94a3b8", fontWeight: 600 }}>Status</td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ color: ring, fontWeight: 700, fontSize: 10 }}>{status}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 10px", color: "#94a3b8", fontWeight: 600 }}>Created</td>
                    <td style={{ padding: "8px 10px", color: "#e2e8f0", fontSize: 10 }}>
                      {new Date(agent.createdAt).toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewHistory?.();
                }}
                style={{
                  padding: "10px 14px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#e0f2fe",
                  background: "rgba(59, 130, 246, 0.15)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
                  letterSpacing: "0.03em",
                }}
              >
                View History
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditPrompt?.();
                }}
                style={{
                  padding: "10px 14px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#f3e8ff",
                  background: "rgba(147, 51, 234, 0.15)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  border: "1px solid rgba(147, 51, 234, 0.3)",
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
                  letterSpacing: "0.03em",
                }}
              >
                Edit Prompt
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`确定要删除 ${agent.role} 吗？`)) {
                    onDelete?.();
                  }
                }}
                style={{
                  padding: "10px 14px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#fecaca",
                  background: "rgba(239, 68, 68, 0.15)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
                  letterSpacing: "0.03em",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
