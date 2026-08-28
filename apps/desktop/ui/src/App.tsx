import React, { useState } from "react";
import { TraceView } from "./components/trace/TraceView.js";
import { JudgeForm } from "./components/judge/JudgeForm.js";
import { ReplayController } from "./components/demo/ReplayController.js";
import { useReplayStore } from "./stores/replay.store.js";
import { DemoService } from "./generated/api/index.js";
// OpenAPI.BASE được cấu hình tập trung tại useAuditHarnessClient.tsx (port 3000)

const DEFAULT_DEMO_FIXTURE = [
  { type: "run:status_changed", payload: { status: "RUNNING" }, delayMs: 500 },
  { type: "step:thought", payload: { stepIndex: 1, thought: "Analyzing Vault.sol reentrancy vectors..." }, delayMs: 1000 },
  { type: "step:tool_call", payload: { stepIndex: 1, toolName: "read_file", isError: false, durationMs: 45 }, delayMs: 1200 },
  { type: "step:thought", payload: { stepIndex: 2, thought: "Found state update after external transfer — CEI violation." }, delayMs: 1000 },
  { type: "run:verdict", payload: { status: "VALID", severity: "HIGH", confidenceScore: 0.95 }, delayMs: 1500 },
  { type: "run:completed", payload: { totalDurationMs: 5200 }, delayMs: 500 },
];

export const App: React.FC = () => {
  const [activeMode, setActiveMode] = useState<"live" | "demo">("live");
  const [activeView, setActiveView] = useState<"judge" | "trace">("judge");
  const [committedRunId, setCommittedRunId] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  
  const { setEvents } = useReplayStore();

  const handleStartRun = (config: any) => {
    // TODO: Connect to RunsService to start a real run. For now, simulate delay and go to trace.
    setIsStarting(true);
    setTimeout(() => {
      setIsStarting(false);
      setCommittedRunId("new-run-" + Date.now());
      setActiveView("trace");
    }, 1500);
  };

  const handleStartDemo = async () => {
    setActiveMode("demo");
    setActiveView("trace");
    setCommittedRunId("demo-run-01");
    try {
      const data = await DemoService.getDemoTimelineApiV1DemoRunsRunIdTimelineGet("demo-run-01");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setEvents((data.events as any[]) || []);
    } catch {
      // Fallback: dùng fixture tĩnh nếu backend không sẵn sàng (offline)
      setEvents(DEFAULT_DEMO_FIXTURE as any);
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
          borderBottom: "1px solid var(--border-color)",
          borderTop: "none", borderLeft: "none", borderRight: "none",
          borderRadius: 0,
        }}
      >
        {/* Logo */}
        <div 
          style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }}
          onClick={() => { setActiveView("judge"); setActiveMode("live"); }}
        >
          <div
            style={{
              width: "14px",
              height: "14px",
              background: "var(--judge-accent)",
              borderRadius: "50%",
              boxShadow: "0 0 10px var(--accent-cyan)"
            }}
          />
          <span
            style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.5px" }}
          >
            Audit Harness
          </span>
        </div>

        {/* Mode Switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "rgba(0,0,0,0.3)", padding: "4px", borderRadius: "12px" }}>
          <button
            onClick={() => { setActiveMode("live"); setActiveView("judge"); }}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: 600,
              background: activeMode === "live" ? "var(--bg-card-hover)" : "transparent",
              color: activeMode === "live" ? "var(--text-primary)" : "var(--text-secondary)",
              transition: "all 0.2s"
            }}
          >
            Live Mode
          </button>
          <button
            onClick={handleStartDemo}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: 600,
              background: activeMode === "demo" ? "rgba(16, 185, 129, 0.2)" : "transparent",
              color: activeMode === "demo" ? "var(--accent-emerald)" : "var(--text-secondary)",
              transition: "all 0.2s"
            }}
          >
            Demo Mode
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main style={{ marginTop: "24px" }}>
        {activeView === "judge" && activeMode === "live" && (
          <JudgeForm onStartRun={handleStartRun} isStarting={isStarting} />
        )}
        
        {activeView === "trace" && (
          <TraceView runId={committedRunId} mode={activeMode} />
        )}
      </main>

      {/* Demo Replay Controller bar in Demo Mode */}
      {activeMode === "demo" && <ReplayController />}
    </div>
  );
};
