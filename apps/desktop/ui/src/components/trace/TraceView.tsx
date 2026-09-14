import React, { useState, useEffect, useRef, useMemo } from "react";
import { TraceHeader } from "./TraceHeader.js";
import { VerdictBanner } from "./VerdictBanner.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { ThoughtCard } from "./ThoughtCard.js";
import {
  RefreshCw,
  AlertCircle,
  ArrowDownCircle,
  Zap,
  Activity,
  Wrench,
  Brain,
  AlertTriangle,
  Layers,
} from "lucide-react";
import { useTraceData } from "../../hooks/useTraceData.js";
import { useVirtualizer } from "@tanstack/react-virtual";

interface TraceViewProps {
  runId: string;
  /** "live" = kết nối REST+SSE thật | "demo" = replay từ fixture store */
  mode?: "live" | "demo";
}

type EventFilterTab = "all" | "tools" | "thoughts" | "errors";

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
  const [activeFilter, setActiveFilter] = useState<EventFilterTab>("all");
  const parentRef = useRef<HTMLDivElement>(null);

  const formatDelta = (deltaMs: number): string => {
    if (deltaMs < 1000) {
      return `+${Math.max(0, Math.round(deltaMs))}ms`;
    }
    return `+${(Math.max(0, deltaMs) / 1000).toFixed(1)}s`;
  };

  const combinedEvents = useMemo(() => {
    const rawEvents = [
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

    if (rawEvents.length === 0) return [];

    // Calculate relative timeline delta (+Δt ms or +Δt s) relative to first event's timestamp
    const firstEventData = rawEvents[0].data as {
      timestamp?: string | number | Date;
      created_at?: string | number | Date;
      createdAt?: string | number | Date;
    };
    const firstRawTs =
      firstEventData.timestamp ??
      firstEventData.created_at ??
      firstEventData.createdAt;
    const hasTimestamps = Boolean(
      firstRawTs && !Number.isNaN(new Date(firstRawTs).getTime()),
    );

    if (hasTimestamps) {
      const firstTime = new Date(firstRawTs!).getTime();
      return rawEvents.map((evt) => {
        const evtData = evt.data as {
          timestamp?: string | number | Date;
          created_at?: string | number | Date;
          createdAt?: string | number | Date;
        };
        const rawTs =
          evtData.timestamp ?? evtData.created_at ?? evtData.createdAt;
        const eventTime = rawTs ? new Date(rawTs).getTime() : firstTime;
        const deltaMs = Math.max(0, eventTime - firstTime);
        return {
          ...evt,
          timeDelta: formatDelta(deltaMs),
        };
      });
    }

    // Fallback if events lack absolute timestamps: simulate timeline using tool durations
    let accumulatedMs = 0;
    return rawEvents.map((evt, idx) => {
      if (idx === 0) {
        if (evt.type === "tool_call") {
          accumulatedMs += evt.data.durationMs || 0;
        }
        return {
          ...evt,
          timeDelta: "+0ms",
        };
      }
      const currentDelta = accumulatedMs;
      if (evt.type === "tool_call") {
        accumulatedMs += evt.data.durationMs || 50;
      } else {
        accumulatedMs += 100;
      }
      return {
        ...evt,
        timeDelta: formatDelta(currentDelta),
      };
    });
  }, [displayToolCalls, displayModelEvents]);

  // Event counts for filter badges
  const counts = useMemo(() => {
    const tools = displayToolCalls.length;
    const thoughts = displayModelEvents.length;
    const errors = displayToolCalls.filter((tc) => tc.isError).length;
    return {
      all: combinedEvents.length,
      tools,
      thoughts,
      errors,
    };
  }, [combinedEvents.length, displayToolCalls, displayModelEvents.length]);

  // Filtered event list
  const filteredEvents = useMemo(() => {
    switch (activeFilter) {
      case "tools":
        return combinedEvents.filter((e) => e.type === "tool_call");
      case "thoughts":
        return combinedEvents.filter((e) => e.type === "thought");
      case "errors":
        return combinedEvents.filter(
          (e) => e.type === "tool_call" && e.data.isError,
        );
      case "all":
      default:
        return combinedEvents;
    }
  }, [combinedEvents, activeFilter]);

  // Virtualizer for high-frequency streaming
  const rowVirtualizer = useVirtualizer({
    count: filteredEvents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  // Calculate consumed tokens and dynamic budget from currentRun config snapshot
  const totalTokensBurned = displayToolCalls.reduce(
    (sum, tc) => sum + (tc.tokensUsed || 0),
    0,
  );
  const estimatedTokenBudget =
    (currentRun as { configSnapshot?: { tokenBudget?: number } } | null)
      ?.configSnapshot?.tokenBudget ?? 150000;
  const isBudgetExhausted = totalTokensBurned >= estimatedTokenBudget;
  const tokenOverage = Math.max(0, totalTokensBurned - estimatedTokenBudget);
  const tokenUsagePercent = Math.min(
    100,
    Math.round((totalTokensBurned / estimatedTokenBudget) * 100),
  );

  // Auto-scroll when new events arrive
  useEffect(() => {
    if (autoScroll && filteredEvents.length > 0) {
      rowVirtualizer.scrollToIndex(filteredEvents.length - 1, {
        align: "end",
        behavior: "smooth",
      });
    }
  }, [filteredEvents.length, autoScroll, rowVirtualizer]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        padding: "12px 16px",
      }}
    >
      <TraceHeader run={currentRun} mode={mode} />

      {displayVerdict && <VerdictBanner verdict={displayVerdict} />}

      {/* Telemetry HUD Strip */}
      <div
        style={{
          padding: "8px 14px",
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "8px",
          marginBottom: "10px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        {/* Token Quota Burn Gauge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flex: 1,
            minWidth: "260px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              color: isBudgetExhausted
                ? "var(--accent-rose)"
                : "var(--accent-cyan)",
              fontSize: "0.75rem",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <Zap size={14} />
            <span>Token Burn:</span>
          </div>

          <div
            style={{
              flex: 1,
              maxWidth: "200px",
              height: "6px",
              background: "var(--surface-input)",
              borderRadius: "3px",
              overflow: "hidden",
              border: "1px solid var(--border-subtle)",
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
            className="tabular-nums font-mono"
            style={{
              color: isBudgetExhausted
                ? "var(--accent-rose)"
                : "var(--text-muted)",
              fontSize: "0.75rem",
              whiteSpace: "nowrap",
            }}
          >
            {totalTokensBurned.toLocaleString()} /{" "}
            {estimatedTokenBudget.toLocaleString()} ({tokenUsagePercent}%)
          </span>

          {isBudgetExhausted && (
            <span
              className="tabular-nums font-mono"
              style={{
                fontSize: "0.7rem",
                color: "var(--accent-rose)",
                background: "var(--accent-rose-bg)",
                border: "1px solid rgba(244, 63, 94, 0.3)",
                padding: "1px 6px",
                borderRadius: "3px",
                fontWeight: 600,
              }}
            >
              +{tokenOverage.toLocaleString()} over quota
            </span>
          )}
        </div>

        {/* Controls: Filter Tabs & Auto Scroll */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Filter Tabs */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "2px",
              background: "var(--surface-input)",
              padding: "2px",
              borderRadius: "6px",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <button
              type="button"
              onClick={() => setActiveFilter("all")}
              style={{
                padding: "3px 8px",
                borderRadius: "4px",
                fontSize: "0.72rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background:
                  activeFilter === "all"
                    ? "var(--surface-hover)"
                    : "transparent",
                color:
                  activeFilter === "all"
                    ? "var(--text-bright)"
                    : "var(--text-muted)",
              }}
            >
              <Layers size={11} />
              <span>All ({counts.all})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("tools")}
              style={{
                padding: "3px 8px",
                borderRadius: "4px",
                fontSize: "0.72rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background:
                  activeFilter === "tools"
                    ? "var(--surface-hover)"
                    : "transparent",
                color:
                  activeFilter === "tools"
                    ? "var(--accent-cyan)"
                    : "var(--text-muted)",
              }}
            >
              <Wrench size={11} />
              <span>Tools ({counts.tools})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("thoughts")}
              style={{
                padding: "3px 8px",
                borderRadius: "4px",
                fontSize: "0.72rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background:
                  activeFilter === "thoughts"
                    ? "var(--surface-hover)"
                    : "transparent",
                color:
                  activeFilter === "thoughts"
                    ? "var(--accent-purple)"
                    : "var(--text-muted)",
              }}
            >
              <Brain size={11} />
              <span>Thoughts ({counts.thoughts})</span>
            </button>

            {counts.errors > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilter("errors")}
                style={{
                  padding: "3px 8px",
                  borderRadius: "4px",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  background:
                    activeFilter === "errors"
                      ? "var(--accent-rose-bg)"
                      : "transparent",
                  color: "var(--accent-rose)",
                }}
              >
                <AlertTriangle size={11} />
                <span>Errors ({counts.errors})</span>
              </button>
            )}
          </div>

          {/* Auto-Scroll Toggle */}
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              borderRadius: "5px",
              background: autoScroll
                ? "var(--accent-cyan-bg)"
                : "var(--surface-input)",
              border: autoScroll
                ? "1px solid rgba(6, 182, 212, 0.4)"
                : "1px solid var(--border-subtle)",
              color: autoScroll ? "var(--accent-cyan)" : "var(--text-muted)",
              fontSize: "0.72rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <ArrowDownCircle size={12} />
            <span>Auto-scroll: {autoScroll ? "ON" : "PAUSED"}</span>
          </button>
        </div>
      </div>

      {/* State: Error alert */}
      {error && mode === "live" && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "6px",
            background: "rgba(244, 63, 94, 0.1)",
            border: "1px solid rgba(244, 63, 94, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "10px",
          }}
          role="alert"
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={15} color="var(--accent-rose)" />
            <span style={{ color: "var(--accent-rose)", fontSize: "0.8rem" }}>
              {error}
            </span>
          </div>
          <button
            type="button"
            onClick={refetch}
            style={{
              padding: "4px 10px",
              background: "var(--accent-rose)",
              color: "#fff",
              borderRadius: "4px",
              fontWeight: 600,
              fontSize: "0.75rem",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
            aria-label="Retry loading data"
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      )}

      {/* Trajectory Header & Status */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
          padding: "0 2px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <h3
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Agent Trajectory Timeline
          </h3>
          <span
            className="tabular-nums font-mono"
            style={{
              fontSize: "0.7rem",
              color: "var(--accent-cyan)",
              background: "var(--accent-cyan-bg)",
              padding: "1px 6px",
              borderRadius: "4px",
              border: "1px solid rgba(6, 182, 212, 0.2)",
            }}
          >
            {filteredEvents.length} events
          </span>
        </div>

        {currentRun?.status === "RUNNING" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "0.75rem",
              color: "var(--accent-cyan)",
            }}
          >
            <span className="badge-live-pulse" />
            <span>Sandbox execution in progress...</span>
          </div>
        )}
      </div>

      {/* Main Virtualized Stream Surface */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: "var(--surface-panel)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "8px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {isLoading ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              color: "var(--accent-cyan)",
              fontSize: "0.85rem",
            }}
          >
            <RefreshCw className="animate-spin" size={16} />
            <span>Synchronizing trajectory stream...</span>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              padding: "32px",
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            <Activity size={24} color="var(--accent-cyan)" />
            <div
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
                color: "var(--text-normal)",
              }}
            >
              {mode === "demo"
                ? "Click Play on the transport bar below to replay execution trajectory"
                : "Awaiting incoming SSE events from agent sandbox..."}
            </div>
            <p
              style={{
                fontSize: "0.78rem",
                maxWidth: "360px",
                color: "var(--text-muted)",
              }}
            >
              {mode === "demo"
                ? "Scrub the timeline or select replay speed (0.5x - 10x) to inspect steps."
                : "Initialize a verification run from the operational pane on the left."}
            </p>
          </div>
        ) : (
          <div
            ref={parentRef}
            style={{
              flex: 1,
              height: "100%",
              overflowY: "auto",
              padding: "8px",
            }}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const evt = filteredEvents[virtualRow.index];
                return (
                  <div
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {evt.type === "thought" ? (
                      <ThoughtCard
                        thought={{
                          stepIndex: evt.data.stepIndex,
                          thought: evt.data.content,
                          id: evt.data.id,
                          runId: evt.data.runId,
                        }}
                        timeDelta={evt.timeDelta}
                      />
                    ) : (
                      <ToolCallCard
                        toolCall={evt.data}
                        timeDelta={evt.timeDelta}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
