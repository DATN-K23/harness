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
    if (runs.length === 0) return;
    exportRunsToCSV(runs);
  };

  const handleExportJSON = () => {
    if (runs.length === 0) return;
    exportRunsToJSON(runs);
  };

  // Compute summary stats
  const totalRuns = runs.length;
  const completedRuns = runs.filter((r) => r.status === "COMPLETED").length;
  const verifiedFindings = runs.filter(
    (r) => r.verdict?.validity === "valid",
  ).length;
  const avgDurationMs =
    totalRuns > 0
      ? Math.round(
          runs.reduce((acc, r) => acc + (r.totalDurationMs || 0), 0) /
            totalRuns,
        )
      : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "24px 32px",
      }}
      className="animate-fade-in-up"
    >
      {/* Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <div>
          <h2
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "-0.5px",
            }}
          >
            Audit Telemetry & Benchmarks
          </h2>
          <p
            style={{
              color: "var(--text-secondary)",
              marginTop: "4px",
              fontSize: "0.9rem",
            }}
          >
            Comprehensive analytics dashboard for multi-agent evaluation and
            ablation verification.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            type="button"
            onClick={fetchRuns}
            className="btn-secondary"
            style={{ padding: "8px 16px", fontSize: "0.85rem" }}
            aria-label="Refresh run logs"
          >
            🔄 Refresh
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={runs.length === 0}
            className="btn-indigo"
            style={{
              padding: "8px 16px",
              fontSize: "0.85rem",
              opacity: runs.length === 0 ? 0.4 : 1,
              cursor: runs.length === 0 ? "not-allowed" : "pointer",
            }}
            aria-label="Export runs to CSV"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportJSON}
            disabled={runs.length === 0}
            className="btn-purple"
            style={{
              padding: "8px 16px",
              fontSize: "0.85rem",
              opacity: runs.length === 0 ? 0.4 : 1,
              cursor: runs.length === 0 ? "not-allowed" : "pointer",
            }}
            aria-label="Export runs to JSON"
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* Top Stats Overview Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div
          className="glass-panel"
          style={{ padding: "18px 20px", borderRadius: "12px" }}
        >
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "0.8rem",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Total Audit Runs
          </div>
          <div
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              marginTop: "6px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {loading ? "..." : totalRuns}
          </div>
        </div>

        <div
          className="glass-panel"
          style={{ padding: "18px 20px", borderRadius: "12px" }}
        >
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "0.8rem",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Completed Rate
          </div>
          <div
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: "var(--accent-cyan)",
              marginTop: "6px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {loading
              ? "..."
              : totalRuns > 0
                ? `${Math.round((completedRuns / totalRuns) * 100)}%`
                : "0%"}
          </div>
        </div>

        <div
          className="glass-panel"
          style={{ padding: "18px 20px", borderRadius: "12px" }}
        >
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "0.8rem",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Verified Findings
          </div>
          <div
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: "var(--accent-emerald)",
              marginTop: "6px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {loading ? "..." : verifiedFindings}
          </div>
        </div>

        <div
          className="glass-panel"
          style={{ padding: "18px 20px", borderRadius: "12px" }}
        >
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "0.8rem",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Average Latency
          </div>
          <div
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: "var(--accent-indigo)",
              marginTop: "6px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {loading ? "..." : `${(avgDurationMs / 1000).toFixed(1)}s`}
          </div>
        </div>
      </div>

      {/* Main Runs Table & Empty State */}
      <div
        className="glass-panel"
        style={{
          flex: 1,
          borderRadius: "14px",
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
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="skeleton-shimmer"
                style={{
                  height: "56px",
                  width: "100%",
                  borderRadius: "8px",
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
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent-rose)",
              padding: "48px",
              textAlign: "center",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "1.5rem" }}>⚠️</div>
            <div style={{ fontSize: "1rem", fontWeight: 600 }}>{error}</div>
            <button
              type="button"
              onClick={fetchRuns}
              className="btn-secondary"
              style={{ marginTop: "8px" }}
            >
              Retry Fetch
            </button>
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
              padding: "64px 32px",
            }}
          >
            <div
              style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                background: "rgba(6, 182, 212, 0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid rgba(6, 182, 212, 0.2)",
                fontSize: "1.8rem",
              }}
            >
              🛡️
            </div>
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: "4px",
                }}
              >
                No Audit Runs Recorded Yet
              </p>
              <p
                style={{
                  fontSize: "0.88rem",
                  color: "var(--text-secondary)",
                  maxWidth: "400px",
                }}
              >
                Execute your first smart contract verification run to inspect
                trajectory events and model verdicts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSelectRun("new")}
              style={{
                marginTop: "8px",
                padding: "10px 24px",
                background: "var(--judge-accent)",
                color: "#ffffff",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "0.9rem",
                boxShadow: "0 4px 14px rgba(6, 182, 212, 0.3)",
              }}
            >
              ⚡ Launch First Audit Run
            </button>
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
                  <th
                    scope="col"
                    style={{ padding: "16px 24px", fontWeight: 600 }}
                  >
                    Run ID / Repo
                  </th>
                  <th
                    scope="col"
                    style={{ padding: "16px 24px", fontWeight: 600 }}
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    style={{ padding: "16px 24px", fontWeight: 600 }}
                  >
                    Verdict
                  </th>
                  <th
                    scope="col"
                    style={{ padding: "16px 24px", fontWeight: 600 }}
                  >
                    Severity
                  </th>
                  <th
                    scope="col"
                    style={{ padding: "16px 24px", fontWeight: 600 }}
                  >
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => onSelectRun(run.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectRun(run.id);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Xem chi tiết phiên kiểm thử ${run.id}`}
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
