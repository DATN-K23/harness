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
        const data = result && result.data !== undefined ? result.data : result;
        const pagination =
          result && result.pagination ? result.pagination : undefined;
        const message =
          result && result.message ? result.message : "Operation successful";

        return {
          success: true,
          code: response.statusCode,
          message,
          data,
          meta: {
            requestId: request.headers["x-request-id"] || `req_${Date.now()}`,
            timestamp: new Date().toISOString(),
            ...(pagination && { pagination }),
          },
        };
      }),
    );
  }
}
