import React, { useState } from "react";
import type { ToolCall } from "@audit-harness/contracts";
import {
  Terminal,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Clock,
} from "lucide-react";

interface ToolCallCardProps {
  toolCall: ToolCall;
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({ toolCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getToolIcon = (name: string) => {
    switch (name) {
      case "read_file":
        return "📄";
      case "grep":
        return "🔍";
      case "verification":
        return "🛡️";
      default:
        return "🔧";
    }
  };

  return (
    <div
      className="glass-panel"
      style={{
        borderRadius: "10px",
        border: toolCall.isError
          ? "1px dashed #f43f5e"
          : "1px solid rgba(255, 255, 255, 0.08)",
        marginBottom: "12px",
        overflow: "hidden",
        transition: "all 0.2s ease",
      }}
    >
      {/* Header Preview Mode: Fixed ~64px Height per Spec 3.2 */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          height: "64px",
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          background: isExpanded ? "rgba(31, 41, 55, 0.8)" : "transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "1.2rem" }}>
            {getToolIcon(toolCall.toolName)}
          </span>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontWeight: 600,
                  color: "#f9fafb",
                  fontSize: "0.95rem",
                }}
              >
                Step #{toolCall.stepIndex}: {toolCall.toolName}
              </span>
              {toolCall.isError && (
                <span
                  style={{
                    color: "#f43f5e",
                    fontSize: "0.75rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <AlertTriangle size={14} /> Error
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span
            style={{
              fontSize: "0.8rem",
              color: "#9ca3af",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Clock size={14} /> {toolCall.durationMs}ms
          </span>
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
            {toolCall.tokensUsed} tokens
          </span>
          <button style={{ color: "#9ca3af" }}>
            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>
      </div>

      {/* Expanded View */}
      {isExpanded && (
        <div
          style={{
            padding: "16px",
            borderTop: "1px solid rgba(255, 255, 255, 0.05)",
            background: "#111827",
          }}
        >
          <div style={{ marginBottom: "12px" }}>
            <h5
              style={{
                fontSize: "0.8rem",
                color: "#9ca3af",
                marginBottom: "6px",
                textTransform: "uppercase",
              }}
            >
              Arguments:
            </h5>
            <pre
              style={{
                background: "#090d16",
                padding: "10px",
                borderRadius: "6px",
                fontSize: "0.85rem",
                color: "#38bdf8",
              }}
            >
              {JSON.stringify(
                JSON.parse(toolCall.argumentsJson || "{}"),
                null,
                2,
              )}
            </pre>
          </div>

          <div>
            <h5
              style={{
                fontSize: "0.8rem",
                color: "#9ca3af",
                marginBottom: "6px",
                textTransform: "uppercase",
              }}
            >
              Result Output:
            </h5>
            <pre
              style={{
                background: "#090d16",
                padding: "10px",
                borderRadius: "6px",
                fontSize: "0.85rem",
                color: toolCall.isError ? "#f43f5e" : "#a7f3d0",
                maxHeight: "300px",
                overflowY: "auto",
              }}
            >
              {toolCall.resultJson}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
