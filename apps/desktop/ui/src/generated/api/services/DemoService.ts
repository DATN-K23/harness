/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DemoService {
    /**
     * Get Demo Timeline
     * Lấy danh sách các sự kiện (timeline) cho Offline Demo Mode
     * @param runId
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getDemoTimelineApiV1DemoRunsRunIdTimelineGet(
        runId: string,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/demo/runs/{run_id}/timeline',
            path: {
                'run_id': runId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
