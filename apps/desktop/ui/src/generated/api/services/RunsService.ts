/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { JudgeRequestSchema } from "../models/JudgeRequestSchema";
import type { JudgeResponseSchema } from "../models/JudgeResponseSchema";
import type { RunSchema } from "../models/RunSchema";
import type { ToolCallSchema } from "../models/ToolCallSchema";
import type { CancelablePromise } from "../core/CancelablePromise";
import { OpenAPI } from "../core/OpenAPI";
import { request as __request } from "../core/request";
export class RunsService {
  /**
   * Start Judge
   * Khởi tạo một Audit Run mới
   * @param requestBody
   * @returns JudgeResponseSchema Successful Response
   * @throws ApiError
   */
  public static startJudgeApiV1RunsJudgePost(
    requestBody: JudgeRequestSchema,
  ): CancelablePromise<JudgeResponseSchema> {
    return __request(OpenAPI, {
      method: "POST",
      url: "/api/v1/runs/judge",
      body: requestBody,
      mediaType: "application/json",
      errors: {
        422: `Validation Error`,
      },
    });
  }
  /**
   * Get Runs
   * Lấy danh sách tất cả các phiên Audit
   * @returns RunSchema Successful Response
   * @throws ApiError
   */
  public static getRunsApiV1RunsGet(): CancelablePromise<Array<RunSchema>> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/runs",
    });
  }
  /**
   * Get Run
   * Lấy thông tin của một phiên Audit
   * @param runId
   * @returns RunSchema Successful Response
   * @throws ApiError
   */
  public static getRunApiV1RunsRunIdGet(
    runId: string,
  ): CancelablePromise<RunSchema> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/runs/{run_id}",
      path: {
        run_id: runId,
      },
      errors: {
        422: `Validation Error`,
      },
    });
  }
  /**
   * Get Tool Calls
   * Lấy lịch sử gọi công cụ
   * @param runId
   * @param fromStep
   * @param limit
   * @returns ToolCallSchema Successful Response
   * @throws ApiError
   */
  public static getToolCallsApiV1RunsRunIdToolCallsGet(
    runId: string,
    fromStep?: number,
    limit: number = 500,
  ): CancelablePromise<Array<ToolCallSchema>> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/runs/{run_id}/tool-calls",
      path: {
        run_id: runId,
      },
      query: {
        from_step: fromStep,
        limit: limit,
      },
      errors: {
        422: `Validation Error`,
      },
    });
  }
  /**
   * Stream Run
   * SSE endpoint cho live timeline (Polling DB)
   * @param runId
   * @param fromStep
   * @returns any Successful Response
   * @throws ApiError
   */
  public static streamRunApiV1RunsRunIdStreamGet(
    runId: string,
    fromStep?: number,
  ): CancelablePromise<any> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/runs/{run_id}/stream",
      path: {
        run_id: runId,
      },
      query: {
        from_step: fromStep,
      },
      errors: {
        422: `Validation Error`,
      },
    });
  }
}
