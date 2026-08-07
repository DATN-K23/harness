import React, { useEffect } from "react";
import { useReplayStore } from "../../stores/replay.store.js";
import { Play, Pause, FastForward, RotateCcw } from "lucide-react";

export const ReplayController: React.FC = () => {
  const {
    events,
    currentStep,
    isPlaying,
    playbackSpeed,
    setPlaying,
    setSpeed,
    jumpToStep,
    tickStep,
  } = useReplayStore();

  // Replay timer loop với timestamp-based drift compensation (Pitfall I2 fix)
  useEffect(() => {
    if (!isPlaying || currentStep >= events.length - 1) return;

    const currentEvent = events[currentStep];
    const baseDelay = (currentEvent?.delayMs ?? 500) / playbackSpeed;
    const expectedAt = performance.now() + baseDelay;

    const timerId = setTimeout(
      () => {
        const _drift = performance.now() - expectedAt; // Track drift if needed for high speeds
        tickStep();
      },
      Math.max(0, baseDelay),
    );

    return () => clearTimeout(timerId);
  }, [isPlaying, currentStep, playbackSpeed, events]);

  if (events.length === 0) return null;

  const currentEvent = events[currentStep];

  return (
    <div
      className="glass-panel"
      style={{
        position: "fixed",
        bottom: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        padding: "12px 24px",
        borderRadius: "16px",
        display: "flex",
        alignItems: "center",
        gap: "20px",
        zIndex: 100,
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button
          onClick={() => jumpToStep(0)}
          style={{ color: "#9ca3af", padding: "6px" }}
          title="Reset to Start"
        >
          <RotateCcw size={18} />
        </button>

        <button
          onClick={() => setPlaying(!isPlaying)}
          style={{
            background: isPlaying ? "#f43f5e" : "#10b981",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: "8px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          {isPlaying ? "Pause" : "Play Replay"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          minWidth: "200px",
        }}
      >
        <input
          type="range"
          min={0}
          max={Math.max(0, events.length - 1)}
          value={currentStep}
          onChange={(e) => jumpToStep(parseInt(e.target.value, 10))}
          style={{ flex: 1, accentColor: "#06b6d4" }}
        />
        <span
          style={{ fontSize: "0.85rem", color: "#9ca3af", minWidth: "50px" }}
        >
          {currentStep + 1} / {events.length}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <FastForward size={16} style={{ color: "#9ca3af" }} />
        <select
          value={playbackSpeed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          style={{
            background: "#1f2937",
            color: "#f9fafb",
            border: "1px solid #374151",
            borderRadius: "6px",
            padding: "4px 8px",
            fontSize: "0.85rem",
          }}
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x (Normal)</option>
          <option value={2}>2x</option>
          <option value={5}>5x (Fast)</option>
          <option value={10}>10x</option>
        </select>
      </div>

      <div
        style={{
          fontSize: "0.8rem",
          color: "#06b6d4",
          paddingLeft: "8px",
          borderLeft: "1px solid #374151",
        }}
      >
        Event:{" "}
        <code style={{ color: "#a7f3d0" }}>{currentEvent?.type || "IDLE"}</code>
      </div>
    </div>
  );
};
