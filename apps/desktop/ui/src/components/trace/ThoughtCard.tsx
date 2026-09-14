import React, { useState } from "react";
import type { ThoughtEvent } from "../../stores/run.store.js";
import { Brain, ChevronDown, ChevronUp } from "lucide-react";

interface ThoughtCardProps {
  thought: ThoughtEvent;
  timeDelta?: string;
}

export const ThoughtCard: React.FC<ThoughtCardProps> = ({
  thought,
  timeDelta,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const content = thought.thought || thought.content || "";
  const isLong = content.length > 200;

  return (
    <div
      style={{
        borderRadius: "6px",
        border: "1px solid var(--border-subtle)",
        borderLeft: "3px solid rgba(168, 85, 247, 0.6)",
        marginBottom: "6px",
        overflow: "hidden",
        background: "var(--surface-card)",
      }}
      className="row-interactive"
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
              fontSize: "12px",
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
                fontSize: "12px",
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

        {timeDelta && (
          <span
            className="tabular-nums font-mono"
            style={{
              fontSize: "0.72rem",
              color: "var(--accent-purple)",
              background: "var(--accent-purple-bg)",
              padding: "1px 6px",
              borderRadius: "3px",
              border: "1px solid rgba(168, 85, 247, 0.25)",
              display: "inline-flex",
              alignItems: "center",
              fontWeight: 600,
              flexShrink: 0,
              marginLeft: "auto",
            }}
            title={`Timeline delta: ${timeDelta} from start`}
          >
            {timeDelta}
          </span>
        )}

        {isLong && (
          <button
            type="button"
            style={{
              color: "var(--text-muted)",
              padding: "2px",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
            aria-label={isExpanded ? "Collapse thought" : "Expand thought"}
          >
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>

      {isExpanded && (
        <div
          className="max-w-prose"
          style={{
            padding: "10px 14px",
            color: "var(--text-normal)",
            fontSize: "13px",
            lineHeight: 1.65,
            whiteSpace: "pre-wrap",
            fontFamily: "var(--font-sans)",
            background: "rgba(0, 0, 0, 0.15)",
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
};
