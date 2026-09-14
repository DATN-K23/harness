import React, { useEffect, useState } from "react";
import { RunsService } from "../../generated/api/index.js";
import type { RunSchema } from "../../generated/api/index.js";
import { exportRunsToCSV, exportRunsToJSON } from "../../utils/export.js";
import {
  RefreshCw,
  Download,
  ShieldCheck,
  AlertTriangle,
  Zap,
  BarChart3,
  FileSpreadsheet,
} from "lucide-react";

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
        padding: "20px 24px",
        overflowY: "auto",
        background: "var(--surface-canvas)",
      }}
      className="animate-fade-in"
    >
      {/* Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <BarChart3 size={20} style={{ color: "var(--accent-cyan)" }} />
            <h2
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                letterSpacing: "-0.3px",
              }}
            >
              Audit Telemetry & Benchmarks
            </h2>
          </div>
          <p
            style={{
              color: "var(--text-secondary)",
              marginTop: "4px",
              fontSize: "0.8rem",
            }}
          >
            Real-time analytics and historical verification runs across
            multi-agent sessions.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={fetchRuns}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
            aria-label="Refresh run logs"
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={runs.length === 0}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              color:
                runs.length === 0 ? "var(--text-muted)" : "var(--text-primary)",
              borderRadius: "6px",
              opacity: runs.length === 0 ? 0.4 : 1,
              cursor: runs.length === 0 ? "not-allowed" : "pointer",
            }}
            aria-label="Export runs to CSV"
          >
            <FileSpreadsheet size={13} /> Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportJSON}
            disabled={runs.length === 0}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              color:
                runs.length === 0 ? "var(--text-muted)" : "var(--text-primary)",
              borderRadius: "6px",
              opacity: runs.length === 0 ? 0.4 : 1,
              cursor: runs.length === 0 ? "not-allowed" : "pointer",
            }}
            aria-label="Export runs to JSON"
          >
            <Download size={13} /> Export JSON
          </button>
        </div>
      </div>

      {/* Top Stats Overview Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "12px",
          marginBottom: "20px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderRadius: "8px",
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              fontWeight: 600,
            }}
          >
            Total Audit Runs
          </div>
          <div
            className="tabular-nums font-mono"
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              marginTop: "4px",
            }}
          >
            {loading ? "..." : totalRuns}
          </div>
        </div>

        <div
          style={{
            padding: "14px 18px",
            borderRadius: "8px",
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              fontWeight: 600,
            }}
          >
            Completed Rate
          </div>
          <div
            className="tabular-nums font-mono"
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--accent-cyan)",
              marginTop: "4px",
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
          style={{
            padding: "14px 18px",
            borderRadius: "8px",
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              fontWeight: 600,
            }}
          >
            Verified Findings
          </div>
          <div
            className="tabular-nums font-mono"
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--accent-emerald)",
              marginTop: "4px",
            }}
          >
            {loading ? "..." : verifiedFindings}
          </div>
        </div>

        <div
          style={{
            padding: "14px 18px",
            borderRadius: "8px",
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              fontWeight: 600,
            }}
          >
            Average Latency
          </div>
          <div
            className="tabular-nums font-mono"
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--accent-indigo)",
              marginTop: "4px",
            }}
          >
            {loading ? "..." : `${(avgDurationMs / 1000).toFixed(1)}s`}
          </div>
        </div>
      </div>

      {/* Main Runs Table & Empty State */}
      <div
        style={{
          flex: 1,
          borderRadius: "8px",
          border: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {loading ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: "20px",
              gap: "12px",
            }}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="skeleton-shimmer"
                style={{
                  height: "48px",
                  width: "100%",
                  borderRadius: "6px",
                  border: "1px solid var(--border-subtle)",
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
            <AlertTriangle size={32} />
            <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{error}</div>
            <button
              type="button"
              onClick={fetchRuns}
              style={{
                marginTop: "8px",
                padding: "6px 16px",
                background: "var(--surface-panel)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                color: "var(--text-primary)",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
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
              gap: "14px",
              padding: "64px 32px",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "rgba(6, 182, 212, 0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid rgba(6, 182, 212, 0.2)",
                color: "var(--accent-cyan)",
              }}
            >
              <ShieldCheck size={28} />
            </div>
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  fontSize: "1.05rem",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: "4px",
                }}
              >
                No Audit Runs Recorded Yet
              </p>
              <p
                style={{
                  fontSize: "0.82rem",
                  color: "var(--text-secondary)",
                  maxWidth: "420px",
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
                marginTop: "6px",
                padding: "8px 20px",
                background: "var(--accent-cyan)",
                color: "#050810",
                border: "none",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "0.82rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(6, 182, 212, 0.25)",
              }}
            >
              <Zap size={14} fill="currentColor" /> Launch First Audit Run
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto", overflowY: "auto", flex: 1 }}>
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
                    background: "var(--surface-panel)",
                    borderBottom: "1px solid var(--border-subtle)",
                    color: "var(--text-muted)",
                    fontSize: "0.72rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    position: "sticky",
                    top: 0,
                    zIndex: 10,
                  }}
                >
                  <th
                    scope="col"
                    style={{ padding: "12px 20px", fontWeight: 600 }}
                  >
                    Run ID / Repo
                  </th>
                  <th
                    scope="col"
                    style={{ padding: "12px 20px", fontWeight: 600 }}
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    style={{ padding: "12px 20px", fontWeight: 600 }}
                  >
                    Verdict
                  </th>
                  <th
                    scope="col"
                    style={{ padding: "12px 20px", fontWeight: 600 }}
                  >
                    Severity
                  </th>
                  <th
                    scope="col"
                    style={{ padding: "12px 20px", fontWeight: 600 }}
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
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      cursor: "pointer",
                      transition: "background 0.1s ease",
                    }}
                    onMouseOver={(e) =>
                      (e.currentTarget.style.background =
                        "var(--surface-panel)")
                    }
                    onMouseOut={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td style={{ padding: "12px 20px" }}>
                      <div
                        className="tabular-nums font-mono"
                        style={{
                          fontSize: "0.82rem",
                          color: "var(--accent-cyan)",
                          fontWeight: 500,
                        }}
                      >
                        {run.id}
                      </div>
                      <div
                        style={{
                          fontSize: "0.78rem",
                          color: "var(--text-secondary)",
                          marginTop: "2px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: "400px",
                        }}
                        title={run.targetRepository}
                      >
                        {run.targetRepository}
                      </div>
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      <span
                        style={{
                          padding: "3px 10px",
                          borderRadius: "4px",
                          fontSize: "0.72rem",
                          fontWeight: 600,
                          background:
                            run.status === "COMPLETED"
                              ? "rgba(16, 185, 129, 0.12)"
                              : run.status === "FAILED"
                                ? "rgba(244, 63, 94, 0.12)"
                                : "rgba(59, 130, 246, 0.12)",
                          color:
                            run.status === "COMPLETED"
                              ? "var(--accent-emerald)"
                              : run.status === "FAILED"
                                ? "var(--accent-rose)"
                                : "var(--accent-indigo)",
                          border: `1px solid ${
                            run.status === "COMPLETED"
                              ? "rgba(16, 185, 129, 0.25)"
                              : run.status === "FAILED"
                                ? "rgba(244, 63, 94, 0.25)"
                                : "rgba(59, 130, 246, 0.25)"
                          }`,
                        }}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      {run.verdict ? (
                        <span
                          style={{
                            fontSize: "0.82rem",
                            fontWeight: 600,
                            color:
                              run.verdict.validity === "valid"
                                ? "var(--accent-rose)"
                                : "var(--accent-emerald)",
                          }}
                        >
                          {run.verdict.validity.toUpperCase()}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      {run.verdict ? (
                        <span
                          style={{
                            fontSize: "0.82rem",
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
                    <td style={{ padding: "12px 20px" }}>
                      <span
                        className="tabular-nums font-mono"
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--text-muted)",
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
