import { useEffect, useRef, useState, useCallback } from "react";
import { useAuditHarnessClient } from "./useAuditHarnessClient.js";
import { useRunStore } from "../stores/run.store.js";
import { useReplayStore } from "../stores/replay.store.js";
import type {
  VerdictSchema,
  EvidenceSchema,
  ToolCallSchema,
} from "../generated/api/index.js";

export interface TraceModelEvent {
  id: string;
  stepIndex: number;
  eventType: string;
  content: string;
  runId?: string;
}

export function useTraceData(runId: string, mode: "live" | "demo" = "live") {
  const client = useAuditHarnessClient();
  const {
    currentRun,
    toolCalls,
    modelEvents,
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
          (p["schema_version"] as string) ||
          (p["schemaVersion"] as string) ||
          "judge-verdict-v1",
        validity: (p["validity"] as string) || "invalid",
        severity: (p["severity"] as string) || "none",
        confidence: (p["confidence"] as number) ?? 0,
        rationale: (p["rationale"] as string) || "",
        evidence: (p["evidence"] as EvidenceSchema[]) || [],
        verificationStatus: (p["verificationStatus"] as string) || "unverified",
        labelNormalizationVersion:
          (p["label_normalization_version"] as string) ||
          (p["labelNormalizationVersion"] as string) ||
          "v1.0",
      });
    } else {
      setDemoVerdict(null);
    }
  }, [mode, currentStep, events]);

  // ---------- DEMO MODE: Đọc tool calls & thoughts từ replay events ----------
  const demoToolCalls: ToolCallSchema[] = events
    .slice(0, currentStep + 1)
    .filter((e) => e.type === "step:tool_call")
    .map((e, idx) => {
      const p = e.payload;
      return {
        id: `demo-tc-${idx}`,
        runId: "demo-run-01",
        stepIndex: (p["stepIndex"] as number) ?? idx + 1,
        toolName: (p["toolName"] as string) || "unknown_tool",
        argumentsJson: (p["argumentsJson"] as string) || "{}",
        resultJson: (p["resultJson"] as string) || "{}",
        isError: Boolean(p["isError"]),
        durationMs: (p["durationMs"] as number) ?? 0,
        tokensUsed: (p["tokensUsed"] as number) ?? 0,
      };
    });

  const demoModelEvents: TraceModelEvent[] = events
    .slice(0, currentStep + 1)
    .filter((e) => e.type === "step:thought")
    .map((e, idx) => {
      const p = e.payload;
      return {
        id: `demo-thought-${idx}`,
        runId: "demo-run-01",
        stepIndex: (p["stepIndex"] as number) ?? idx + 1,
        eventType: "THOUGHT",
        content: (p["thought"] as string) || (p["content"] as string) || "",
      };
    });

  // ---------- LIVE MODE: Fetch & Subscribe ----------
  const fetchAndSubscribe = useCallback(
    async (isCancelled: () => boolean) => {
      setIsLoading(true);
      setError(null);
      reset();

      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }

      try {
        // Step 1: REST GET /api/v1/runs/:id (Hydrate run metadata)
        const runData = await client.getRun(runId);
        if (isCancelled()) return;
        setRun(runData);

        // Step 2: REST GET /api/v1/runs/:id/tool-calls (Hydrate full history)
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
    },
    [
      client,
      runId,
      reset,
      setRun,
      appendToolCall,
      setSseStatus,
      appendThought,
      setRunStatus,
    ],
  );

  useEffect(() => {
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
  }, [runId, mode, fetchAndSubscribe, setSseStatus]);

  const refetch = useCallback(() => {
    void fetchAndSubscribe(() => false);
  }, [fetchAndSubscribe]);

  const displayToolCalls = mode === "demo" ? demoToolCalls : toolCalls;
  const displayModelEvents =
    mode === "demo"
      ? demoModelEvents
      : modelEvents.filter((e) => e.eventType === "THOUGHT");
  const displayVerdict = mode === "demo" ? demoVerdict : currentRun?.verdict;

  return {
    currentRun,
    displayToolCalls,
    displayModelEvents,
    displayVerdict,
    isLoading,
    error,
    refetch,
  };
}
