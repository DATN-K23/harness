import React, { useState } from "react";
import { TraceView } from "./components/trace/TraceView.js";
import { JudgeForm } from "./components/judge/JudgeForm.js";
import { ReplayController } from "./components/demo/ReplayController.js";
import { useReplayStore, type DemoEvent } from "./stores/replay.store.js";
import { DemoService, RunsService } from "./generated/api/index.js";
import { DashboardView } from "./components/dashboard/DashboardView.js";
// OpenAPI.BASE được cấu hình tập trung tại useAuditHarnessClient.tsx (port 3000)

const DEFAULT_DEMO_FIXTURE: DemoEvent[] = [
  { type: "run:status_changed", payload: { status: "RUNNING" }, delayMs: 500 },
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
    payload: { status: "VALID", severity: "HIGH", confidenceScore: 0.95 },
    delayMs: 1500,
  },
  { type: "run:completed", payload: { totalDurationMs: 5200 }, delayMs: 500 },
];

export const App: React.FC = () => {
  const [activeMode, setActiveMode] = useState<"live" | "demo">("live");
  const [activeView, setActiveView] = useState<"judge" | "trace" | "dashboard">(
    "judge",
  );
  const [committedRunId, setCommittedRunId] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const { setEvents } = useReplayStore();

  const handleStartRun = (config: {
    repo: string;
    findingId: string;
    modelName: string;
    tokenBudget: number;
  }) => {
    setIsStarting(true);
    setStartError(null);
    RunsService.startJudgeApiV1RunsJudgePost({
      repository: config.repo,
      findingId: config.findingId,
      modelName: config.modelName,
      tokenBudget: config.tokenBudget,
    })
      .then((data) => {
        setCommittedRunId(data.runId);
        setActiveView("trace");
      })
      .catch((err: Error) => {
        console.error("Failed to start run", err);
        setStartError("Failed to start run: " + err.message);
      })
      .finally(() => {
        setIsStarting(false);
      });
  };

  const handleStartDemo = async () => {
    setActiveMode("demo");
    setActiveView("trace");
    setCommittedRunId("demo-run-01");
    try {
      const data =
        await DemoService.getDemoTimelineApiV1DemoRunsRunIdTimelineGet(
          "demo-run-01",
        );
      setEvents((data.events as DemoEvent[]) || []);
    } catch {
      // Fallback: dùng fixture tĩnh nếu backend không sẵn sàng (offline)
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
          borderBottom: "1px solid var(--border-color)",
          borderTop: "none",
          borderLeft: "none",
          borderRight: "none",
          borderRadius: 0,
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            cursor: "pointer",
          }}
          onClick={() => {
            setActiveView("judge");
            setActiveMode("live");
          }}
        >
          <div
            style={{
              width: "14px",
              height: "14px",
              background: "var(--judge-accent)",
              borderRadius: "50%",
              boxShadow: "0 0 10px var(--accent-cyan)",
            }}
          />
          <span
            style={{
              fontSize: "1.2rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "0.5px",
            }}
          >
            Audit Harness
          </span>
        </div>

        {/* Mode Switcher */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            background: "rgba(0,0,0,0.3)",
            padding: "4px",
            borderRadius: "12px",
          }}
        >
          <button
            onClick={() => {
              setActiveMode("live");
              setActiveView("judge");
            }}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: 600,
              background:
                activeMode === "live" ? "var(--bg-card-hover)" : "transparent",
              color:
                activeMode === "live"
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
              transition: "all 0.2s",
            }}
          >
            Live Mode
          </button>
          <button
            onClick={() => void handleStartDemo()}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: 600,
              background:
                activeMode === "demo"
                  ? "rgba(16, 185, 129, 0.2)"
                  : "transparent",
              color:
                activeMode === "demo"
                  ? "var(--accent-emerald)"
                  : "var(--text-secondary)",
              transition: "all 0.2s",
            }}
          >
            Demo Mode
          </button>
          <button
            onClick={() => {
              setActiveMode("live");
              setActiveView("dashboard");
            }}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: 600,
              background:
                activeView === "dashboard"
                  ? "rgba(168, 85, 247, 0.2)"
                  : "transparent",
              color:
                activeView === "dashboard"
                  ? "rgb(192, 132, 252)"
                  : "var(--text-secondary)",
              transition: "all 0.2s",
            }}
          >
            Dashboard
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main style={{ marginTop: "24px" }}>
        {startError && activeView === "judge" && (
          <div
            className="glass-panel"
            style={{
              maxWidth: "900px",
              margin: "0 auto 20px auto",
              padding: "16px 24px",
              borderRadius: "12px",
              background: "rgba(244, 63, 94, 0.1)",
              border: "1px solid rgba(244, 63, 94, 0.3)",
              color: "#fca5a5",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{startError}</span>
            <button
              onClick={() => setStartError(null)}
              style={{ color: "#fca5a5", fontWeight: 700, padding: "4px 8px" }}
            >
              ✕
            </button>
          </div>
        )}

        {activeView === "judge" && activeMode === "live" && (
          <JudgeForm onStartRun={handleStartRun} isStarting={isStarting} />
        )}

        {activeView === "trace" && (
          <TraceView runId={committedRunId} mode={activeMode} />
        )}

        {activeView === "dashboard" && (
          <DashboardView
            onSelectRun={(runId) => {
              setCommittedRunId(runId);
              setActiveMode("live");
              setActiveView("trace");
            }}
          />
        )}
      </main>

      {/* Demo Replay Controller bar in Demo Mode */}
      {activeMode === "demo" && <ReplayController />}
    </div>
  );
};
