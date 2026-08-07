import { fetchEventSource } from "@microsoft/fetch-event-source";
import type {
  Run,
  CreateRunDto,
  ToolCall,
  ModelEvent,
  ApiSuccessResponse,
  ApiErrorResponse,
  PaginationMeta,
} from "@audit-harness/contracts";
import type {
  AuditHarnessClientOptions,
  StreamConnectionOptions,
  RunStreamListener,
  ThoughtEvent,
  ToolCallEvent,
  StatusChangedEvent,
  VerdictEvent,
  CompletedEvent,
  PaginatedResult,
} from "./types.js";
import {
  HarnessSDKError,
  RunNotFoundError,
  NetworkDisconnectedError,
} from "./errors.js";

export class AuditHarnessClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: AuditHarnessClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...(options.apiKey && { Authorization: `Bearer ${options.apiKey}` }),
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          ...this.defaultHeaders,
          ...init?.headers,
        },
      });
    } catch (err) {
      throw new NetworkDisconnectedError(
        "Không thể kết nối đến API Server",
        err,
      );
    }

    const body = (await res.json()) as ApiSuccessResponse<T> | ApiErrorResponse;

    if (!res.ok || !body.success) {
      const errorBody = body as ApiErrorResponse;
      const code = errorBody.error?.code || "ERR_API";
      const message = errorBody.error?.message || res.statusText;
      if (res.status === 404) {
        throw new RunNotFoundError(path);
      }
      throw new HarnessSDKError(code, message, errorBody.error?.details);
    }

    return (body as ApiSuccessResponse<T>).data;
  }

  public async createRun(params: CreateRunDto): Promise<Run> {
    return this.request<Run>("/api/v1/runs", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  public async getRun(runId: string): Promise<Run> {
    return this.request<Run>(`/api/v1/runs/${runId}`);
  }

  /**
   * I3 Fix: Trả PaginatedResult thay vì Run[] thuần để pagination không bị mất.
   * ResponseTransformInterceptor unwrap data nhưng pagination nằm trong meta.
   */
  public async listRuns(query?: {
    page?: number;
    pageSize?: number;
    status?: string;
  }): Promise<PaginatedResult<Run>> {
    const params = new URLSearchParams();
    if (query?.page) params.set("page", String(query.page));
    if (query?.pageSize) params.set("pageSize", String(query.pageSize));
    if (query?.status) params.set("status", query.status);
    const qs = params.toString();

    const url = `${this.baseUrl}/api/v1/runs${qs ? `?${qs}` : ""}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: this.defaultHeaders });
    } catch (err) {
      throw new NetworkDisconnectedError("Không thể kết nối đến API Server", err);
    }
    const body = (await res.json()) as ApiSuccessResponse<Run[]> | ApiErrorResponse;
    if (!res.ok || !body.success) {
      const errorBody = body as ApiErrorResponse;
      throw new HarnessSDKError(
        errorBody.error?.code || "ERR_API",
        errorBody.error?.message || res.statusText,
      );
    }
    const successBody = body as ApiSuccessResponse<Run[]>;
    return {
      items: successBody.data,
      pagination: successBody.meta.pagination as PaginationMeta,
    };
  }

  public async getToolCalls(
    runId: string,
    query?: { fromStep?: number; limit?: number },
  ): Promise<ToolCall[]> {
    const params = new URLSearchParams();
    if (query?.fromStep !== undefined)
      params.set("fromStep", String(query.fromStep));
    if (query?.limit !== undefined) params.set("limit", String(query.limit));
    const qs = params.toString();
    return this.request<ToolCall[]>(
      `/api/v1/runs/${runId}/tool-calls${qs ? `?${qs}` : ""}`,
    );
  }

  public async getModelEvents(
    runId: string,
    query?: { fromStep?: number; limit?: number },
  ): Promise<ModelEvent[]> {
    const params = new URLSearchParams();
    if (query?.fromStep !== undefined)
      params.set("fromStep", String(query.fromStep));
    if (query?.limit !== undefined) params.set("limit", String(query.limit));
    const qs = params.toString();
    return this.request<ModelEvent[]>(
      `/api/v1/runs/${runId}/model-events${qs ? `?${qs}` : ""}`,
    );
  }

  public async cancelRun(runId: string): Promise<Run> {
    // W5 Fix: x-request-id bắt buộc theo spec để đảm bảo idempotency trace
    const requestId = `req_cancel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return this.request<Run>(`/api/v1/runs/${runId}/cancel`, {
      method: "POST",
      headers: {
        "x-request-id": requestId,
      },
    });
  }

  public subscribeRunStream(
    runId: string,
    listener: RunStreamListener,
    options?: StreamConnectionOptions,
  ): () => void {
    const abortController = new AbortController();
    const url = new URL(`${this.baseUrl}/api/v1/runs/${runId}/stream`);
    if (options?.fromStep !== undefined) {
      url.searchParams.set("fromStep", String(options.fromStep));
    }

    void fetchEventSource(url.toString(), {
      headers: {
        ...this.defaultHeaders,
        ...(options?.fromStep !== undefined && {
          "Last-Event-ID": String(options.fromStep),
        }),
      },
      signal: abortController.signal,
      onopen: async (response) => {
        if (!response.ok) {
          throw new NetworkDisconnectedError(
            `SSE connection failed: HTTP ${response.status}`,
          );
        }
        // C4 Fix: onopen gọi sau khi HTTP 200 xác nhận — đảm bảo
        // không có race condition với onError
        listener.onopen?.();
      },
      onmessage: (event) => {
        if (event.event === "heartbeat") return;
        try {
          const data = JSON.parse(event.data);
          switch (event.event) {
            case "step:thought":
              listener.onThought?.(data as ThoughtEvent);
              break;
            case "step:tool_call":
              listener.onToolCall?.(data as ToolCallEvent);
              break;
            case "run:status_changed":
              listener.onStatusChanged?.(data as StatusChangedEvent);
              break;
            case "run:verdict":
              listener.onVerdict?.(data as VerdictEvent);
              break;
            case "run:completed":
              listener.onCompleted?.(data as CompletedEvent);
              abortController.abort();
              break;
          }
        } catch (e) {
          listener.onError?.(e);
        }
      },
      onerror: (err) => {
        listener.onError?.(err);
      },
      openWhenHidden: true,
    });

    return () => {
      abortController.abort();
    };
  }
}
