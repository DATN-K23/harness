import React, { useEffect, useState } from "react";
import { RunsService } from "../../generated/api/index.js";
import type { RunSchema } from "../../generated/api/index.js";
import { exportRunsToCSV, exportRunsToJSON } from "../../utils/export.js";

interface DashboardViewProps {
  onSelectRun: (runId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onSelectRun,
}) => {
  const [runs, setRuns] = useState<RunSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = () => {
    setLoading(true);
    RunsService.getRunsApiV1RunsGet()
      .then((data: RunSchema[]) => {
        setRuns(data);
        setError(null);
      })
      .catch((err: Error) => {
        setError("Failed to fetch runs: " + err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  const handleExportCSV = () => {
    exportRunsToCSV(runs);
  };

  const handleExportJSON = () => {
    exportRunsToJSON(runs);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        maxWidth: "1150px",
        margin: "0 auto",
        padding: "32px 16px",
      }}
      className="animate-fade-in-up"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "32px",
        }}
      >
        <div>
          <h2
            style={{
              fontSize: "1.875rem",
              fontWeight: 700,
              background: "linear-gradient(90deg, #60a5fa, #a5b4fc)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Compare Runs
          </h2>
          <p
            style={{
              color: "var(--text-secondary)",
              marginTop: "8px",
              fontSize: "0.95rem",
            }}
          >
            Analytics dashboard for evaluation and ablation study.
          </p>
        </div>
        <div style={{ display: "flex", gap: "16px" }}>
          <button
            onClick={fetchRuns}
            style={{
              padding: "10px 18px",
              background: "rgba(30, 41, 59, 0.6)",
              color: "var(--text-primary)",
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              fontWeight: 600,
              fontSize: "0.9rem",
            }}
          >
            Refresh
          </button>
          <button
            onClick={handleExportCSV}
            style={{
              padding: "10px 18px",
              background: "linear-gradient(135deg, #4f46e5, #4338ca)",
              color: "#ffffff",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "0.9rem",
              boxShadow: "0 4px 14px rgba(79, 70, 229, 0.3)",
            }}
          >
            Export CSV
          </button>
          <button
            onClick={handleExportJSON}
            style={{
              padding: "10px 18px",
              background: "linear-gradient(135deg, #9333ea, #7e22ce)",
              color: "#ffffff",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "0.9rem",
              boxShadow: "0 4px 14px rgba(147, 51, 234, 0.3)",
            }}
          >
            Export JSON
          </button>
        </div>
      </div>

      <div
        className="glass-panel"
        style={{
          flex: 1,
          borderRadius: "16px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {loading ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: "24px",
              gap: "16px",
            }}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="skeleton-shimmer"
                style={{
                  height: "64px",
                  width: "100%",
                  borderRadius: "12px",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              />
            ))}
          </div>
        ) : error ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent-rose)",
              padding: "32px",
              textAlign: "center",
            }}
          >
            {error}
          </div>
        ) : runs.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              gap: "16px",
              padding: "48px",
            }}
          >
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                background: "rgba(255, 255, 255, 0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--border-color)",
                fontSize: "1.5rem",
              }}
            >
              📋
            </div>
            <p
              style={{
                fontSize: "1.1rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
              }}
            >
              No audit runs found yet.
            </p>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              Start a new run to see results here.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto", flex: 1 }}>
            <table
              style={{
                width: "100%",
                textAlign: "left",
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "rgba(5, 8, 16, 0.8)",
                    borderBottom: "1px solid var(--border-color)",
                    color: "var(--text-muted)",
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                  }}
                >
                  <th style={{ padding: "16px 24px", fontWeight: 600 }}>
                    Run ID / Repo
                  </th>
                  <th style={{ padding: "16px 24px", fontWeight: 600 }}>
                    Status
                  </th>
                  <th style={{ padding: "16px 24px", fontWeight: 600 }}>
                    Verdict
                  </th>
                  <th style={{ padding: "16px 24px", fontWeight: 600 }}>
                    Severity
                  </th>
                  <th style={{ padding: "16px 24px", fontWeight: 600 }}>
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => onSelectRun(run.id)}
                    className="hover-scale"
                    style={{
                      borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ padding: "16px 24px" }}>
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.875rem",
                          color: "var(--accent-cyan)",
                        }}
                      >
                        {run.id}
                      </div>
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--text-secondary)",
                          marginTop: "4px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: "250px",
                        }}
                        title={run.targetRepository}
                      >
                        {run.targetRepository}
                      </div>
                    </td>
                    <td style={{ padding: "16px 24px" }}>
                      <span
                        style={{
                          padding: "4px 12px",
                          borderRadius: "20px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background:
                            run.status === "COMPLETED"
                              ? "rgba(16, 185, 129, 0.15)"
                              : run.status === "FAILED"
                                ? "rgba(244, 63, 94, 0.15)"
                                : "rgba(59, 130, 246, 0.15)",
                          color:
                            run.status === "COMPLETED"
                              ? "#10b981"
                              : run.status === "FAILED"
                                ? "#f43f5e"
                                : "#3b82f6",
                          border: `1px solid ${
                            run.status === "COMPLETED"
                              ? "rgba(16, 185, 129, 0.3)"
                              : run.status === "FAILED"
                                ? "rgba(244, 63, 94, 0.3)"
                                : "rgba(59, 130, 246, 0.3)"
                          }`,
                        }}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td style={{ padding: "16px 24px" }}>
                      {run.verdict ? (
                        <span
                          style={{
                            fontSize: "0.875rem",
                            fontWeight: 600,
                            color:
                              run.verdict.validity === "valid"
                                ? "#f43f5e"
                                : "#10b981",
                          }}
                        >
                          {run.verdict.validity.toUpperCase()}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: "16px 24px" }}>
                      {run.verdict ? (
                        <span
                          style={{
                            fontSize: "0.875rem",
                            color: "var(--text-secondary)",
                            textTransform: "capitalize",
                          }}
                        >
                          {run.verdict.severity}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: "16px 24px" }}>
                      <span
                        style={{
                          fontSize: "0.875rem",
                          color: "var(--text-muted)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {(run.totalDurationMs / 1000).toFixed(1)}s
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
