import React, { useState, useEffect, useRef } from "react";
import { TraceHeader } from "./TraceHeader.js";
import { VerdictBanner } from "./VerdictBanner.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { ThoughtCard } from "./ThoughtCard.js";
import { RefreshCw, AlertCircle, ArrowDownCircle, Zap } from "lucide-react";
import { useTraceData } from "../../hooks/useTraceData.js";

interface TraceViewProps {
  runId: string;
  /** "live" = kết nối REST+SSE thật | "demo" = replay từ fixture store */
  mode?: "live" | "demo";
}

export const TraceView: React.FC<TraceViewProps> = ({
  runId,
  mode = "live",
}) => {
  const {
    currentRun,
    displayToolCalls,
    displayModelEvents,
    displayVerdict,
    isLoading,
    error,
    refetch,
  } = useTraceData(runId, mode);

  const [autoScroll, setAutoScroll] = useState(true);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  const combinedEvents = [
    ...displayToolCalls.map((tc) => ({
      type: "tool_call" as const,
      stepIndex: tc.stepIndex,
      data: tc,
    })),
    ...displayModelEvents.map((me) => ({
      type: "thought" as const,
      stepIndex: me.stepIndex,
      data: me,
    })),
  ].sort((a, b) => {
    if (a.stepIndex !== b.stepIndex)
      return (a.stepIndex || 0) - (b.stepIndex || 0);
    // if same step index, thought comes first
    if (a.type === "thought" && b.type === "tool_call") return -1;
    if (a.type === "tool_call" && b.type === "thought") return 1;
    return 0;
  });

  // Calculate consumed tokens
  const totalTokensBurned = displayToolCalls.reduce(
    (sum, tc) => sum + (tc.tokensUsed || 0),
    0,
  );
  const estimatedTokenBudget = 50000;
  const tokenUsagePercent = Math.min(
    100,
    Math.round((totalTokensBurned / estimatedTokenBudget) * 100),
  );

  // Auto-scroll when new events arrive
  useEffect(() => {
    if (autoScroll && bottomAnchorRef.current) {
      bottomAnchorRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [combinedEvents.length, autoScroll]);

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 32px" }}>
      <TraceHeader run={currentRun} mode={mode} />

      {/* Telemetry Bar: Token Gauge & Auto-Scroll Controls */}
      <div
        className="glass-panel"
        style={{
          marginTop: "16px",
          padding: "12px 20px",
          borderRadius: "10px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          fontSize: "0.85rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            flex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              color: "var(--accent-cyan)",
            }}
          >
            <Zap size={16} />
            <span style={{ fontWeight: 600 }}>Token Quota Burn:</span>
          </div>
          <div
            style={{
              flex: 1,
              maxWidth: "280px",
              height: "8px",
              background: "rgba(15, 23, 42, 0.8)",
              borderRadius: "4px",
              overflow: "hidden",
              border: "1px solid var(--border-color)",
            }}
          >
            <div
              style={{
                width: `${Math.max(tokenUsagePercent, totalTokensBurned > 0 ? 5 : 0)}%`,
                height: "100%",
                background:
                  tokenUsagePercent > 85
                    ? "var(--accent-rose)"
                    : tokenUsagePercent > 60
                      ? "var(--accent-amber)"
                      : "var(--accent-cyan)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--text-secondary)",
              fontSize: "0.8rem",
            }}
          >
            {totalTokensBurned.toLocaleString()} /{" "}
            {estimatedTokenBudget.toLocaleString()} tokens ({tokenUsagePercent}
            %)
          </span>
        </div>

        <button
          type="button"
          onClick={() => setAutoScroll(!autoScroll)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 12px",
            borderRadius: "6px",
            background: autoScroll
              ? "rgba(6, 182, 212, 0.15)"
              : "rgba(30, 41, 59, 0.6)",
            border: autoScroll
              ? "1px solid var(--accent-cyan)"
              : "1px solid var(--border-color)",
            color: autoScroll ? "var(--accent-cyan)" : "var(--text-secondary)",
            fontSize: "0.8rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <ArrowDownCircle size={14} />
          Auto-scroll: {autoScroll ? "ON" : "PAUSED"}
        </button>
      </div>

      {displayVerdict && <VerdictBanner verdict={displayVerdict} />}

      {/* State: Error alert */}
      {error && mode === "live" && (
        <div
          className="glass-panel"
          style={{
            padding: "16px 20px",
            borderRadius: "10px",
            background: "rgba(244, 63, 94, 0.1)",
            border: "1px solid rgba(244, 63, 94, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "16px",
          }}
          role="alert"
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <AlertCircle size={18} color="#f43f5e" />
            <span style={{ color: "#fca5a5", fontSize: "0.88rem" }}>
              {error}
            </span>
          </div>
          <button
            type="button"
            onClick={refetch}
            style={{
              padding: "6px 12px",
              background: "#f43f5e",
              color: "#fff",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.8rem",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
            aria-label="Retry loading data"
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* Trajectory Timeline List */}
      <div style={{ marginTop: "24px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h3
            style={{
              fontSize: "0.95rem",
              fontWeight: 600,
              color: "var(--text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Agent Execution Trajectory ({combinedEvents.length} Events)
          </h3>
          {currentRun?.status === "RUNNING" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "0.82rem",
                color: "var(--accent-cyan)",
              }}
            >
              <span className="badge-live-pulse" />
              <span>Agent reasoning in progress...</span>
            </div>
          )}
        </div>

        {/* State: Loading Skeleton */}
        {isLoading ? (
          <div
            className="glass-panel"
            style={{
              padding: "40px",
              textAlign: "center",
              color: "var(--accent-cyan)",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
            }}
          >
            <RefreshCw className="animate-spin" size={20} />
            <span>Synchronizing Audit Run Timeline...</span>
          </div>
        ) : combinedEvents.length === 0 ? (
          <div
            className="glass-panel"
            style={{
              padding: "48px 32px",
              textAlign: "center",
              color: "var(--text-muted)",
              borderRadius: "12px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "1.8rem" }}>⏳</div>
            <div
              style={{
                fontSize: "1rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
              }}
            >
              {mode === "demo"
                ? "Press Play on the controller below to replay the agent execution steps"
                : "Awaiting incoming SSE events from the agent sandbox..."}
            </div>
          </div>
        ) : (
          <div>
            {combinedEvents.map((evt, idx) => {
              if (evt.type === "thought") {
                const thoughtPayload = {
                  stepIndex: evt.data.stepIndex,
                  thought: evt.data.content,
                  id: evt.data.id,
                  runId: evt.data.runId,
                };
                return (
                  <ThoughtCard
                    key={`thought-${evt.data.id || idx}`}
                    thought={thoughtPayload}
                  />
                );
              }
              return (
                <ToolCallCard
                  key={`tool-${evt.data.id || idx}`}
                  toolCall={evt.data}
                />
              );
            })}
            <div ref={bottomAnchorRef} />
          </div>
        )}
      </div>
    </div>
  );
};
