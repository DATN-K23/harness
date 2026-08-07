import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ApiErrorResponse } from "@audit-harness/contracts";

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpExceptionFilter");

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
        : {
            message: "Internal server error",
            errorCode: "ERR_INTERNAL_SERVER",
          };

    // NI1 Fix: Log lỗi >= 500 để tành trạng production blindspot
    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (status >= 400) {
      this.logger.warn(`[${request.method}] ${request.url} → ${status}`);
    }

    const errorPayload: ApiErrorResponse = {
      success: false,
      code: status,
      error: {
        code: exceptionResponse.errorCode || `ERR_HTTP_${status}`,
        message:
          typeof exceptionResponse === "string"
            ? exceptionResponse
            : exceptionResponse.message || "An error occurred",
        details: exceptionResponse.details || undefined,
      },
      meta: {
        requestId: request.headers["x-request-id"] || `req_${Date.now()}`,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    };

    response.status(status).json(errorPayload);
  }
}
