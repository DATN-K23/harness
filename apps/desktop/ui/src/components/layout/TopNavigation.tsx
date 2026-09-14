import React from "react";

export type AppMode = "live" | "demo";
export type AppView = "judge" | "trace" | "dashboard";

interface TopNavigationProps {
  activeMode: AppMode;
  activeView: AppView;
  onSelectMode: (mode: AppMode) => void;
  onSelectView: (view: AppView) => void;
  onLogoClick: () => void;
}

export const TopNavigation: React.FC<TopNavigationProps> = ({
  activeMode,
  activeView,
  onSelectMode,
  onSelectView,
  onLogoClick,
}) => {
  const getViewTitle = () => {
    if (activeView === "dashboard") return "Analytics & Runs Dashboard";
    if (activeMode === "demo") return "Demo Trajectory Replay";
    if (activeView === "trace") return "Live Agent Execution Stream";
    return "Audit Initialization Workspace";
  };

  return (
    <header
      className="glass-panel"
      style={{
        padding: "12px 32px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "16px",
        borderBottom: "1px solid var(--border-color)",
        borderTop: "none",
        borderLeft: "none",
        borderRight: "none",
        borderRadius: 0,
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(16px)",
      }}
      role="banner"
    >
      {/* Brand & Breadcrumbs */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <button
          type="button"
          onClick={onLogoClick}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "transparent",
            padding: "4px 8px",
            borderRadius: "8px",
          }}
          aria-label="Audit Harness - Return to Home"
        >
          <div
            style={{
              width: "14px",
              height: "14px",
              background: "var(--judge-accent)",
              borderRadius: "50%",
              boxShadow: "0 0 12px var(--accent-cyan)",
            }}
            aria-hidden="true"
          />
          <span
            style={{
              fontSize: "1.15rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              letterSpacing: "0.5px",
            }}
          >
            Audit Harness
          </span>
        </button>

        <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          /
        </span>

        <span
          style={{
            fontSize: "0.88rem",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
          }}
        >
          {getViewTitle()}
        </span>
      </div>

      {/* Right Side: Status Telemetry & Navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
        {/* Daemon Connection Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            background: "rgba(15, 23, 42, 0.6)",
            padding: "6px 12px",
            borderRadius: "20px",
            border: "1px solid var(--border-color)",
          }}
        >
          <span className="badge-live-pulse" />
          <span style={{ fontFamily: "var(--font-mono)" }}>Daemon :3000</span>
        </div>

        {/* Navigation & Mode Controls */}
        <nav
          aria-label="Application View Mode"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            background: "rgba(0,0,0,0.4)",
            padding: "4px",
            borderRadius: "10px",
            border: "1px solid var(--border-color)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              onSelectMode("live");
              onSelectView("judge");
            }}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.85rem",
              background:
                activeMode === "live" && activeView !== "dashboard"
                  ? "var(--bg-card-hover)"
                  : "transparent",
              color:
                activeMode === "live" && activeView !== "dashboard"
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
              transition: "all 0.15s ease",
            }}
            aria-current={
              activeMode === "live" && activeView !== "dashboard"
                ? "page"
                : undefined
            }
          >
            ⚡ Live Mode
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectMode("demo");
            }}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.85rem",
              background:
                activeMode === "demo"
                  ? "rgba(16, 185, 129, 0.2)"
                  : "transparent",
              color:
                activeMode === "demo"
                  ? "var(--accent-emerald)"
                  : "var(--text-secondary)",
              transition: "all 0.15s ease",
            }}
            aria-current={activeMode === "demo" ? "page" : undefined}
          >
            🎬 Demo Mode
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectMode("live");
              onSelectView("dashboard");
            }}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.85rem",
              background:
                activeView === "dashboard"
                  ? "rgba(168, 85, 247, 0.2)"
                  : "transparent",
              color:
                activeView === "dashboard"
                  ? "rgb(192, 132, 252)"
                  : "var(--text-secondary)",
              transition: "all 0.15s ease",
            }}
            aria-current={activeView === "dashboard" ? "page" : undefined}
          >
            📊 Dashboard
          </button>
        </nav>
      </div>
    </header>
  );
};
