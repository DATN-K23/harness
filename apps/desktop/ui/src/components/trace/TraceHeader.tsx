import React from "react";
import type { RunSchema as Run } from "../../generated/api/index.js";
import { useRunStore, type SseStatus } from "../../stores/run.store.js";
import { useAuditHarnessClient } from "../../hooks/useAuditHarnessClient.js";

interface TraceHeaderProps {
  run: Run | null;
  /** "live" | "demo" — hiển thị badge phân biệt mode */
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
              color: "#10b981",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            🟢 Connected
          </span>
        );
      case "reconnecting":
        return (
          <span
            style={{
              color: "#f59e0b",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            🟡 Reconnecting...
          </span>
        );
      case "connecting":
        return (
          <span
            style={{
              color: "#06b6d4",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            ⏳ Connecting...
          </span>
        );
      case "offline":
      default:
        return (
          <span
            style={{
              color: "#6b7280",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            ⚪ Offline
          </span>
        );
    }
  };

  const handleAbortRun = async () => {
    if (!run) return;
    const confirmed = window.confirm(
      "Abort Audit Run?\nHành động này sẽ dừng Agent Loop ngay lập tức. Dữ liệu đã ghi được giữ nguyên.",
    );
    if (!confirmed) return;

    try {
      const updated = await client.cancelRun(run.id);
      if (updated.success) {
        setRun({ ...run, status: "CANCELLED" });
      }
    } catch (err: unknown) {
      alert(
        "Không thể hủy run: " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  };

  return (
    <header
      className="glass-panel"
      style={{
        padding: "16px 24px",
        borderRadius: "12px",
        marginBottom: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h1
            style={{ fontSize: "1.25rem", fontWeight: 700, color: "#f9fafb" }}
          >
            {run?.title || "Audit Run Trace View"}
          </h1>
          <p
            style={{ fontSize: "0.875rem", color: "#9ca3af", marginTop: "4px" }}
          >
            Repository:{" "}
            <code style={{ color: "#06b6d4" }}>
              {run?.targetRepository || "N/A"}
            </code>{" "}
            | Finding ID:{" "}
            <code style={{ color: "#3b82f6" }}>{run?.findingId || "N/A"}</code>
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              padding: "6px 12px",
              background: "#111827",
              borderRadius: "8px",
              fontSize: "0.875rem",
            }}
          >
            {getSseBadge(sseStatus)}
          </div>

          {/* Demo Mode badge */}
          {mode === "demo" && (
            <span
              style={{
                padding: "5px 12px",
                background: "rgba(16, 185, 129, 0.15)",
                border: "1px solid rgba(16, 185, 129, 0.35)",
                color: "#10b981",
                borderRadius: "20px",
                fontSize: "0.75rem",
                fontWeight: 700,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
              }}
            >
              🎬 Demo Mode
            </span>
          )}

          {run?.status === "RUNNING" && mode === "live" && (
            <button
              onClick={() => {
                void handleAbortRun();
              }}
              style={{
                background: "#f43f5e",
                color: "#ffffff",
                padding: "8px 16px",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "0.875rem",
              }}
            >
              Abort Run
            </button>
          )}

          {(() => {
            const status = run?.status || "IDLE";
            let bg = "rgba(107, 114, 128, 0.2)";
            let color = "#9ca3af";
            if (status === "RUNNING") {
              bg = "rgba(59, 130, 246, 0.2)";
              color = "#3b82f6";
            } else if (status === "COMPLETED") {
              bg = "rgba(16, 185, 129, 0.2)";
              color = "#10b981";
            } else if (status === "FAILED") {
              bg = "rgba(244, 63, 94, 0.2)";
              color = "#f43f5e";
            } else if (status === "CANCELLED") {
              bg = "rgba(245, 158, 11, 0.2)";
              color = "#f59e0b";
            }
            return (
              <div
                style={{
                  padding: "6px 12px",
                  background: bg,
                  color: color,
                  borderRadius: "8px",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                }}
              >
                {status}
              </div>
            );
          })()}
        </div>
      </div>
    </header>
  );
};
