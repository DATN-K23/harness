import { z } from "zod";
import type { RunStatus } from "./enums.js";
import type { Verdict } from "./verdict.js";

export const CreateRunSchema = z.object({
  title: z.string().min(3).max(200),
  targetRepository: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/, "Phải đúng định dạng owner/repo"),
  findingId: z.string().min(1),
  config: z
    .object({
      modelProvider: z.enum(["anthropic", "openai", "fake"]).default("fake"),
      modelName: z.string().default("claude-3-5-sonnet"),
      temperature: z.number().min(0).max(2).default(0.0),
      maxSteps: z.number().int().min(1).max(200).default(50),
      enableMemory: z.boolean().default(true),
      enableCompaction: z.boolean().default(true),
      enableVerification: z.boolean().default(true),
    })
    .optional(),
});

export type CreateRunDto = z.infer<typeof CreateRunSchema>;

export interface RunConfigSnapshot {
  id: string;
  runId: string;
  modelProvider: string;
  modelName: string;
  temperature: number;
  maxSteps: number;
  tokenBudget: number;
  enableMemory: boolean;
  enableCompaction: boolean;
  enableVerification: boolean;
  promptVersion: string;
  configHash: string;
}

export interface Run {
  id: string;
  title: string;
  targetRepository: string;
  findingId: string;
  status: RunStatus;
  startedAt: string | Date;
  completedAt?: string | Date | null;
  totalDurationMs: number;
  totalTokensUsed: number;
  totalCostUsd: number;
  configSnapshot?: RunConfigSnapshot | null;
  verdict?: Verdict | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}
