import { z } from "zod"
import { forbiddenKeyPaths } from "./events"

export const JudgeSubmitRequestSchema = z
  .object({
    finding: z.object({
      findingId: z.string().trim().min(1).max(256),
      reportMarkdown: z.string().trim().min(1).max(100_000),
    }),
    snapshotId: z.string().trim().min(1).max(256),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const path of forbiddenKeyPaths(value)) {
      ctx.addIssue({ code: "custom", path, message: "request contains prohibited sensitive metadata" })
    }
  })

export type JudgeSubmitRequest = z.infer<typeof JudgeSubmitRequestSchema>
