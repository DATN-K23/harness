/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ToolCallSchema = {
    id: string;
    stepIndex: number;
    toolName: string;
    argumentsJson: string;
    resultJson: string;
    isError: boolean;
    durationMs: number;
    tokensUsed?: (number | null);
};

