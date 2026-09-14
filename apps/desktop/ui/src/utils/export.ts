import type {
  RunSchema,
  ToolCallSchema,
  VerdictSchema,
} from "../generated/api/index.js";

export function downloadFile(
  content: string,
  fileName: string,
  mimeType: string,
) {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateRunsCSV(runs: RunSchema[]): string {
  if (!runs || runs.length === 0) return "";

  const headers = [
    "Run ID",
    "Title",
    "Repository",
    "Finding ID",
    "Status",
    "Duration (ms)",
    "Verdict Validity",
    "Verdict Severity",
    "Confidence",
  ];

  const rows = runs.map((r) => {
    const verdict = r.verdict as VerdictSchema | undefined;

    return [
      r.id,
      r.title,
      r.targetRepository,
      r.findingId,
      r.status,
      r.totalDurationMs.toString(),
      verdict?.validity || "",
      verdict?.severity || "",
      verdict?.confidence?.toString() || "",
    ]
      .map((field) => `"${(field || "").replace(/"/g, '""')}"`)
      .join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

export function exportRunsToCSV(runs: RunSchema[]) {
  const csvContent = generateRunsCSV(runs);
  if (!csvContent) return;

  downloadFile(
    csvContent,
    `audit_runs_export_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
    "text/csv;charset=utf-8;",
  );
}

export function generateRunsJSON(
  runs: RunSchema[],
  toolCallsByRun?: Record<string, ToolCallSchema[]>,
): string {
  if (!runs || runs.length === 0) return "";

  const exportData = runs.map((run) => {
    const data: Record<string, unknown> = { ...run };
    if (toolCallsByRun && toolCallsByRun[run.id]) {
      data.toolCalls = toolCallsByRun[run.id];
    }
    return data;
  });

  return JSON.stringify(exportData, null, 2);
}

export function exportRunsToJSON(
  runs: RunSchema[],
  toolCallsByRun?: Record<string, ToolCallSchema[]>,
) {
  const jsonContent = generateRunsJSON(runs, toolCallsByRun);
  if (!jsonContent) return;

  downloadFile(
    jsonContent,
    `audit_runs_export_${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    "application/json",
  );
}
