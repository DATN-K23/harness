# Technical Specification — TV6: SDK & Contracts Specification (`packages/sdk`)
## Document Identifier: SPEC-TV6-04-SDK-CONTRACTS
**Standard Compliance:** ISO/IEC/IEEE 29148:2018 / ECMAScript 2026 Type Standards  
**Status:** Approved Architectural Specification  
**Track:** TV6 — Application & Demo  

---

## 1. SDK Package Architecture (`packages/sdk`)

Gói `@audit-harness/sdk` đóng vai trò là thư viện client chính thức (Software Development Kit) giúp các ứng dụng client (như `apps/web` hoặc CLI tools) giao tiếp an toàn, chuẩn kiểu dữ liệu (Type-Safe) với NestJS API (`apps/api`).

```text
packages/sdk/
├── src/
│   ├── index.ts                # Public Barrel Export
│   ├── client.ts               # AuditHarnessClient Implementation
│   ├── stream.ts               # SSE Connection Manager (fetch-event-source Wrapper)
│   ├── errors.ts               # SDK Typed Error Taxonomy
│   └── types.ts                # SDK Configuration & Standard Envelope Types
├── package.json
└── tsconfig.json
```

> **Lựa chọn Thư viện**: SDK sử dụng `@microsoft/fetch-event-source` thay vì `EventSource` của trình duyệt goc vì:
> - `EventSource` không cho phép gửi custom HTTP headers (như `Authorization`, `x-request-id`).
> - `EventSource` không hoạt động tốt trong môi trường CLI Node.js.
> - `@microsoft/fetch-event-source` hỗ trợ exponential backoff retry khi mất kết nối và tích hợp sẵn `Last-Event-ID`.

---

## 2. Interface & Public API Contract Specification

```typescript
// file: packages/sdk/src/client.ts

import { Run, Verdict, ToolCall, ModelEvent } from '@audit-harness/contracts';
import { fetchEventSource } from '@microsoft/fetch-event-source';
// StreamConnectionOptions và RunStreamListener được định nghĩa trong file này

export interface ApiSuccessResponse<T> {
  success: true;
  code: number;
  message: string;
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
    pagination?: {
      page: number;
      pageSize: number;
      totalItems: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  };
}

export interface ApiErrorResponse {
  success: false;
  code: number;
  error: {
    code: string;
    message: string;
    details?: Array<{ field?: string; issue: string }>;
  };
  meta: {
    requestId: string;
    timestamp: string;
    path: string;
  };
}

export interface AuditHarnessClientOptions {
  baseUrl: string; // e.g. "http://localhost:3000"
  apiKey?: string; // Bearer token cho Authorization header (nếu API yêu cầu)
  timeoutMs?: number;
}

export interface CreateRunParams {
  title: string;
  targetRepository: string;
  findingId: string;
  config?: {
    modelProvider?: string;
    modelName?: string;
    temperature?: number;
    maxSteps?: number;
  };
}

export interface StreamConnectionOptions {
  /**
   * Nếu có, SDK sẽ yêu cầu API replay các event có stepIndex > fromStep trước
   * khi subscribe live stream (hỗ trợ phục hồi sau khi mất kết nối).
   */
  fromStep?: number;
  /** Thời gian chờ tối đa giữa 2 lần retry (ms). Mặc định: 30_000 ms */
  maxRetryMs?: number;
}

// ============================================================
// Typed Event Payloads (khớp với bảng ánh xạ tại SPEC-TV6-01 mục 4.1)
// ============================================================

/** Typed payload cho SSE event `step:thought` */
export interface ThoughtEvent {
  runId: string;
  stepIndex: number;
  thought: string;
  tokensUsed: number;
}

/** Typed payload cho SSE event `step:tool_call` */
export interface ToolCallEvent {
  runId: string;
  stepIndex: number;
  toolName: string;
  arguments?: Record<string, unknown>;
  result?: string;
  isError: boolean;
  durationMs: number;
  tokensUsed: number;
}

/** Typed payload cho SSE event `run:status_changed` */
export interface StatusChangedEvent {
  runId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  timestamp: string;
}

/** Typed payload cho SSE event `run:verdict` */
export interface VerdictEvent {
  runId: string;
  verdict: {
    status: 'VALID' | 'INVALID' | 'UNVERIFIED';
    severity: string;
    confidenceScore: number;
    explanation: string;
    pocResult?: string;
  };
}

/** Typed payload cho SSE event `run:completed` */
export interface CompletedEvent {
  runId: string;
  totalDurationMs: number;
  totalTokensUsed: number;
  totalCostUsd: number;
}

/**
 * Interface callbacks cho toàn bộ SSE events của một Audit Run.
 * Tất cả callback là optional — chỉ khai báo các event cần lắng nghe.
 */
export interface RunStreamListener {
  onThought?: (data: ThoughtEvent) => void;
  onToolCall?: (data: ToolCallEvent) => void;
  onStatusChanged?: (data: StatusChangedEvent) => void;
  onVerdict?: (data: VerdictEvent) => void;
  onCompleted?: (data: CompletedEvent) => void;
  onError?: (error: unknown) => void;
}

export class AuditHarnessClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: AuditHarnessClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...(options.apiKey && { 'Authorization': `Bearer ${options.apiKey}` }),
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        ...this.defaultHeaders,
        ...init?.headers,
      },
    });

    const body = (await res.json()) as ApiSuccessResponse<T> | ApiErrorResponse;

    if (!res.ok || !body.success) {
      const errorBody = body as ApiErrorResponse;
      throw new Error(
        `[${errorBody.error?.code || 'ERR_API'}] ${errorBody.error?.message || res.statusText}`
      );
    }

    return (body as ApiSuccessResponse<T>).data;
  }

  // REST Method: Create a new Audit Run
  public async createRun(params: CreateRunParams): Promise<Run> {
    return this.request<Run>('/api/v1/runs', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // REST Method: Get details of a single run
  public async getRun(runId: string): Promise<Run> {
    return this.request<Run>(`/api/v1/runs/${runId}`);
  }

  // REST Method: List runs with pagination
  public async listRuns(query?: { page?: number; pageSize?: number; status?: string }): Promise<Run[]> {
    const searchParams = new URLSearchParams(query as any).toString();
    return this.request<Run[]>(`/api/v1/runs?${searchParams}`);
  }

  // REST Method: Lấy lịch sử Tool Calls của một Run (dùng cho Page Recovery)
  public async getToolCalls(
    runId: string,
    query?: { fromStep?: number; limit?: number },
  ): Promise<ToolCall[]> {
    const params = new URLSearchParams();
    if (query?.fromStep !== undefined) params.set('fromStep', String(query.fromStep));
    if (query?.limit !== undefined) params.set('limit', String(query.limit));
    const qs = params.toString();
    return this.request<ToolCall[]>(`/api/v1/runs/${runId}/tool-calls${qs ? `?${qs}` : ''}`);
  }

  // REST Method: Lấy lịch sử Model Events (THOUGHT) của một Run (dùng cho Page Recovery)
  public async getModelEvents(
    runId: string,
    query?: { fromStep?: number; limit?: number },
  ): Promise<ModelEvent[]> {
    const params = new URLSearchParams();
    if (query?.fromStep !== undefined) params.set('fromStep', String(query.fromStep));
    if (query?.limit !== undefined) params.set('limit', String(query.limit));
    const qs = params.toString();
    return this.request<ModelEvent[]>(`/api/v1/runs/${runId}/model-events${qs ? `?${qs}` : ''}`);
  }

  // REST Method: Hủy bỏ một Audit Run đang chạy
  public async cancelRun(runId: string): Promise<Run> {
    return this.request<Run>(`/api/v1/runs/${runId}/cancel`, {
      method: 'POST',
      headers: {
        'x-request-id': `req_cancel_${Date.now()}`,
      },
    });
  }

  /**
   * SSE Method: Đăng ký nhận sự kiện real-time của một Audit Run.
   *
   * Sử dụng `@microsoft/fetch-event-source` thay vì `EventSource` goc để:
   * - Gửi được custom HTTP headers (Authorization, x-request-id, Last-Event-ID).
   * - Tự động quản lý exponential backoff retry khi mất kết nối SSE.
   * - Tương thích hoàn toàn với Node.js CLI (không dùng browser API).
   *
   * @returns Hàm `unsubscribe` — gọi để đóng kết nối SSE và dừng retry.
   */
  public subscribeRunStream(
    runId: string,
    listener: RunStreamListener,
    options?: StreamConnectionOptions
  ): () => void {
    const abortController = new AbortController();

    // Xây dựng URL với fromStep nếu có
    const url = new URL(`${this.baseUrl}/api/v1/runs/${runId}/stream`);
    if (options?.fromStep !== undefined) {
      url.searchParams.set('fromStep', String(options.fromStep));
    }

    // Static import (khai báo ở đầu file) — đảm bảo AbortController hoạt động ngay cả khi unsubscribe() được gọi trước khi kết nối mở
    void fetchEventSource(url.toString(), {
        headers: {
          ...this.defaultHeaders,
          // Cho phép client gửi `Last-Event-ID` tự động và manual
          ...(options?.fromStep !== undefined && {
            'Last-Event-ID': String(options.fromStep),
          }),
        },
        signal: abortController.signal,
        onopen: async (response) => {
          if (!response.ok) {
            throw new Error(`SSE connection failed: HTTP ${response.status}`);
          }
        },
        onmessage: (event) => {
          if (event.event === 'heartbeat') return; // Bỏ qua heartbeat keep-alive
          try {
            const data = JSON.parse(event.data);
            switch (event.event) {
              case 'step:thought':
                listener.onThought?.(data as ThoughtEvent);
                break;
              case 'step:tool_call':
                listener.onToolCall?.(data as ToolCallEvent);
                break;
              case 'run:status_changed':
                listener.onStatusChanged?.(data as StatusChangedEvent);
                break;
              case 'run:verdict':
                listener.onVerdict?.(data as VerdictEvent);
                break;
              case 'run:completed':
                listener.onCompleted?.(data as CompletedEvent);
                abortController.abort(); // Đóng kết nối sau khi hoàn tất
                break;
            }
          } catch (e) {
            listener.onError?.(e);
          }
        },
        onerror: (err) => {
          listener.onError?.(err);
          // fetchEventSource tự động retry với exponential backoff.
          // Ném lỗi để dừng retry nếu muốn:
          // throw err;
        },
        openWhenHidden: true, // Tiếp tục kết nối kể cả khi tab bị ẩn
      });

    return () => {
      abortController.abort();
    };
  }
}
```

---

## 3. Error Handling Taxonomy

Mọi lỗi trả về từ SDK đều thuộc lớp `HarnessSDKError` và được phân loại theo mã lỗi định danh cụ thể:

| Error Code | Class Name | Description |
| :--- | :--- | :--- |
| `ERR_NETWORK_DISCONNECTED` | `NetworkDisconnectedError` | Mất kết nối HTTP hoặc SSE stream rớt |
| `ERR_RUN_NOT_FOUND` | `RunNotFoundError` | `runId` truyền vào không tồn tại trong hệ thống |
| `ERR_STREAM_TIMEOUT` | `StreamTimeoutError` | Mất tín hiệu heartbeat từ SSE stream quá 30 giây |
| `ERR_INVALID_PAYLOAD` | `InvalidPayloadError` | Response DTO không thỏa mãn Zod Schema của SDK |
