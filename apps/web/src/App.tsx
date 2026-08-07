import React, { useState } from "react";
import { TraceView } from "./components/trace/TraceView.js";
import { ReplayController } from "./components/demo/ReplayController.js";
import { useReplayStore } from "./stores/replay.store.js";

const DEFAULT_DEMO_FIXTURE = [
  {
    type: "run:status_changed",
    payload: { status: "RUNNING" },
    delayMs: 500,
  },
  {
    type: "step:thought",
    payload: {
      stepIndex: 1,
      thought: "Analyzing Vault.sol reentrancy vectors...",
    },
    delayMs: 1000,
  },
  {
    type: "step:tool_call",
    payload: {
      stepIndex: 1,
      toolName: "read_file",
      isError: false,
      durationMs: 45,
    },
    delayMs: 1200,
  },
  {
    type: "step:thought",
    payload: {
      stepIndex: 2,
      thought: "Found state update after external transfer — CEI violation.",
    },
    delayMs: 1000,
  },
  {
    type: "run:verdict",
    payload: {
      status: "VALID",
      severity: "HIGH",
      confidenceScore: 0.95,
    },
    delayMs: 1500,
  },
  {
    type: "run:completed",
    payload: { totalDurationMs: 5200 },
    delayMs: 500,
  },
];

export const App: React.FC = () => {
  const [activeMode, setActiveMode] = useState<"live" | "demo">("live");
  // W3 Fix: runIdInput có thể được edit từ UI — không hardcode
  const [runIdInput, setRunIdInput] = useState("demo-run-01");
  const [committedRunId, setCommittedRunId] = useState("demo-run-01");
  const { setEvents } = useReplayStore();

  const handleGoToRun = () => {
    const trimmed = runIdInput.trim();
    if (trimmed) {
      setActiveMode("live");
      setCommittedRunId(trimmed);
    }
  };

  const handleStartDemo = async () => {
    setActiveMode("demo");
    try {
      const res = await fetch(`/api/v1/demo/runs/${committedRunId}/timeline`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      } else {
        setEvents(DEFAULT_DEMO_FIXTURE);
      }
    } catch {
      setEvents(DEFAULT_DEMO_FIXTURE);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-primary)",
        paddingBottom: "120px",
      }}
    >
      {/* Top Navigation */}
      <nav
        className="glass-panel"
        style={{
          padding: "16px 32px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "12px",
              height: "12px",
              background: "#06b6d4",
              borderRadius: "50%",
            }}
          />
          <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f9fafb" }}>
            Audit Harness
          </span>
          <span
            style={{
              fontSize: "0.75rem",
              background: "#1f2937",
              color: "#9ca3af",
              padding: "2px 8px",
              borderRadius: "4px",
            }}
          >
            TV6 Spec Compliant
          </span>
        </div>

        {/* W3 Fix: Run ID input — người dùng có thể nhập run ID để xem */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flex: 1,
            maxWidth: "400px",
          }}
        >
          <label
            htmlFor="run-id-input"
            style={{ fontSize: "0.8rem", color: "#9ca3af", whiteSpace: "nowrap" }}
          >
            Run ID:
          </label>
          <input
            id="run-id-input"
            type="text"
            value={runIdInput}
            onChange={(e) => setRunIdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGoToRun()}
            placeholder="Nhập run ID..."
            style={{
              flex: 1,
              padding: "6px 10px",
              background: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "6px",
              color: "#f9fafb",
              fontSize: "0.85rem",
            }}
          />
          <button
            onClick={handleGoToRun}
            style={{
              padding: "6px 14px",
              background: "#3b82f6",
              color: "#fff",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.85rem",
              whiteSpace: "nowrap",
            }}
          >
            Go
          </button>
        </div>

        {/* Mode Switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={() => setActiveMode("live")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: 600,
              background: activeMode === "live" ? "#3b82f6" : "#1f2937",
              color: "#ffffff",
            }}
          >
            Live Execution Mode
          </button>
          <button
            onClick={handleStartDemo}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: 600,
              background: activeMode === "demo" ? "#10b981" : "#1f2937",
              color: "#ffffff",
            }}
          >
            Offline Demo Mode
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main style={{ marginTop: "24px" }}>
        <TraceView runId={committedRunId} />
      </main>

      {/* Demo Replay Controller bar in Demo Mode */}
      {activeMode === "demo" && <ReplayController />}
    </div>
  );
};
