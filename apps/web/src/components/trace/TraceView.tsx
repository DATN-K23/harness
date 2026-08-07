import React, { useEffect, useRef } from "react";
import { useAuditHarnessClient } from "../../hooks/useAuditHarnessClient.js";
import { useRunStore } from "../../stores/run.store.js";
import { TraceHeader } from "./TraceHeader.js";
import { VerdictBanner } from "./VerdictBanner.js";
import { ToolCallCard } from "./ToolCallCard.js";

interface TraceViewProps {
  runId: string;
}

export const TraceView: React.FC<TraceViewProps> = ({ runId }) => {
  const client = useAuditHarnessClient();
  const {
    currentRun,
    toolCalls,
    setRun,
    appendToolCall,
    appendThought,
    setSseStatus,
  } = useRunStore();
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    async function initialize() {
      try {
        // Step 1: REST GET /api/v1/runs/:id (Hydrate run metadata)
        const runData = await client.getRun(runId);
        setRun(runData);

        // Step 2: REST GET /api/v1/runs/:id/tool-calls (Hydrate full tool call history)
        const historicalToolCalls = await client.getToolCalls(runId, {
          fromStep: 0,
          limit: 500,
        });
        historicalToolCalls.forEach(appendToolCall);

        // Step 3: Connect SSE Stream if RUNNING
        if (runData.status === "RUNNING") {
          setSseStatus("connecting");
          unsubscribeRef.current = client.subscribeRunStream(
            runId,
            {
              onThought: (e) => appendThought(e),
              onToolCall: (e) => appendToolCall(e),
              onStatusChanged: (e) => {
                setRun({ ...runData, status: e.status });
              },
              onVerdict: (_e) => {
                client
                  .getRun(runId)
                  .then(setRun)
                  .catch(() => {});
              },
              onCompleted: () => {
                setSseStatus("offline");
                client
                  .getRun(runId)
                  .then(setRun)
                  .catch(() => {});
              },
              onError: () => setSseStatus("reconnecting"),
            },
            { fromStep: historicalToolCalls.length },
          );
          setSseStatus("connected");
        } else {
          setSseStatus("offline");
        }
      } catch (err) {
        console.error("Initialization error in TraceView:", err);
        setSseStatus("offline");
      }
    }

    initialize();

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [runId]);

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
      <TraceHeader run={currentRun} />

      {currentRun?.verdict && <VerdictBanner verdict={currentRun.verdict} />}

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

        {toolCalls.length === 0 ? (
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
