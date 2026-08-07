import React from "react";
import type { Run } from "@audit-harness/contracts";
import { useRunStore, SseStatus } from "../../stores/run.store.js";
import { useAuditHarnessClient } from "../../hooks/useAuditHarnessClient.js";

interface TraceHeaderProps {
  run: Run | null;
}

export const TraceHeader: React.FC<TraceHeaderProps> = ({ run }) => {
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
      setRun(updated);
    } catch (err: any) {
      alert("Không thể hủy run: " + (err.message || err));
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

          {run?.status === "RUNNING" && (
            <button
              onClick={handleAbortRun}
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

          <div
            style={{
              padding: "6px 12px",
              background:
                run?.status === "RUNNING"
                  ? "rgba(59, 130, 246, 0.2)"
                  : "rgba(16, 185, 129, 0.2)",
              color: run?.status === "RUNNING" ? "#3b82f6" : "#10b981",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "0.875rem",
            }}
          >
            {run?.status || "IDLE"}
          </div>
        </div>
      </div>
    </header>
  );
};
