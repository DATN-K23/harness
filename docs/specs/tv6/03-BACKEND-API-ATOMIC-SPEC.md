# Technical Specification — TV6: Backend API Atomic Specification (`apps/api`)
## Document Identifier: SPEC-TV6-03-BACKEND-API-ATOMIC
**Standard Compliance:** ISO/IEC/IEEE 29148:2018 / OpenAPI 3.0 / RFC 7807 (Problem Details for HTTP APIs)  
**Status:** Approved Architectural Specification  
**Track:** TV6 — Application & Demo  

---

## 1. NestJS Architecture & Module Organization

Backend API Service `apps/api` được tổ chức theo tiêu chuẩn của NestJS Framework, đảm bảo tính mô-đun hóa cao, dễ kiểm thử unit/integration và bảo trì trong 12 tháng.

```text
apps/api/src/
├── main.ts                     # Entry point & Bootstrap (Global Prefix: /api/v1)
├── app.module.ts               # Root Application Module
├── common/
│   ├── filters/                # Global HttpExceptionFilter (RFC 7807)
│   ├── interceptors/           # ResponseTransformInterceptor (Standard Envelope)
│   └── pipes/                  # ZodValidationPipe
├── modules/
│   ├── prisma/                 # PrismaModule & PrismaService
│   ├── run/
│   │   ├── run.module.ts       # Run Management Module
│   │   ├── run.controller.ts   # REST Endpoints for Runs
│   │   ├── run.service.ts      # Run Business Logic
│   │   └── dto/                # CreateRunDto, RunResponseDto, QueryRunDto
│   ├── stream/
│   │   ├── stream.module.ts    # SSE Streaming Module
│   │   ├── stream.controller.ts# SSE Stream Controller
│   │   └── stream.service.ts   # RxJS Subject Event Emitter
│   └── demo/
│       ├── demo.module.ts      # Demo Mode Module
│       ├── demo.controller.ts  # Demo Simulation Controller
│       └── demo.service.ts     # Offline Replay Event Streamer
└── config/                     # Environment Configuration
```

---

## 2. Chuẩn hóa Định dạng API (Standardized API Envelope Specification)

Toàn bộ các API HTTP REST của hệ thống bắt buộc tuân theo cấu trúc **Standard Response Envelope** đồng nhất 100% cho tất cả các phản hồi Thành công (Success) và Phản hồi Lỗi (Error).

### 2.1 Cấu trúc Phản hồi Thành công Nguyên tử (Standard Success Envelope)

```typescript
export interface ApiSuccessResponse<T> {
  success: true;
  code: number;          // HTTP Status Code (200, 201)
  message: string;        // Human-readable summary message
  data: T;                // Main payload typed object or array
  meta: {
    requestId: string;    // Unique UUID tracing per HTTP request
    timestamp: string;    // ISO 8601 UTC timestamp
    pagination?: {        // Conditional pagination metadata for list endpoints
      page: number;
      pageSize: number;
      totalItems: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  };
}
```

### 2.2 Cấu trúc Phản hồi Lỗi Nguyên tử (Standard Error Envelope - RFC 7807)

```typescript
export interface ApiErrorDetail {
  field?: string;         // Name of the invalid property/field
  issue: string;          // Specific validation issue or error reason
}

export interface ApiErrorResponse {
  success: false;
  code: number;           // HTTP Error Status Code (400, 404, 422, 500)
  error: {
    code: string;         // Machine-readable Error Code (e.g. ERR_RUN_NOT_FOUND)
    message: string;      // Human-readable summary error description
    details?: ApiErrorDetail[]; // Optional array of field-level validation errors
  };
  meta: {
    requestId: string;    // Unique UUID tracing per HTTP request
    timestamp: string;    // ISO 8601 UTC timestamp
    path: string;         // Endpoint URI path requested
  };
}
```

---

## 3. Danh mục REST API Endpoint Chi tiết (API v1 Catalog)

Tất cả các API route đều có tiền tố phiên bản: `/api/v1`.

### 3.1 Endpoint: Khởi tạo Audit Run Mới
- **Route**: `POST /api/v1/runs`
- **Request Headers**: `Content-Type: application/json`
- **Request Body (JSON)**:
  ```json
  {
    "title": "Reentrancy Verification on Vault.sol",
    "targetRepository": "code4rena/2026-05-vault",
    "findingId": "H-01",
    "config": {
      "modelProvider": "anthropic",
      "modelName": "claude-3-5-sonnet",
      "temperature": 0.0,
      "maxSteps": 30,
      "enableMemory": true,
      "enableVerification": true
    }
  }
  ```
- **Response Success (201 Created)**:
  ```json
  {
    "success": true,
    "code": 201,
    "message": "Audit run initiated successfully",
    "data": {
      "id": "c7a9f82d-8b1e-4f2a-9e12-8a9d3e5f7b11",
      "title": "Reentrancy Verification on Vault.sol",
      "targetRepository": "code4rena/2026-05-vault",
      "findingId": "H-01",
      "status": "PENDING",
      "createdAt": "2026-07-31T23:05:00.000Z"
    },
    "meta": {
      "requestId": "req_8f12a3bc-9102-4e89-a112-990112345678",
      "timestamp": "2026-07-31T23:05:00.120Z"
    }
  }
  ```
- **Response Error Example (400 Bad Request)**:
  ```json
  {
    "success": false,
    "code": 400,
    "error": {
      "code": "ERR_VALIDATION_FAILED",
      "message": "Invalid request body parameters",
      "details": [
        {
          "field": "targetRepository",
          "issue": "targetRepository must be a valid GitHub repository path format"
        }
      ]
    },
    "meta": {
      "requestId": "req_8f12a3bc-9102-4e89-a112-990112345678",
      "timestamp": "2026-07-31T23:05:00.125Z",
      "path": "/api/v1/runs"
    }
  }
  ```

### 3.2 Endpoint: Lấy Danh sách Audit Runs (Có Phân trang & Lọc)
- **Route**: `GET /api/v1/runs?page=1&pageSize=10&status=COMPLETED&search=Vault`
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "code": 200,
    "message": "Runs retrieved successfully",
    "data": [
      {
        "id": "c7a9f82d-8b1e-4f2a-9e12-8a9d3e5f7b11",
        "title": "Reentrancy Verification on Vault.sol",
        "targetRepository": "code4rena/2026-05-vault",
        "findingId": "H-01",
        "status": "COMPLETED",
        "totalDurationMs": 142000,
        "totalTokensUsed": 38400,
        "createdAt": "2026-07-31T23:00:00.000Z"
      }
    ],
    "meta": {
      "requestId": "req_1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "timestamp": "2026-07-31T23:06:00.045Z",
      "pagination": {
        "page": 1,
        "pageSize": 10,
        "totalItems": 1,
        "totalPages": 1,
        "hasNextPage": false,
        "hasPreviousPage": false
      }
    }
  }
  ```

### 3.3 Endpoint: Chi tiết Một Audit Run
- **Route**: `GET /api/v1/runs/:id`
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "code": 200,
    "message": "Run details retrieved successfully",
    "data": {
      "id": "c7a9f82d-8b1e-4f2a-9e12-8a9d3e5f7b11",
      "title": "Reentrancy Verification on Vault.sol",
      "targetRepository": "code4rena/2026-05-vault",
      "findingId": "H-01",
      "status": "COMPLETED",
      "totalDurationMs": 142000,
      "totalTokensUsed": 38400,
      "totalCostUsd": 0.115,
      "configSnapshot": {
        "modelProvider": "anthropic",
        "modelName": "claude-3-5-sonnet",
        "temperature": 0.0,
        "maxSteps": 30,
        "enableMemory": true,
        "enableVerification": true
      },
      "verdict": {
        "status": "VALID",
        "severity": "HIGH",
        "confidenceScore": 0.98,
        "explanation": "PoC test passed confirming balance manipulation via reentrancy.",
        "pocResult": "PASS"
      }
    },
    "meta": {
      "requestId": "req_99887766-5544-3322-1100-aabbccddeeff",
      "timestamp": "2026-07-31T23:06:10.012Z"
    }
  }
  ```
- **Response Error (404 Not Found)**:
  ```json
  {
    "success": false,
    "code": 404,
    "error": {
      "code": "ERR_RUN_NOT_FOUND",
      "message": "Run with ID 'invalid-id' was not found"
    },
    "meta": {
      "requestId": "req_99887766-5544-3322-1100-aabbccddeeff",
      "timestamp": "2026-07-31T23:06:10.015Z",
      "path": "/api/v1/runs/invalid-id"
    }
  }
  ```

### 3.4 Endpoint: Lấy Danh sách Tool Calls của 1 Run
- **Route**: `GET /api/v1/runs/:id/tool-calls?fromStep=0&limit=50`
- **Query Params**: `fromStep` (số bước bắt đầu, inclusive, mặc định 0), `limit` (số kết quả tối đa, mặc định 50, max 200)
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "code": 200,
    "message": "Tool calls retrieved successfully",
    "data": [
      {
        "id": "tc_01",
        "stepIndex": 1,
        "toolName": "read_file",
        "argumentsJson": "{\"path\":\"contracts/Vault.sol\"}",
        "resultJson": "{\"content\":\"contract Vault { ... }\"}",
        "isError": false,
        "durationMs": 45,
        "tokensUsed": 320,
        "timestamp": "2026-07-31T23:01:00.000Z"
      }
    ],
    "meta": {
      "requestId": "req_77665544-3322-1100-0011-223344556677",
      "timestamp": "2026-07-31T23:06:15.000Z",
      "pagination": {
        "page": 1,
        "pageSize": 50,
        "totalItems": 142,
        "totalPages": 3,
        "hasNextPage": true,
        "hasPreviousPage": false
      }
    }
  }
  ```

### 3.4b Endpoint: Lấy Danh sách Model Events (THOUGHT) của 1 Run
- **Route**: `GET /api/v1/runs/:id/model-events?fromStep=0&limit=50`
- **Mục đích**: Dùng cho Page Recovery — sau F5, `TraceView` cần lấy lịch sử `THOUGHT` (được lưu trong bảng `ModelEvent`, không phải `ToolCall`).
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "code": 200,
    "message": "Model events retrieved successfully",
    "data": [
      {
        "id": "me_01",
        "stepIndex": 1,
        "eventType": "THOUGHT",
        "content": "Analyzing Reentrancy vulnerability in Deposit.sol line 45...",
        "tokensUsed": 120,
        "timestamp": "2026-07-31T23:01:00.500Z"
      }
    ],
    "meta": {
      "requestId": "req_aabbccdd-eeff-0011-2233-445566778899",
      "timestamp": "2026-07-31T23:06:16.000Z"
    }
  }
  ```

### 3.5 Endpoint: Export Dữ liệu Trajectory
- **Route**: `GET /api/v1/runs/:id/export?format=json`
- **Response (200 OK)**: Trả về tập tin đính kèm `Header: Content-Disposition: attachment; filename="run-c7a9f82d-export.json"`.

### 3.6 Endpoint: Hủy Bỏ Audit Run đang Chạy (Cancel Run)
- **Route**: `POST /api/v1/runs/:id/cancel`
- **Request Headers**: `x-request-id: req_<uuid>` (bắt buộc để trace idempotency).
- **Response Success (200 OK)**: Trả về Run object đã được cập nhật:
  ```json
  {
    "success": true,
    "code": 200,
    "message": "Audit run cancelled successfully",
    "data": {
      "id": "c7a9f82d-8b1e-4f2a-9e12-8a9d3e5f7b11",
      "status": "CANCELLED",
      "completedAt": "2026-07-31T23:10:00.000Z"
    },
    "meta": {
      "requestId": "req_cancel-12345",
      "timestamp": "2026-07-31T23:10:00.050Z"
    }
  }
  ```
- **Response Error (409 Conflict)** — Nếu Run đã kết thúc:
  ```json
  {
    "success": false,
    "code": 409,
    "error": {
      "code": "ERR_RUN_ALREADY_TERMINAL",
      "message": "Run 'c7a9f82d' is already in a terminal state: COMPLETED"
    },
    "meta": {
      "requestId": "req_cancel-12345",
      "timestamp": "2026-07-31T23:10:00.055Z",
      "path": "/api/v1/runs/c7a9f82d-8b1e-4f2a-9e12-8a9d3e5f7b11/cancel"
    }
  }
  ```
- **Cơ chế dừng Agent Worker**:
  1. NestJS `RunController` nhận request → gọi `RunService.cancelRun(runId)`.
  2. `RunService` gọi `auditQueue.getJob(runId)` → nếu job chưa active (`waiting`/`delayed`) thì gọi `job.remove()`. Nếu đang `active`, không thể kill từ API — cần Worker tự dừng.
  3. `RunService` cập nhật `run.status = 'CANCELLED'` trong DB.
  4. `apps/worker`: ở mỗi đầu vòng lặp Agent Loop, Worker kiểm tra `prisma.run.findUnique(runId).status` — nếu `CANCELLED` thì dừng vòng lặp, emit event `run:status_changed` với `status: 'CANCELLED'`.

> [!WARNING]
> **⚠️ PITFALL — Race Condition giữa Cancel và Completed (I3)**:
> Khi API nhận request Cancel đúng thời điểm Worker đang hoàn thành bước suy luận cuối cùng:
> 1. Nếu Worker ghi `COMPLETED` vào DB trước khi API ghi `CANCELLED`, `cancelRun()` của API sẽ trả về `409 Conflict` (Run already terminal).
> 2. Nếu API ghi `CANCELLED` vào DB trong khi Worker vừa đọc xong status `RUNNING` ở đầu bước cuối, Worker có thể phát event `run:completed` lên Redis trước khi dừng process.
>
> **Quy tắc Eventual Consistency**: Client SDK phải xem `status: CANCELLED` trong DB là nguồn sự thật cuối cùng (source of truth). Nếu nhận `run:completed` qua SSE nhưng state trong DB là `CANCELLED`, UI giữ nguyên trạng thái `CANCELLED`.


### 3.7 Endpoint: Health Check Hệ thống
- **Route**: `GET /api/v1/health`
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "code": 200,
    "message": "Audit Harness API Service is healthy",
    "data": {
      "status": "up",
      "database": "connected",
      "worker": "ready",
      "version": "1.0.0",
      "uptimeSeconds": 86400
    },
    "meta": {
      "requestId": "req_health_12345",
      "timestamp": "2026-07-31T23:06:20.000Z"
    }
  }
  ```

---

## 4. Hiện thực hóa NestJS Interceptor & Exception Filter

Để đảm bảo toàn bộ hệ thống NestJS tự động bọc response theo chuẩn trên mà không cần viết lặp lại code ở từng controller:

### 4.1 Global Response Envelope Interceptor (`ResponseTransformInterceptor`)

> **Vấn đề cần xử lý**: Nếu interceptor bao bọc mọi response bằng JSON envelope `{ success: true, data: ... }`, nó sẽ **phá vỡ** (break) 2 loại endpoint:
> - **SSE Stream** (`@Sse()`): Cần giữ nguyên HTTP 200 Keep-Alive `text/event-stream`, không được bọ lớp envelope JSON.
> - **File Download** (`export` CSV/JSON): Cần giữ nguyên `Content-Disposition` header và binary stream.
>
> **Giải pháp**: Sử dụng decorator `@SkipResponseTransform()` để đánh dấu các endpoint này và interceptor sẽ tự động bypass.

```typescript
// file: apps/api/src/common/decorators/skip-response-transform.decorator.ts

import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_TRANSFORM_KEY = 'skipResponseTransform';

/**
 * Gắn decorator này vào bất kỳ endpoint nào cần bypass ResponseTransformInterceptor.
 * Bắt buộc dùng cho: @Sse() stream endpoints và file export endpoints.
 */
export const SkipResponseTransform = () =>
  SetMetadata(SKIP_RESPONSE_TRANSFORM_KEY, true);
```

```typescript
// file: apps/api/src/common/interceptors/response-transform.interceptor.ts

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
 import { Reflector } from '@nestjs/core';
 import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiSuccessResponse } from '../interfaces/api-response.interface';
import { SKIP_RESPONSE_TRANSFORM_KEY } from '../decorators/skip-response-transform.decorator';

@Injectable()
export class ResponseTransformInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T> | T>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Observable<ApiSuccessResponse<T> | T> {
    // Kiểm tra xem endpoint có gắn @SkipResponseTransform() không
    const shouldSkip = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Nếu có — bypass hoàn toàn, giữ nguyên stream (SSE / file download)
    if (shouldSkip) {
      return next.handle();
    }

    const ctx = context.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    return next.handle().pipe(
      map((result) => {
        // Separate data and metadata if returned from service
        const data = result && result.data !== undefined ? result.data : result;
        const pagination = result && result.pagination ? result.pagination : undefined;
        const message = result && result.message ? result.message : 'Operation successful';

        return {
          success: true,
          code: response.statusCode,
          message,
          data,
          meta: {
            requestId: request.headers['x-request-id'] || `req_${Date.now()}`,
            timestamp: new Date().toISOString(),
            ...(pagination && { pagination }),
          },
        };
      })
    );
  }
}
```

**Ví dụ sử dụng `@SkipResponseTransform()` trong controller**:
```typescript
// file: apps/api/src/modules/stream/stream.controller.ts
import { Controller, Param, Sse, MessageEvent, Headers, Query } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SkipResponseTransform } from '../../common/decorators/skip-response-transform.decorator';

@Controller('runs')
export class StreamController {
  @Get(':id/stream')
  @Sse()
  @SkipResponseTransform() // Bắt buộc: Tránh interceptor bao bọc dữ liệu SSE stream
  streamRunEvents(
    @Param('id') runId: string,
    @Query('fromStep') fromStep?: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    // ... (xem mục 5)
  }

  @Get(':id/export')
  @SkipResponseTransform() // Bắt buộc: Tránh interceptor wrap file CSV/JSON download
  exportRunData(@Param('id') runId: string, @Query('format') format: string) {
    // ...
  }
}
```

### 4.2 Global Exception Filter (`HttpExceptionFilter`)

```typescript
// file: apps/api/src/common/filters/http-exception.filter.ts

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiErrorResponse } from '../interfaces/api-response.interface';

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse: any =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error', errorCode: 'ERR_INTERNAL_SERVER' };

    const errorPayload: ApiErrorResponse = {
      success: false,
      code: status,
      error: {
        code: exceptionResponse.errorCode || `ERR_HTTP_${status}`,
        message:
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : exceptionResponse.message || 'An error occurred',
        details: exceptionResponse.details || undefined,
      },
      meta: {
        requestId: request.headers['x-request-id'] || `req_${Date.now()}`,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    };

    response.status(status).json(errorPayload);
  }
}
```

---

## 5. SSE Stream Service Specification (Resumability & `Last-Event-ID`)

### 5.1 Cơ chế Phục hồi Trạng thái SSE (Resumability)

Khi client bị đứt kết nối (mất mạng, reload tab), client có thể yêu cầu tiếp nối từ bước đã nhận được gần nhất bằng cách:
- **Query Param**: `GET /api/v1/runs/:id/stream?fromStep=12`
- **HTTP Header**: `Last-Event-ID: 12` (chuẩn SSE RFC 8895, trình duyệt gửi tự động khi reconnect)

API sẽ:
1. Lấy giá trị `fromStep` từ query param hoặc `Last-Event-ID` header (query param ưu tiên).
2. Subscribe `liveStream$` **ngay lập tức** (trước khi query DB) để không miss event nào.
3. Song song query SQLite lấy `ModelEvent` và `ToolCall` có `stepIndex > fromStep` để replay lịch sử.
4. `merge()` + `distinct()` đảm bảo client nhận đầy đủ và không bị trùng event.

### 5.2 Implementation

```typescript
// file: apps/api/src/modules/stream/stream.service.ts

import { Injectable, MessageEvent } from '@nestjs/common';
import { Subject, Observable, filter, map, merge, from } from 'rxjs';
import { mergeMap, distinct } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';

export interface HarnessStreamEvent {
  runId: string;
  eventType: string;
  stepIndex?: number;
  payload: Record<string, any>;
}

@Injectable()
export class StreamService {
  private eventSubject$ = new Subject<HarnessStreamEvent>();

  constructor(private readonly prisma: PrismaService) {}

  public publishEvent(event: HarnessStreamEvent): void {
    this.eventSubject$.next(event);
  }

  /**
   * Trả về Observable SSE hỗ trợ phục hồi từ bước thỏ qua `fromStep`.
   *
   * **Fix race condition (subscribe-before-query pattern)**:
   * `liveStream$` được khởi tạo và bắt đầu capture NGAY LẬP TỨC trước khi query DB.
   * `merge()` đảm bảo không có event nào bị bỏ lỡ trong khoảng thời gian query.
   * `distinct()` loại bỏ duplicate events ở ranh giới historical/live.
   */
  public getStreamForRun(
    runId: string,
    fromStep?: number,
  ): Observable<MessageEvent> {
    const mapToMessageEvent = (event: HarnessStreamEvent): MessageEvent => ({
      id: String(event.stepIndex ?? Date.now()),
      type: event.eventType,
      data: JSON.stringify(event.payload),
    } as MessageEvent);

    // liveStream$ bắt đầu capture event NGAY LẬP TỨC (trước khi query DB)
    const liveStream$ = this.eventSubject$.asObservable().pipe(
      filter((event) => event.runId === runId),
      filter((event) => fromStep === undefined || (event.stepIndex ?? -1) > fromStep),
      map(mapToMessageEvent),
    );

    // Không có fromStep → chỉ subscribe live stream
    if (fromStep === undefined || fromStep < 0) {
      return liveStream$;
    }

    // Có fromStep → query lịch sử SONG SONG với live subscription đã active
    const historicalReplay$ = from(
      this.replayHistoricalEvents(runId, fromStep),
    ).pipe(
      mergeMap((events) => from(events)), // Đúng RxJS: flat-map array → Observable<MessageEvent>
    );

    // merge() đảm bảo cả 2 stream chạy đồng thời (không có gap)
    // distinct() loại bỏ event trùng id (step index) ở ranh giới
    return merge(historicalReplay$, liveStream$).pipe(
      distinct((event: MessageEvent) => event.id),
    );
  }

  private async replayHistoricalEvents(
    runId: string,
    fromStep: number,
  ): Promise<MessageEvent[]> {
    const [modelEvents, toolCalls] = await Promise.all([
      this.prisma.modelEvent.findMany({
        where: { runId, stepIndex: { gt: fromStep } },
        orderBy: { stepIndex: 'asc' },
      }),
      this.prisma.toolCall.findMany({
        where: { runId, stepIndex: { gt: fromStep } },
        orderBy: { stepIndex: 'asc' },
      }),
    ]);

    // Gộp và sắp xếp theo stepIndex, map sang MessageEvent format
    return [
      ...modelEvents.map((e) => ({
        id: String(e.stepIndex),
        type: this.mapEventType(e.eventType),
        data: JSON.stringify({ runId, stepIndex: e.stepIndex, content: e.content }),
      } as MessageEvent)),
      ...toolCalls.map((tc) => ({
        id: String(tc.stepIndex),
        type: 'step:tool_call',
        data: JSON.stringify({
          runId,
          stepIndex: tc.stepIndex,
          toolName: tc.toolName,
          isError: tc.isError,
        }),
      } as MessageEvent)),
    ].sort((a, b) => parseInt(a.id!) - parseInt(b.id!));
  }

  /** Ánh xạ eventType từ DB sang tên event SSE (xem bảng ánh xạ tại SPEC-TV6-01) */
  private mapEventType(dbEventType: string): string {
    const mapping: Record<string, string> = {
      'THOUGHT': 'step:thought',
      'TOOL_REQUEST': 'step:tool_call',
      'SYSTEM_PROMPT': 'run:status_changed',
      'ERROR': 'run:status_changed',
    };
    return mapping[dbEventType] ?? 'run:status_changed';
  }
}
```

---

## 6. Đồng bộ hóa Config DTO (CreateRunDto vs. Prisma Schema)

Chỉ rõ trường nào là do **người dùng gửi** (user-provided) và trường nào là **system-generated** khi tạo `RunConfigSnapshot`:

```typescript
// file: apps/api/src/modules/run/dto/create-run.dto.ts
import { z } from 'zod';

// Phần người dùng gửi qua request body (user-provided)
export const CreateRunSchema = z.object({
  title: z.string().min(3).max(200),
  targetRepository: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Phải đúng định dạng owner/repo'),
  findingId: z.string().min(1),
  config: z.object({
    // USER-PROVIDED: người dùng lựa chọn
    modelProvider: z.enum(['anthropic', 'openai', 'fake']).default('fake'),
    modelName: z.string().default('claude-3-5-sonnet'),
    temperature: z.number().min(0).max(2).default(0.0),
    maxSteps: z.number().int().min(1).max(200).default(50),
    // Agent behavior flags (user-provided, có default)
    enableMemory: z.boolean().default(true),
    enableCompaction: z.boolean().default(true),
    enableVerification: z.boolean().default(true),
  }).optional(),
});

export type CreateRunDto = z.infer<typeof CreateRunSchema>;
```

```typescript
// file: apps/api/src/modules/run/run.service.ts (excerpt)
import { createHash } from 'crypto';

async buildConfigSnapshot(dto: CreateRunDto): Promise<Omit<RunConfigSnapshot, 'id' | 'runId'>> {
  const config = dto.config ?? {};
  const userProvided = {
    modelProvider: config.modelProvider ?? 'fake',
    modelName: config.modelName ?? 'claude-3-5-sonnet',
    temperature: config.temperature ?? 0.0,
    maxSteps: config.maxSteps ?? 50,
    // Agent behavior flags — user-provided với default sensible
    enableMemory: config.enableMemory ?? true,
    enableCompaction: config.enableCompaction ?? true,
    enableVerification: config.enableVerification ?? true,
  };

  // SYSTEM-GENERATED: không nhận từ user, tự sinh bởi hệ thống
  const TOKEN_PER_STEP_ESTIMATE = 3000; // Empirical: Solidity analysis trung bình 3K tokens/step
  const systemGenerated = {
    promptVersion: process.env.PROMPT_VERSION ?? 'v1.0.0',
    tokenBudget: Math.min(userProvided.maxSteps * TOKEN_PER_STEP_ESTIMATE, 200000),
    configHash: createHash('sha256')
      .update(JSON.stringify(userProvided))
      .digest('hex')
      .slice(0, 32), // 128-bit: đủ ngắn để hiển thị, đủ dài để tránh collision
  };

  return { ...userProvided, ...systemGenerated };
}
```

| Trường | Nguồn | Mô tả |
| :--- | :--- | :--- |
| `modelProvider` | User-Provided | Provider LLM do người dùng chọn |
| `modelName` | User-Provided | Model cụ thể (vd: `claude-3-5-sonnet`) |
| `temperature` | User-Provided | Độ ngẫu nhiên của LLM (0.0 – 2.0) |
| `maxSteps` | User-Provided | Số bước Agent tối đa cho phép |
| `enableMemory` | User-Provided | Bật/tắt Memory layer |
| `enableCompaction` | User-Provided | Bật/tắt Context Compaction |
| `enableVerification` | User-Provided | Bật/tắt bước xác minh PoC cuối cùng |
| `promptVersion` | System-Generated | Phương án prompt đang dùng (lấy từ env `PROMPT_VERSION`) |
| `tokenBudget` | System-Generated | Tổng ngân sách token tính toán từ `maxSteps` |
| `configHash` | System-Generated | SHA-256 fingerprint 128-bit của config để so sánh nhanh |

---

## 7. Demo Mode Implementation (`--demo-mode`)

Khi ứng dụng NestJS chạy ở cờ `DEMO_MODE=true`, `DemoController` cung cấp endpoint REST đơn giản trả về toàn bộ timeline JSON (không dùng timer/SSE) theo kiến trúc Client-Driven Replay:

```typescript
// file: apps/api/src/modules/demo/demo.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { DemoService } from './demo.service';
import { SkipResponseTransform } from '../../common/decorators/skip-response-transform.decorator';

@Controller('demo/runs')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  /**
   * Endpoint này trả về toàn bộ timeline JSON (không phải SSE).
   * Frontend tự quản lý nhịp độ phát qua ReplayController (Client-Driven).
   */
  @Get(':id/timeline')
  @SkipResponseTransform() // Bắt buộc: trả về plain `{ events: [...] }`, không bọc lại envelope JSON
  async getDemoTimeline(@Param('id') runId: string) {
    return this.demoService.loadDemoFixture(runId);
  }
}

// file: apps/api/src/modules/demo/demo.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';

// Zod Schema validate cấu trúc Demo Fixture tại runtime
const DemoEventSchema = z.object({
  type: z.enum([
    'step:thought',
    'step:tool_call',
    'run:verdict',
    'run:completed',
    'run:status_changed',
    'heartbeat',
  ]),
  payload: z.record(z.unknown()),
  delayMs: z.number().optional(),
});

const DemoFixtureSchema = z.object({
  events: z.array(DemoEventSchema),
});

export type DemoEvent = z.infer<typeof DemoEventSchema>;
export type DemoFixture = z.infer<typeof DemoFixtureSchema>;

@Injectable()
export class DemoService {
  async loadDemoFixture(runId: string): Promise<DemoFixture> {
    const fixturePath = join(process.cwd(), 'demo-fixtures', `${runId}.json`);
    try {
      const raw = await readFile(fixturePath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Validate fixture schema ngay khi load — phát hiện lỗi sớm, không để crash lúc replay
      return DemoFixtureSchema.parse(parsed);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new BadRequestException(
          `Demo fixture '${runId}' có format không hợp lệ: ${err.message}`,
        );
      }
      throw new NotFoundException(`Demo fixture '${runId}' không tồn tại`);
    }
  }
}
```
