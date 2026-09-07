import type {
  RunSchema,
  ToolCallSchema,
  VerdictSchema,
} from "../generated/api";

export function downloadFile(
  content: string,
  fileName: string,
  mimeType: string,
) {
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

export function exportRunsToCSV(runs: RunSchema[]) {
  if (!runs || runs.length === 0) return;

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

  const csvContent = [headers.join(","), ...rows].join("\n");

  downloadFile(
    csvContent,
    `audit_runs_export_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
    "text/csv;charset=utf-8;",
  );
}

export function exportRunsToJSON(
  runs: RunSchema[],
  toolCallsByRun?: Record<string, ToolCallSchema[]>,
) {
  if (!runs || runs.length === 0) return;

  const exportData = runs.map((run) => {
    const data: Record<string, unknown> = { ...run };
    if (toolCallsByRun && toolCallsByRun[run.id]) {
      data.toolCalls = toolCallsByRun[run.id];
    }
    return data;
  });

  downloadFile(
    JSON.stringify(exportData, null, 2),
    `audit_runs_export_${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    "application/json",
  );
}
