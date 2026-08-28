import { createContext, useContext, useMemo } from "react";
import { OpenAPI, RunsService } from "../generated/api/index.js";

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

  public async cancelRun(runId: string) {
    // Mock implementation for cancelRun
    return { success: true };
  }

  public subscribeRunStream(
    runId: string,
    callbacks: any,
    options: { fromStep: number },
  ) {
    const url = new URL(`${OpenAPI.BASE}/api/v1/runs/${runId}/stream`);
    url.searchParams.set("from_step", options.fromStep.toString());
    const eventSource = new EventSource(url.toString());

    eventSource.onopen = callbacks.onopen;
    eventSource.onerror = callbacks.onError;

    eventSource.addEventListener("thought", (e: any) => {
      if (callbacks.onThought) callbacks.onThought(JSON.parse(e.data));
    });
    eventSource.addEventListener("tool_call", (e: any) => {
      if (callbacks.onToolCall) callbacks.onToolCall(JSON.parse(e.data));
    });
    eventSource.addEventListener("status_changed", (e: any) => {
      if (callbacks.onStatusChanged)
        callbacks.onStatusChanged(JSON.parse(e.data));
    });
    eventSource.addEventListener("verdict", (e: any) => {
      if (callbacks.onVerdict) callbacks.onVerdict(JSON.parse(e.data));
    });
    eventSource.addEventListener("completed", (e: any) => {
      if (callbacks.onCompleted) callbacks.onCompleted(JSON.parse(e.data));
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
