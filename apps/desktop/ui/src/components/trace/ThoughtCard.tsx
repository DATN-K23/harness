import React from "react";
import type { ThoughtEvent } from "../../stores/run.store.js";
import { Brain } from "lucide-react";

interface ThoughtCardProps {
  thought: ThoughtEvent;
}

export const ThoughtCard: React.FC<ThoughtCardProps> = ({ thought }) => {
  return (
    <div
      className="glass-panel hover-scale"
      style={{
        borderRadius: "var(--border-radius-lg, 16px)",
        border: "1px solid rgba(168, 85, 247, 0.2)",
        marginBottom: "16px",
        overflow: "hidden",
        background: "rgba(168, 85, 247, 0.05)",
      }}
    >
      <div
        style={{
          padding: "16px 20px",
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
        }}
      >
        <div
          style={{
            marginTop: "2px",
            color: "rgb(192, 132, 252)",
          }}
        >
          <Brain size={20} />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontWeight: 600,
              color: "rgb(192, 132, 252)",
              fontSize: "0.9rem",
              marginBottom: "8px",
            }}
          >
            Step #{thought.stepIndex}: Thinking...
          </div>
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.95rem",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {thought.thought || thought.content}
          </div>
        </div>
      </div>
    </div>
  );
};
