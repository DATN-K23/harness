import React, { useEffect, useRef, useState } from "react";
import { useAuditHarnessClient } from "../../hooks/useAuditHarnessClient.js";
import { useRunStore } from "../../stores/run.store.js";
import { useReplayStore } from "../../stores/replay.store.js";
import { TraceHeader } from "./TraceHeader.js";
import { VerdictBanner } from "./VerdictBanner.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { ThoughtCard } from "./ThoughtCard.js";
import { RefreshCw, AlertCircle } from "lucide-react";
import type {
  VerdictSchema,
  EvidenceSchema,
} from "../../generated/api/index.js";

interface TraceViewProps {
  runId: string;
  /** "live" = kết nối REST+SSE thật | "demo" = replay từ fixture store */
  mode?: "live" | "demo";
}

export const TraceView: React.FC<TraceViewProps> = ({
  runId,
  mode = "live",
}) => {
  const client = useAuditHarnessClient();
  const {
    currentRun,
    toolCalls,
    setRun,
    setRunStatus,
    appendToolCall,
    appendThought,
    setSseStatus,
    reset,
  } = useRunStore();

  const { events, currentStep } = useReplayStore();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // ---------- DEMO MODE: Đọc verdict từ replay events (bridge) ----------
  const [demoVerdict, setDemoVerdict] = useState<VerdictSchema | null>(null);

  useEffect(() => {
    if (mode !== "demo") return;

    // Scan từ đầu đến currentStep tìm event run:verdict
    const verdictEvent = events
      .slice(0, currentStep + 1)
      .find((e) => e.type === "run:verdict");

    if (verdictEvent) {
      const p = verdictEvent.payload;
      setDemoVerdict({
        schemaVersion:
          (p.schema_version as string) ||
          (p.schemaVersion as string) ||
          "judge-verdict-v1",
        validity: (p.validity as string) || "invalid",
        severity: (p.severity as string) || "none",
        confidence: (p.confidence as number) ?? 0,
        rationale: (p.rationale as string) || "",
        evidence: (p.evidence as EvidenceSchema[]) || [],
        verificationStatus: (p.verificationStatus as string) || "unverified",
        labelNormalizationVersion:
          (p.label_normalization_version as string) ||
          (p.labelNormalizationVersion as string) ||
          "v1.0",
      });
    } else {
      setDemoVerdict(null);
    }
  }, [mode, currentStep, events]);

  // ---------- DEMO MODE: Đọc tool calls từ replay events (bridge) ----------
  const demoToolCalls = events
    .slice(0, currentStep + 1)
    .filter((e) => e.type === "step:tool_call")
    .map((e, idx) => {
      const p = e.payload;
      return {
        id: `demo-tc-${idx}`,
        runId: "demo-run-01",
        stepIndex: (p.stepIndex as number) ?? idx + 1,
        toolName: (p.toolName as string) || "unknown_tool",
        argumentsJson: (p.argumentsJson as string) || "{}",
        resultJson: (p.resultJson as string) || "{}",
        isError: Boolean(p.isError),
        durationMs: (p.durationMs as number) ?? 0,
        tokensUsed: (p.tokensUsed as number) ?? 0,
        timestamp: new Date().toISOString(),
      };
    });

  const demoModelEvents = events
    .slice(0, currentStep + 1)
    .filter((e) => e.type === "step:thought")
    .map((e, idx) => {
      const p = e.payload;
      return {
        id: `demo-thought-${idx}`,
        runId: "demo-run-01",
        stepIndex: (p.stepIndex as number) ?? idx + 1,
        eventType: "THOUGHT",
        content: (p.thought as string) || (p.content as string) || "",
      };
    });

  // ---------- LIVE MODE: Fetch & Subscribe ----------
  const fetchAndSubscribe = async (isCancelled: () => boolean) => {
    setIsLoading(true);
    setError(null);
    reset();

    // Hủy subscription trước đó nếu có
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    try {
      // Step 1: REST GET /api/v1/runs/:id (Hydrate run metadata)
      const runData = await client.getRun(runId);
      if (isCancelled()) return;
      setRun(runData);

      // Step 2: REST GET /api/v1/runs/:id/tool-calls (Hydrate full tool call history)
      const historicalToolCalls = await client.getToolCalls(runId, {
        fromStep: 0,
        limit: 500,
      });
      if (isCancelled()) return;
      historicalToolCalls.forEach(appendToolCall);

      setIsLoading(false);

      // Step 3: Connect SSE Stream nếu RUNNING
      if (runData.status === "RUNNING") {
        setSseStatus("connecting");

        const maxStep =
          historicalToolCalls.length > 0
            ? Math.max(...historicalToolCalls.map((tc) => tc.stepIndex ?? 0))
            : 0;

        const unsubscribe = client.subscribeRunStream(
          runId,
          {
            onopen: () => {
              if (!isCancelled()) setSseStatus("connected");
            },
            onThought: (e) => {
              if (!isCancelled()) appendThought(e);
            },
            onToolCall: (e) => {
              if (!isCancelled()) appendToolCall(e);
            },
            onStatusChanged: (e) => {
              if (!isCancelled()) setRunStatus(e.status);
            },
            onVerdict: () => {
              if (!isCancelled()) {
                client
                  .getRun(runId)
                  .then((updated) => {
                    if (!isCancelled()) setRun(updated);
                  })
                  .catch(() => {});
              }
            },
            onCompleted: () => {
              if (!isCancelled()) {
                setSseStatus("offline");
                client
                  .getRun(runId)
                  .then((updated) => {
                    if (!isCancelled()) setRun(updated);
                  })
                  .catch(() => {});
              }
            },
            onError: () => {
              if (!isCancelled()) setSseStatus("reconnecting");
            },
          },
          { fromStep: maxStep },
        );

        if (!isCancelled()) {
          unsubscribeRef.current = unsubscribe;
        } else {
          unsubscribe();
        }
      } else {
        setSseStatus("offline");
      }
    } catch (err: unknown) {
      if (isCancelled()) return;
      console.error("Initialization error in TraceView:", err);
      setError(err instanceof Error ? err.message : String(err));
      setSseStatus("offline");
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Demo mode: không fetch API — replay store xử lý tất cả
    if (mode === "demo") {
      setIsLoading(false);
      setSseStatus("offline");
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;

    void fetchAndSubscribe(isCancelled);

    return () => {
      cancelled = true;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [runId, mode]);

  // Chọn nguồn dữ liệu phù hợp tuỳ mode
  const displayToolCalls = mode === "demo" ? demoToolCalls : toolCalls;
  const displayVerdict = mode === "demo" ? demoVerdict : currentRun?.verdict;

  // Render combined trace events
  const { modelEvents } = useRunStore();
  const displayModelEvents = mode === "demo" ? demoModelEvents : modelEvents.filter(e => e.eventType === "THOUGHT");

  const combinedEvents = [
    ...displayToolCalls.map((tc) => ({ type: "tool_call" as const, stepIndex: tc.stepIndex, data: tc })),
    ...displayModelEvents.map((me) => ({ type: "thought" as const, stepIndex: me.stepIndex, data: me })),
  ].sort((a, b) => {
    if (a.stepIndex !== b.stepIndex) return (a.stepIndex || 0) - (b.stepIndex || 0);
    // if same step index, thought comes first
    if (a.type === "thought" && b.type === "tool_call") return -1;
    if (a.type === "tool_call" && b.type === "thought") return 1;
    return 0;
  });

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
      <TraceHeader run={currentRun} mode={mode} />

      {displayVerdict && <VerdictBanner verdict={displayVerdict} />}

      {/* State: Error alert (chỉ hiện ở Live Mode) */}
      {error && mode === "live" && (
        <div
          className="glass-panel"
          style={{
            padding: "20px 24px",
            borderRadius: "12px",
            background: "rgba(244, 63, 94, 0.1)",
            border: "1px solid rgba(244, 63, 94, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <AlertCircle size={20} color="#f43f5e" />
            <span style={{ color: "#fca5a5", fontSize: "0.9rem" }}>
              {error}
            </span>
          </div>
          <button
            onClick={() => {
              void fetchAndSubscribe(() => false);
            }}
            style={{
              padding: "6px 14px",
              background: "#f43f5e",
              color: "#fff",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <RefreshCw size={14} /> Thử lại
          </button>
        </div>
      )}

          <div style={{ marginTop: "20px" }}>
        <h3
          style={{
            fontSize: "1rem",
            fontWeight: 600,
            color: "#9ca3af",
            marginBottom: "16px",
          }}
        >
          Agent Execution Trajectory ({combinedEvents.length} Events)
        </h3>

        {/* State: Loading Skeleton */}
        {isLoading ? (
          <div
            className="glass-panel"
            style={{
              padding: "40px",
              textAlign: "center",
              color: "#06b6d4",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
            }}
          >
            <RefreshCw className="animate-spin" size={20} />
            <span>Đang tải dữ liệu Audit Run...</span>
          </div>
        ) : combinedEvents.length === 0 ? (
          <div
            className="glass-panel"
            style={{
              padding: "40px",
              textAlign: "center",
              color: "#6b7280",
              borderRadius: "12px",
            }}
          >
            {mode === "demo"
              ? "Play the demo to see agent execution steps..."
              : "No execution steps recorded yet."}
          </div>
        ) : (
          <div>
            {combinedEvents.map((evt, idx) => {
              if (evt.type === "thought") {
                const thoughtPayload = { stepIndex: evt.data.stepIndex, thought: evt.data.content, id: evt.data.id, runId: evt.data.runId };
                return <ThoughtCard key={`thought-${evt.data.id || idx}`} thought={thoughtPayload} />;
              }
              return <ToolCallCard key={`tool-${evt.data.id || idx}`} toolCall={evt.data} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
};
