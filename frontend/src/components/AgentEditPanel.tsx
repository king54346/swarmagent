type AgentMetaSummary = {
  id: string;
  role: string;
  parentId: string | null;
};

type AgentEditPanelProps = {
  agent: AgentMetaSummary;
  parentRoleLabel?: string | null;
  isEditingPrompt: boolean;
  guidance: string;
  vizEventsCollapsed: boolean;
};

export function AgentEditPanel({ agent, parentRoleLabel, isEditingPrompt, guidance, vizEventsCollapsed }: AgentEditPanelProps) {
  const roleConfig = {
    human: { icon: "👤", label: "Human", color: "#1e40af", bgColor: "#dbeafe" },
    assistant: { icon: "🤖", label: "Assistant", color: "#7c3aed", bgColor: "#ede9fe" },
    coder: { icon: "👨‍💻", label: "Coder", color: "#059669", bgColor: "#d1fae5" },
    productmanager: { icon: "📋", label: "PM", color: "#dc2626", bgColor: "#fee2e2" },
    designer: { icon: "🎨", label: "Designer", color: "#ea580c", bgColor: "#ffedd5" },
    tester: { icon: "🧪", label: "Tester", color: "#0891b2", bgColor: "#cffafe" },
    analyst: { icon: "📊", label: "Analyst", color: "#c026d3", bgColor: "#fae8ff" },
    ceo: { icon: "💼", label: "CEO", color: "#ca8a04", bgColor: "#fef3c7" },
  }[agent.role.toLowerCase()] ?? { icon: "⚡", label: agent.role, color: "#6b7280", bgColor: "#f3f4f6" };

  const disabledButtonStyle = {
    opacity: 0.6,
    cursor: "default",
  } as const;

  return (
    <div
      style={{
        position: "absolute",
        right: vizEventsCollapsed ? 24 : 320,
        bottom: 24,
        width: 320,
        maxHeight: "calc(100% - 100px)",
        background: "rgba(10, 14, 39, 0.95)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(100, 150, 255, 0.3)",
        borderRadius: 12,
        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
      }}
    >
      <div
        style={{
          padding: 12,
          borderBottom: "1px solid rgba(100, 150, 255, 0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "linear-gradient(to bottom, rgba(59, 130, 246, 0.1), transparent)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              background: roleConfig.bgColor + "22",
              border: `2px solid ${roleConfig.color}44`,
            }}
          >
            {roleConfig.icon}
          </div>
          <div>
            <div style={{ color: "white", fontWeight: 600, fontSize: 13 }}>{roleConfig.label}</div>
            <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 2 }}>{agent.role}</div>
          </div>
        </div>
        <button
          type="button"
          disabled
          style={{
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: 6,
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#94a3b8",
            fontSize: 16,
            ...disabledButtonStyle,
          }}
          aria-disabled="true"
          title="Close disabled"
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4, fontWeight: 600 }}>NODE ID</div>
          <div
            style={{
              padding: 8,
              borderRadius: 6,
              background: "rgba(0, 0, 0, 0.3)",
              border: "1px solid rgba(255, 255, 255, 0.05)",
              fontFamily: "monospace",
              fontSize: 10,
              color: "#94a3b8",
              wordBreak: "break-all",
            }}
          >
            {agent.id}
          </div>
        </div>

        {agent.parentId && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4, fontWeight: 600 }}>PARENT</div>
            <div
              style={{
                padding: 8,
                borderRadius: 6,
                background: "rgba(168, 85, 247, 0.1)",
                border: "1px solid rgba(168, 85, 247, 0.2)",
                fontSize: 11,
                color: "#d8b4fe",
              }}
            >
              {parentRoleLabel ?? "Unknown"}
            </div>
          </div>
        )}

        {isEditingPrompt ? (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4, fontWeight: 600 }}>GUIDANCE / PROMPT</div>
            <textarea
              value={guidance}
              readOnly
              placeholder="添加自定义指导语..."
              style={{
                width: "100%",
                minHeight: 100,
                padding: 8,
                borderRadius: 6,
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid rgba(100, 150, 255, 0.3)",
                color: "#e4e4e7",
                fontSize: 11,
                fontFamily: "monospace",
                resize: "vertical",
                outline: "none",
              }}
            />
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: "#64748b", fontSize: 10, marginBottom: 4, fontWeight: 600 }}>ACTIONS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                type="button"
                disabled
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "rgba(59, 130, 246, 0.15)",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  color: "#60a5fa",
                  fontSize: 11,
                  fontWeight: 600,
                  ...disabledButtonStyle,
                }}
                aria-disabled="true"
              >
                Edit Configuration
              </button>
              {agent.role !== "human" && agent.role !== "assistant" && (
                <button
                  type="button"
                  disabled
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#f87171",
                    fontSize: 11,
                    fontWeight: 600,
                    ...disabledButtonStyle,
                  }}
                  aria-disabled="true"
                >
                  Delete Agent
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {isEditingPrompt && (
        <div
          style={{
            padding: 12,
            borderTop: "1px solid rgba(100, 150, 255, 0.2)",
            display: "flex",
            gap: 6,
            background: "rgba(0, 0, 0, 0.2)",
          }}
        >
          <button
            type="button"
            disabled
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 6,
              background: "rgba(34, 197, 94, 0.15)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              color: "#4ade80",
              fontSize: 11,
              fontWeight: 600,
              ...disabledButtonStyle,
            }}
            aria-disabled="true"
          >
            Save
          </button>
          <button
            type="button"
            disabled
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              color: "#94a3b8",
              fontSize: 11,
              fontWeight: 600,
              ...disabledButtonStyle,
            }}
            aria-disabled="true"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
