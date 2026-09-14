import React, { useState } from "react";
import type { ThoughtEvent } from "../../stores/run.store.js";
import { Brain, ChevronDown, ChevronUp } from "lucide-react";

interface ThoughtCardProps {
  thought: ThoughtEvent;
}

export const ThoughtCard: React.FC<ThoughtCardProps> = ({ thought }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const content = thought.thought || thought.content || "";
  const isLong = content.length > 200;

  return (
    <div
      style={{
        borderRadius: "6px",
        border: "1px solid var(--border-subtle)",
        borderLeft: "3px solid var(--accent-purple)",
        marginBottom: "6px",
        overflow: "hidden",
        background: "var(--surface-card)",
        transition: "all 0.15s ease",
      }}
      className="hover-scale"
    >
      <div
        onClick={() => isLong && setIsExpanded(!isExpanded)}
        style={{
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          cursor: isLong ? "pointer" : "default",
          background: "rgba(168, 85, 247, 0.04)",
          borderBottom: isExpanded
            ? "1px solid rgba(255, 255, 255, 0.03)"
            : "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minWidth: 0,
          }}
        >
          <Brain
            size={13}
            color="var(--accent-purple)"
            style={{ flexShrink: 0 }}
          />
          <span
            className="tabular-nums"
            style={{
              fontWeight: 600,
              color: "var(--accent-purple)",
              fontSize: "0.75rem",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
            }}
          >
            Step #{thought.stepIndex}: Reasoning
          </span>
          {!isExpanded && (
            <span
              style={{
                color: "var(--text-muted)",
                fontSize: "0.72rem",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "600px",
              }}
            >
              {content}
            </span>
          )}
        </div>

        {isLong && (
          <button
            type="button"
            style={{
              color: "var(--text-muted)",
              padding: "2px",
              display: "flex",
              alignItems: "center",
            }}
            aria-label={isExpanded ? "Collapse thought" : "Expand thought"}
          >
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>

      {isExpanded && (
        <div
          style={{
            padding: "8px 12px 10px 12px",
            color: "var(--text-normal)",
            fontSize: "0.8rem",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            fontFamily: "var(--font-mono)",
            background: "rgba(0, 0, 0, 0.15)",
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
};
