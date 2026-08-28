import React, { useEffect, useRef, useState } from "react";
import { useAuditHarnessClient } from "../../hooks/useAuditHarnessClient.js";
import { useRunStore } from "../../stores/run.store.js";
import { useReplayStore } from "../../stores/replay.store.js";
import { TraceHeader } from "./TraceHeader.js";
import { VerdictBanner } from "./VerdictBanner.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { RefreshCw, AlertCircle } from "lucide-react";
import type { VerdictSchema } from "../../generated/api/index.js";

interface TraceViewProps {
  runId: string;
  /** "live" = kết nối REST+SSE thật | "demo" = replay từ fixture store */
  mode?: "live" | "demo";
}

export const TraceView: React.FC<TraceViewProps> = ({ runId, mode = "live" }) => {
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
    const verdictEvent = events.slice(0, currentStep + 1).find(
      (e) => e.type === "run:verdict"
    );

    if (verdictEvent) {
      const p = verdictEvent.payload;
      setDemoVerdict({
        status: (p.status as string) || "UNVERIFIED",
        severity: (p.severity as string) || "UNKNOWN",
        confidenceScore: (p.confidenceScore as number) ?? 0,
        explanation: (p.explanation as string) || "",
        pocSourceCode: (p.pocSourceCode as string) ?? null,
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

        const maxStep = historicalToolCalls.length > 0
          ? Math.max(...historicalToolCalls.map((tc: any) => tc.stepIndex))
          : 0;

        const unsubscribe = client.subscribeRunStream(
          runId,
          {
            onopen: () => {
              if (!isCancelled()) setSseStatus("connected");
            },
            onThought: (e: any) => {
              if (!isCancelled()) appendThought(e);
            },
            onToolCall: (e: any) => {
              if (!isCancelled()) appendToolCall(e);
            },
            onStatusChanged: (e: any) => {
              if (!isCancelled()) setRunStatus(e.status);
            },
            onVerdict: (e: any) => {
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
          Agent Execution Trajectory ({displayToolCalls.length} Tool Calls)
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
        ) : displayToolCalls.length === 0 ? (
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
            {displayToolCalls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
