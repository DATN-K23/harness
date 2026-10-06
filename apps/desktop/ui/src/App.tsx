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
import { Cpu, Layers } from "lucide-react";

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
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-canvas)",
      }}
    >
      {/* Fixed 48px Top Navigation */}
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

      {/* Dismissible Error Alert Ribbon */}
      {startError && (
        <div
          style={{
            padding: "8px 20px",
            background: "rgba(244, 63, 94, 0.1)",
            borderBottom: "1px solid rgba(244, 63, 94, 0.3)",
            color: "var(--accent-rose)",
            fontSize: "0.8rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
            zIndex: 45,
          }}
          role="alert"
        >
          <span>{startError}</span>
          <button
            type="button"
            onClick={() => setStartError(null)}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent-rose)",
              fontWeight: 700,
              padding: "2px 6px",
              cursor: "pointer",
            }}
            aria-label="Đóng thông báo lỗi"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Dual-Pane Cockpit Workspace */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {activeView === "dashboard" ? (
          <div style={{ flex: 1, height: "100%", overflow: "hidden" }}>
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
          </div>
        ) : (
          <>
            {/* Left Operational Pane (420px Fixed) */}
            <aside
              style={{
                width: "420px",
                minWidth: "420px",
                maxWidth: "420px",
                height: "100%",
                flexShrink: 0,
                overflowY: "auto",
                borderRight: "1px solid var(--border-subtle)",
                background: "var(--surface-panel)",
              }}
            >
              <JudgeForm
                onStartRun={handleStartRun}
                isStarting={isStarting}
                onSelectRecentRun={(runId) => {
                  setCommittedRunId(runId);
                  setActiveMode("live");
                  setActiveView("trace");
                }}
              />
            </aside>

            {/* Center-Right Live Execution Deck (Remaining ~1500px on 1920x1080) */}
            <section
              style={{
                flex: 1,
                minWidth: 0,
                height: "100%",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                background: "var(--surface-canvas)",
              }}
            >
              <TraceView runId={committedRunId} mode={activeMode} />
            </section>
          </>
        )}
      </div>

      {/* Docked Flush Bottom Transport Bar (40px) */}
      {activeMode === "demo" ? (
        <ReplayController />
      ) : (
        <footer
          className="cockpit-transport-bar"
          style={{
            height: "40px",
            width: "100%",
            flexShrink: 0,
            background: "var(--surface-panel)",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            zIndex: 40,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: committedRunId
                    ? "var(--accent-emerald)"
                    : "var(--text-dim)",
                  boxShadow: committedRunId
                    ? "0 0 6px var(--accent-emerald)"
                    : "none",
                }}
              />
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                {committedRunId ? "RUN ACTIVE" : "COCKPIT READY"}
              </span>
            </div>
            {committedRunId && (
              <span
                className="tabular-nums font-mono"
                style={{
                  color: "var(--accent-cyan)",
                  background: "rgba(6, 182, 212, 0.08)",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  border: "1px solid rgba(6, 182, 212, 0.2)",
                  fontSize: "0.72rem",
                }}
              >
                {committedRunId}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Cpu size={13} style={{ color: "var(--accent-indigo)" }} />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.72rem",
                  color: "var(--text-muted)",
                }}
              >
                Engine: DeepSeek-V3 Judge Agent
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                paddingLeft: "12px",
                borderLeft: "1px solid var(--border-subtle)",
              }}
            >
              <Layers size={13} style={{ color: "var(--accent-cyan)" }} />
              <span
                className="tabular-nums font-mono"
                style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}
              >
                Buffer: Virtualized (60fps)
              </span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
};
