import React from "react";
import type { RunSchema as Run } from "../../generated/api/index.js";
import { useRunStore, type SseStatus } from "../../stores/run.store.js";
import { useAuditHarnessClient } from "../../hooks/useAuditHarnessClient.js";
import {
  WifiOff,
  RefreshCw,
  Square,
  Play,
  GitBranch,
  Target,
} from "lucide-react";

interface TraceHeaderProps {
  run: Run | null;
  /** "live" | "demo" — mode badge */
  mode?: "live" | "demo";
}

export const TraceHeader: React.FC<TraceHeaderProps> = ({
  run,
  mode = "live",
}) => {
  const { sseStatus, setRun } = useRunStore();
  const client = useAuditHarnessClient();

  const getSseBadge = (status: SseStatus) => {
    switch (status) {
      case "connected":
        return (
          <span
            style={{
              color: "var(--accent-emerald)",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "var(--accent-emerald)",
                boxShadow: "0 0 6px var(--accent-emerald)",
              }}
            />
            Connected
          </span>
        );
      case "reconnecting":
        return (
          <span
            style={{
              color: "var(--accent-amber)",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              fontWeight: 600,
            }}
          >
            <RefreshCw size={11} className="animate-spin" />
            Reconnecting...
          </span>
        );
      case "connecting":
        return (
          <span
            style={{
              color: "var(--accent-cyan)",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              fontWeight: 600,
            }}
          >
            <RefreshCw size={11} className="animate-spin" />
            Connecting...
          </span>
        );
      case "offline":
      default:
        return (
          <span
            style={{
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
            }}
          >
            <WifiOff size={11} />
            Offline
          </span>
        );
    }
  };

  const handleAbortRun = async () => {
    if (!run) return;
    const confirmed = window.confirm(
      "Abort Audit Run?\nThis will terminate the Agent Sandbox immediately. Recorded events will be preserved.",
    );
    if (!confirmed) return;

    try {
      const updated = await client.cancelRun(run.id);
      if (updated.success) {
        setRun({ ...run, status: "CANCELLED" });
      }
    } catch (err: unknown) {
      alert(
        "Failed to abort run: " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  };

  return (
    <div
      style={{
        padding: "10px 14px",
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "8px",
        marginBottom: "10px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          minWidth: 0,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h1
              style={{
                fontSize: "0.95rem",
                fontWeight: 700,
                color: "var(--text-bright)",
                letterSpacing: "-0.2px",
              }}
            >
              {run?.title ||
                (mode === "demo"
                  ? "Replay Trajectory Stream"
                  : "Live Trajectory Stream")}
            </h1>
            {run?.id && (
              <span
                className="tabular-nums"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.7rem",
                  color: "var(--text-muted)",
                  background: "var(--surface-input)",
                  padding: "1px 6px",
                  borderRadius: "4px",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {run.id}
              </span>
            )}
          </div>

          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginTop: "2px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <GitBranch size={11} color="var(--accent-cyan)" />
              <code
                style={{ color: "var(--accent-cyan)", fontSize: "0.72rem" }}
              >
                {run?.targetRepository || "demo/project"}
              </code>
            </span>
            <span style={{ color: "var(--text-dim)" }}>|</span>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Target size={11} color="var(--accent-blue)" />
              <code
                style={{ color: "var(--text-normal)", fontSize: "0.72rem" }}
              >
                {run?.findingId || "CEI-001"}
              </code>
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: "4px 10px",
            background: "var(--surface-input)",
            borderRadius: "6px",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {getSseBadge(sseStatus)}
        </div>

        {mode === "demo" && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              background: "var(--accent-emerald-bg)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              color: "var(--accent-emerald)",
              borderRadius: "4px",
              fontSize: "0.7rem",
              fontWeight: 700,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
            }}
          >
            <Play size={10} fill="currentColor" />
            Demo Mode
          </span>
        )}

        {run?.status === "RUNNING" && mode === "live" && (
          <button
            type="button"
            onClick={() => {
              void handleAbortRun();
            }}
            style={{
              background: "var(--accent-rose)",
              color: "#ffffff",
              padding: "5px 12px",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.75rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Square size={11} fill="currentColor" />
            Abort Run
          </button>
        )}

        {(() => {
          const status = run?.status || "IDLE";
          let bg = "rgba(107, 114, 128, 0.15)";
          let color = "var(--text-muted)";
          let borderColor = "var(--border-subtle)";
          if (status === "RUNNING") {
            bg = "var(--accent-cyan-bg)";
            color = "var(--accent-cyan)";
            borderColor = "rgba(6, 182, 212, 0.3)";
          } else if (status === "COMPLETED") {
            bg = "var(--accent-emerald-bg)";
            color = "var(--accent-emerald)";
            borderColor = "rgba(16, 185, 129, 0.3)";
          } else if (status === "FAILED") {
            bg = "var(--accent-rose-bg)";
            color = "var(--accent-rose)";
            borderColor = "rgba(244, 63, 94, 0.3)";
          } else if (status === "CANCELLED") {
            bg = "var(--accent-amber-bg)";
            color = "var(--accent-amber)";
            borderColor = "rgba(245, 158, 11, 0.3)";
          }
          return (
            <div
              style={{
                padding: "4px 8px",
                background: bg,
                color: color,
                border: `1px solid ${borderColor}`,
                borderRadius: "4px",
                fontWeight: 700,
                fontSize: "0.72rem",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                fontFamily: "var(--font-mono)",
              }}
            >
              {status}
            </div>
          );
        })()}
      </div>
    </div>
  );
};
