import { createContext, useContext, useMemo } from "react";
import {
  OpenAPI,
  RunsService,
  type VerdictSchema,
  type ToolCallSchema,
} from "../generated/api/index.js";
import type { ThoughtEvent } from "../stores/run.store.js";

/**
 * AuditHarnessClientContext wraps the generated openapi client configuration
 */

function withTimeout<T>(promise: Promise<T>, timeoutMs = 10000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`Audit client request timed out after ${timeoutMs}ms`),
          ),
        timeoutMs,
      ),
    ),
  ]);
}

// Custom class to mimic the old SDK interface for SSE
export class CustomAuditClient {
  public async getRun(runId: string) {
    return withTimeout(RunsService.getRunApiV1RunsRunIdGet(runId), 10000);
  }

  public async getToolCalls(
    runId: string,
    options: { fromStep: number; limit: number },
  ) {
    return withTimeout(
      RunsService.getToolCallsApiV1RunsRunIdToolCallsGet(
        runId,
        options.fromStep,
        options.limit,
      ),
      10000,
    );
  }

  public cancelRun(runId: string) {
    // Backend cancel endpoint placeholder
    return Promise.resolve({ success: true, runId });
  }

  public subscribeRunStream(
    runId: string,
    callbacks: {
      onopen?: (e: Event) => void;
      onError?: (e: Event) => void;
      onThought?: (data: ThoughtEvent) => void;
      onToolCall?: (data: ToolCallSchema) => void;
      onStatusChanged?: (data: { status: string }) => void;
      onVerdict?: (data: VerdictSchema) => void;
      onCompleted?: (data: { totalDurationMs?: number }) => void;
    },
    options: { fromStep: number },
  ) {
    let eventSource: EventSource | null = null;
    let isClosed = false;
    let currentStep = options.fromStep;
    let retryCount = 0;
    const MAX_RETRIES = 10;
    let reconnectTimeoutId: NodeJS.Timeout;

    const connect = () => {
      if (isClosed) return;

      const url = new URL(`${OpenAPI.BASE}/api/v1/runs/${runId}/stream`);
      url.searchParams.set("from_step", currentStep.toString());
      eventSource = new EventSource(url.toString());

      eventSource.onopen = (e) => {
        retryCount = 0; // reset on successful connection
        if (callbacks.onopen) callbacks.onopen(e);
      };

      eventSource.onerror = (e) => {
        if (eventSource) {
          eventSource.close();
        }
        if (callbacks.onError) callbacks.onError(e);

        if (retryCount >= MAX_RETRIES) {
          return;
        }

        retryCount++;
        const backoffMs = Math.min(1000 * Math.pow(2, retryCount - 1), 30000);
        reconnectTimeoutId = setTimeout(() => connect(), backoffMs);
      };

      eventSource.addEventListener("thought", (e: MessageEvent<string>) => {
        const data = JSON.parse(e.data) as ThoughtEvent;
        if (data.stepIndex !== undefined && data.stepIndex > currentStep) {
          currentStep = data.stepIndex;
        }
        if (callbacks.onThought) callbacks.onThought(data);
      });

      eventSource.addEventListener("tool_call", (e: MessageEvent<string>) => {
        const data = JSON.parse(e.data) as ToolCallSchema;
        if (data.stepIndex !== undefined && data.stepIndex > currentStep) {
          currentStep = data.stepIndex;
        }
        if (callbacks.onToolCall) callbacks.onToolCall(data);
      });

      eventSource.addEventListener(
        "status_changed",
        (e: MessageEvent<string>) => {
          if (callbacks.onStatusChanged)
            callbacks.onStatusChanged(JSON.parse(e.data) as { status: string });
        },
      );

      eventSource.addEventListener("verdict", (e: MessageEvent<string>) => {
        if (callbacks.onVerdict)
          callbacks.onVerdict(JSON.parse(e.data) as VerdictSchema);
      });

      eventSource.addEventListener("completed", (e: MessageEvent<string>) => {
        if (callbacks.onCompleted)
          callbacks.onCompleted(
            JSON.parse(e.data) as { totalDurationMs?: number },
          );
        isClosed = true;
        if (eventSource) eventSource.close();
      });
    };

    connect();

    return () => {
      isClosed = true;
      clearTimeout(reconnectTimeoutId);
      if (eventSource) {
        eventSource.close();
      }
    };
  }
}

const AuditHarnessClientContext = createContext<CustomAuditClient | null>(null);

export function AuditHarnessClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = useMemo(() => {
    OpenAPI.BASE = "http://127.0.0.1:3000";
    return new CustomAuditClient();
  }, []);

  return (
    <AuditHarnessClientContext.Provider value={client}>
      {children}
    </AuditHarnessClientContext.Provider>
  );
}

export function useAuditHarnessClient(): CustomAuditClient {
  const client = useContext(AuditHarnessClientContext);
  if (!client) {
    throw new Error(
      "useAuditHarnessClient phải được dùng bên trong <AuditHarnessClientProvider>",
    );
  }
  return client;
}
