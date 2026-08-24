/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VerdictSchema } from './VerdictSchema';
export type RunSchema = {
    id: string;
    title: string;
    targetRepository: string;
    findingId: string;
    status: string;
    totalDurationMs: number;
    verdict?: (VerdictSchema | null);
};

