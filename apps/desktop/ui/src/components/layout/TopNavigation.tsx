import React, { useState, useEffect } from "react";
import { Zap, Play, LayoutDashboard } from "lucide-react";

export type AppMode = "live" | "demo";
export type AppView = "judge" | "trace" | "dashboard";

interface TopNavigationProps {
  activeMode: AppMode;
  activeView: AppView;
  targetRepo?: string;
  findingId?: string;
  onSelectMode: (mode: AppMode) => void;
  onSelectView: (view: AppView) => void;
  onLogoClick: () => void;
}

export const TopNavigation: React.FC<TopNavigationProps> = ({
  activeMode,
  activeView,
  targetRepo,
  findingId,
  onSelectMode,
  onSelectView,
  onLogoClick,
}) => {
  const [daemonStatus, setDaemonStatus] = useState<
    "online" | "offline" | "checking"
  >("checking");
  const [daemonLatency, setDaemonLatency] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    const checkHealth = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const start = performance.now();
      try {
        const res = await fetch("http://127.0.0.1:3000/api/v1/health", {
          signal: controller.signal,
        }).catch(() => null);
        clearTimeout(timeoutId);
        if (!isMounted) return;

        if (res && (res.ok || res.status < 500)) {
          setDaemonStatus("online");
          setDaemonLatency(Math.round(performance.now() - start));
        } else {
          // Fallback check on root/docs
          const fallbackRes = await fetch("http://127.0.0.1:3000/docs", {
            method: "HEAD",
          }).catch(() => null);
          if (!isMounted) return;
          if (fallbackRes && fallbackRes.status < 500) {
            setDaemonStatus("online");
            setDaemonLatency(Math.round(performance.now() - start));
          } else {
            setDaemonStatus("offline");
            setDaemonLatency(null);
          }
        }
      } catch {
        if (isMounted) {
          setDaemonStatus("offline");
          setDaemonLatency(null);
        }
      }
    };

    void checkHealth();
    const interval = setInterval(() => {
      void checkHealth();
    }, 15000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const getViewTitle = () => {
    if (activeView === "dashboard") return "Analytics & Runs Dashboard";
    if (activeMode === "demo") return "Demo Trajectory Replay";
    if (activeView === "trace") return "Live Execution Cockpit";
    return "Audit Initialization Workspace";
  };

  return (
    <header
      style={{
        height: "48px",
        minHeight: "48px",
        maxHeight: "48px",
        padding: "0 20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "16px",
        background: "var(--surface-panel)",
        borderBottom: "1px solid var(--border-subtle)",
        position: "sticky",
        top: 0,
        zIndex: 50,
        flexShrink: 0,
      }}
      role="banner"
    >
      {/* Brand & Breadcrumbs */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          minWidth: 0,
        }}
      >
        <button
          type="button"
          onClick={onLogoClick}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "transparent",
            padding: "4px 6px",
            borderRadius: "6px",
          }}
          aria-label="Audit Harness - Return to Home"
        >
          <div
            style={{
              width: "12px",
              height: "12px",
              background: "var(--accent-cyan)",
              borderRadius: "50%",
              boxShadow: "0 0 10px var(--accent-cyan)",
            }}
            aria-hidden="true"
          />
          <span
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "var(--text-bright)",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
            }}
          >
            Audit Harness
          </span>
        </button>

        <span style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>/</span>

        <span
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          {getViewTitle()}
        </span>

        {targetRepo && (
          <span
            style={{
              fontSize: "0.75rem",
              fontFamily: "var(--font-mono)",
              color: "var(--accent-cyan)",
              background: "var(--accent-cyan-bg)",
              border: "1px solid rgba(6, 182, 212, 0.3)",
              padding: "2px 8px",
              borderRadius: "4px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "240px",
            }}
            title={targetRepo}
          >
            {targetRepo.replace(/^https?:\/\/github\.com\//, "")}
            {findingId ? ` : ${findingId}` : ""}
          </span>
        )}
      </div>

      {/* Right Side: Status Telemetry & Navigation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          flexShrink: 0,
        }}
      >
        {/* Daemon Connection Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "0.75rem",
            color:
              daemonStatus === "online"
                ? "var(--text-normal)"
                : "var(--text-muted)",
            background: "var(--surface-card)",
            padding: "4px 10px",
            borderRadius: "6px",
            border: "1px solid var(--border-subtle)",
          }}
          title={
            daemonStatus === "online"
              ? `Connected (latency: ${daemonLatency ?? 0}ms)`
              : "Daemon offline or unreachable"
          }
        >
          <span
            style={{
              display: "inline-block",
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background:
                daemonStatus === "online"
                  ? "var(--accent-emerald)"
                  : daemonStatus === "checking"
                    ? "var(--accent-amber)"
                    : "var(--accent-rose)",
              boxShadow:
                daemonStatus === "online"
                  ? "0 0 6px var(--accent-emerald)"
                  : daemonStatus === "checking"
                    ? "0 0 6px var(--accent-amber)"
                    : "none",
            }}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
            Daemon :3000
          </span>
          {daemonLatency !== null && daemonStatus === "online" && (
            <span
              className="tabular-nums"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                fontSize: "0.7rem",
              }}
            >
              {daemonLatency}ms
            </span>
          )}
        </div>

        {/* Navigation & Mode Controls */}
        <nav
          aria-label="Application View Mode"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "2px",
            background: "var(--surface-card)",
            padding: "2px",
            borderRadius: "8px",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              onSelectMode("live");
              onSelectView("judge");
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              padding: "5px 10px",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.8rem",
              background:
                activeMode === "live" && activeView !== "dashboard"
                  ? "var(--surface-hover)"
                  : "transparent",
              color:
                activeMode === "live" && activeView !== "dashboard"
                  ? "var(--text-bright)"
                  : "var(--text-muted)",
              transition: "all 0.15s ease",
            }}
            aria-current={
              activeMode === "live" && activeView !== "dashboard"
                ? "page"
                : undefined
            }
          >
            <Zap size={13} color="var(--accent-cyan)" />
            <span>⚡ Live Mode</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectMode("demo");
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              padding: "5px 10px",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.8rem",
              background:
                activeMode === "demo"
                  ? "var(--accent-emerald-bg)"
                  : "transparent",
              color:
                activeMode === "demo"
                  ? "var(--accent-emerald)"
                  : "var(--text-muted)",
              transition: "all 0.15s ease",
            }}
            aria-current={activeMode === "demo" ? "page" : undefined}
          >
            <Play size={13} fill="currentColor" color="var(--accent-emerald)" />
            <span>🎬 Demo Mode</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectMode("live");
              onSelectView("dashboard");
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              padding: "5px 10px",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.8rem",
              background:
                activeView === "dashboard"
                  ? "var(--accent-purple-bg)"
                  : "transparent",
              color:
                activeView === "dashboard"
                  ? "var(--accent-purple)"
                  : "var(--text-muted)",
              transition: "all 0.15s ease",
            }}
            aria-current={activeView === "dashboard" ? "page" : undefined}
          >
            <LayoutDashboard
              size={13}
              color={
                activeView === "dashboard"
                  ? "var(--accent-purple)"
                  : "var(--text-muted)"
              }
            />
            <span>📊 Dashboard</span>
          </button>
        </nav>
      </div>
    </header>
  );
};
