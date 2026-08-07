import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import type { ApiSuccessResponse } from "@audit-harness/contracts";
import { SKIP_RESPONSE_TRANSFORM_KEY } from "../decorators/skip-response-transform.decorator.js";

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiSuccessResponse<T> | T> {
    const shouldSkip = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (shouldSkip) {
      return next.handle();
    }

    const ctx = context.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    return next.handle().pipe(
      map((result) => {
        /**
         * NC3 Fix: Bỏ heuristic result.data detection — nguy hiểm vì bất kỳ
         * DTO nào có field .data sẽ bị unwrap nhầm.
         *
         * Convention mới: Controller trả về object có shape { _paginated: true, items, pagination }
         * để interceptor nhận biết pagination một cách explicit thay vì heuristic.
         *
         * Mặc định: wrap toàn bộ result vào data.
         */
        let data: T = result;
        let pagination: import("@audit-harness/contracts").PaginationMeta | undefined;
        const message =
          result && typeof result === "object" && result.message
            ? result.message
            : "Operation successful";

        // Chỉ extract pagination khi controller dùng convention _paginated flag
        if (result && typeof result === "object" && result._paginated === true) {
          data = result.items as T;
          pagination = result.pagination as import("@audit-harness/contracts").PaginationMeta;
        }

        const responsePayload: ApiSuccessResponse<T> = {
          success: true,
          code: response.statusCode,
          message,
          data,
          meta: {
            requestId: (request.headers["x-request-id"] as string) || `req_${Date.now()}`,
            timestamp: new Date().toISOString(),
            ...(pagination ? { pagination } : {}),
          },
        };

        return responsePayload;
      }),
    );
  }
}

