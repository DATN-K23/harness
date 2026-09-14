import React, { useState } from "react";
import { TraceView } from "./components/trace/TraceView.js";
import { JudgeForm } from "./components/judge/JudgeForm.js";
import { ReplayController } from "./components/demo/ReplayController.js";
import { useReplayStore, type DemoEvent } from "./stores/replay.store.js";
import { DemoService, RunsService } from "./generated/api/index.js";
import { DashboardView } from "./components/dashboard/DashboardView.js";
import {
  TopNavigation,
  type AppMode,
  type AppView,
} from "./components/layout/TopNavigation.js";
import { DEFAULT_DEMO_FIXTURE } from "./fixtures/demo.fixture.js";

export const App: React.FC = () => {
  const [activeMode, setActiveMode] = useState<AppMode>("live");
  const [activeView, setActiveView] = useState<AppView>("judge");
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
      {/* Modular Top Navigation Header */}
      <TopNavigation
        activeMode={activeMode}
        activeView={activeView}
        onSelectMode={(mode) => {
          if (mode === "demo") {
            void handleStartDemo();
          } else {
            setActiveMode("live");
          }
        }}
        onSelectView={(view) => {
          setActiveView(view);
        }}
        onLogoClick={() => {
          setActiveView("judge");
          setActiveMode("live");
        }}
      />

      {/* Main Content Area */}
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
            role="alert"
          >
            <span>{startError}</span>
            <button
              type="button"
              onClick={() => setStartError(null)}
              style={{ color: "#fca5a5", fontWeight: 700, padding: "4px 8px" }}
              aria-label="Đóng thông báo lỗi"
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
              if (runId === "new") {
                setActiveMode("live");
                setActiveView("judge");
              } else {
                setCommittedRunId(runId);
                setActiveMode("live");
                setActiveView("trace");
              }
            }}
          />
        )}
      </main>

      {/* Demo Replay Controller bar in Demo Mode */}
      {activeMode === "demo" && <ReplayController />}
    </div>
  );
};
