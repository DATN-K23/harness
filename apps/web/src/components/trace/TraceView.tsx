import React, { useEffect, useRef, useState } from "react";
import { useAuditHarnessClient } from "../../hooks/useAuditHarnessClient.js";
import { useRunStore } from "../../stores/run.store.js";
import { TraceHeader } from "./TraceHeader.js";
import { VerdictBanner } from "./VerdictBanner.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { RefreshCw, AlertCircle } from "lucide-react";

interface TraceViewProps {
  runId: string;
}

export const TraceView: React.FC<TraceViewProps> = ({ runId }) => {
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

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

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

        const maxStepIndex =
          historicalToolCalls.length > 0
            ? Math.max(...historicalToolCalls.map((tc) => tc.stepIndex))
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
            onVerdict: (_e) => {
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
          { fromStep: maxStepIndex },
        );

        if (!isCancelled()) {
          unsubscribeRef.current = unsubscribe;
        } else {
          unsubscribe();
        }
      } else {
        setSseStatus("offline");
      }
    } catch (err: any) {
      if (isCancelled()) return;
      console.error("Initialization error in TraceView:", err);
      setError(err?.message || "Không thể tải thông tin Audit Run");
      setSseStatus("offline");
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    fetchAndSubscribe(isCancelled);

    return () => {
      cancelled = true;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [runId]);

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
      <TraceHeader run={currentRun} />

      {currentRun?.verdict && <VerdictBanner verdict={currentRun.verdict} />}

      {/* State: Error alert */}
      {error && (
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
            onClick={() => fetchAndSubscribe(() => false)}
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
          Agent Execution Trajectory ({toolCalls.length} Tool Calls)
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
        ) : toolCalls.length === 0 ? (
          <div
            className="glass-panel"
            style={{
              padding: "40px",
              textAlign: "center",
              color: "#6b7280",
              borderRadius: "12px",
            }}
          >
            No execution steps recorded yet.
          </div>
        ) : (
          <div>
            {toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
