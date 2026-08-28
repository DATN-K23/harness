import React, { useState } from "react";
import type { ToolCallSchema as ToolCall } from "../../generated/api/index.js";
import { ChevronDown, ChevronUp, AlertTriangle, Clock } from "lucide-react";

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

  /** Safe JSON parser để phòng thủ crash UI khi argumentsJson không hợp lệ */
  const formatArgumentsJson = (jsonStr: string): string => {
    if (!jsonStr) return "{}";
    try {
      const parsed =
        typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return jsonStr; // Trả về raw string nếu parse lỗi thay vì crash
    }
  };

  return (
    <div
      className="glass-panel"
      style={{
        borderRadius: "var(--border-radius-lg, 16px)",
        border: toolCall.isError
          ? "1px solid var(--accent-rose)"
          : "1px solid var(--glass-border)",
        marginBottom: "16px",
        overflow: "hidden",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        animation: "slideUp 0.4s ease-out forwards",
        boxShadow: toolCall.isError
          ? "0 0 15px rgba(244, 63, 94, 0.15)"
          : "0 4px 20px rgba(0, 0, 0, 0.2)",
      }}
    >
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {/* Header Preview Mode */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          minHeight: "64px",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          background: isExpanded ? "rgba(255, 255, 255, 0.03)" : "transparent",
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
                  color: toolCall.isError
                    ? "var(--accent-rose)"
                    : "var(--accent-cyan)",
                  fontSize: "1rem",
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
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              Arguments
            </h5>
            <pre
              style={{
                background: "rgba(0, 0, 0, 0.3)",
                padding: "16px",
                borderRadius: "8px",
                fontSize: "0.85rem",
                color: "var(--accent-cyan)",
                border: "1px solid rgba(6, 182, 212, 0.1)",
              }}
            >
              {formatArgumentsJson(toolCall.argumentsJson)}
            </pre>
          </div>

          <div>
            <h5
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              Result Output
            </h5>
            <pre
              style={{
                background: "rgba(0, 0, 0, 0.3)",
                padding: "16px",
                borderRadius: "8px",
                fontSize: "0.85rem",
                color: toolCall.isError
                  ? "var(--accent-rose)"
                  : "var(--accent-emerald)",
                border: toolCall.isError
                  ? "1px solid rgba(244, 63, 94, 0.1)"
                  : "1px solid rgba(16, 185, 129, 0.1)",
                maxHeight: "350px",
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
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
