import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { ApiErrorResponse } from "@audit-harness/contracts";

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
        : {
            message: "Internal server error",
            errorCode: "ERR_INTERNAL_SERVER",
          };

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
