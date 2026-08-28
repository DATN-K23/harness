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

OpenAPI.BASE = "http://127.0.0.1:3000";

// Custom class to mimic the old SDK interface for SSE
export class CustomAuditClient {
  public async getRun(runId: string) {
    return RunsService.getRunApiV1RunsRunIdGet(runId);
  }

  public async getToolCalls(
    runId: string,
    options: { fromStep: number; limit: number },
  ) {
    return RunsService.getToolCallsApiV1RunsRunIdToolCallsGet(
      runId,
      options.fromStep,
      options.limit,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public cancelRun(_runId: string) {
    // Mock implementation for cancelRun
    return Promise.resolve({ success: true });
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
    const url = new URL(`${OpenAPI.BASE}/api/v1/runs/${runId}/stream`);
    url.searchParams.set("from_step", options.fromStep.toString());
    const eventSource = new EventSource(url.toString());

    if (callbacks.onopen) eventSource.onopen = callbacks.onopen;
    if (callbacks.onError) eventSource.onerror = callbacks.onError;

    eventSource.addEventListener("thought", (e: MessageEvent<string>) => {
      if (callbacks.onThought)
        callbacks.onThought(JSON.parse(e.data) as ThoughtEvent);
    });
    eventSource.addEventListener("tool_call", (e: MessageEvent<string>) => {
      if (callbacks.onToolCall)
        callbacks.onToolCall(JSON.parse(e.data) as ToolCallSchema);
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
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }
}

const AuditHarnessClientContext = createContext<CustomAuditClient | null>(null);

export function AuditHarnessClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = useMemo(() => new CustomAuditClient(), []);

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
