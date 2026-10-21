import { z } from "zod"

const forbiddenKeys = new Set([
  "label",
  "labels",
  "groundtruth",
  "adjudication",
  "adjudicationreport",
  "score",
  "scorermetadata",
  "hostpath",
  "apikey",
  "password",
  "secret",
  "credentials",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "bearer",
  "privatekey",
])

const forbiddenPaths = (value: unknown, path: (string | number)[] = []): (string | number)[][] => {
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenPaths(item, [...path, index]))
  if (value === null || typeof value !== "object") return []
  return Object.entries(value).flatMap(([key, inner]) =>
    forbiddenKeys.has(key.toLowerCase().replaceAll(/[^a-z]/g, ""))
      ? [[...path, key]]
      : forbiddenPaths(inner, [...path, key]),
  )
}

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
    for (const path of forbiddenPaths(value)) {
      ctx.addIssue({ code: "custom", path, message: "request contains prohibited sensitive metadata" })
    }
  })

export type JudgeSubmitRequest = z.infer<typeof JudgeSubmitRequestSchema>
