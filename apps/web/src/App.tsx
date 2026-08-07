import React, { useState } from "react";
import { TraceView } from "./components/trace/TraceView.js";
import { ReplayController } from "./components/demo/ReplayController.js";
import { useReplayStore } from "./stores/replay.store.js";

export const App: React.FC = () => {
  const [activeMode, setActiveMode] = useState<"live" | "demo">("live");
  const [runIdInput, setRunIdInput] = useState("demo-run-01");
  const { setEvents } = useReplayStore();

  const handleStartDemo = async () => {
    setActiveMode("demo");
    try {
      const res = await fetch(`/api/v1/demo/runs/${runIdInput}/timeline`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      } else {
        // Fallback demo fixture nếu chưa có backend API running
        setEvents([
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
              thought: "Found state update after external transfer.",
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
        ]);
      }
    } catch {
      setEvents([
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
            thought: "Found state update after external transfer.",
          },
          delayMs: 1000,
        },
        {
          type: "run:verdict",
          payload: { status: "VALID", severity: "HIGH", confidenceScore: 0.95 },
          delayMs: 1500,
        },
        {
          type: "run:completed",
          payload: { totalDurationMs: 5200 },
          delayMs: 500,
        },
      ]);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-primary)",
        paddingBottom: "100px",
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
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "12px",
              height: "12px",
              background: "#06b6d4",
              borderRadius: "50%",
            }}
          />
          <span
            style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f9fafb" }}
          >
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
        <TraceView runId={runIdInput} />
      </main>

      {/* Demo Replay Controller bar in Demo Mode */}
      {activeMode === "demo" && <ReplayController />}
    </div>
  );
};
