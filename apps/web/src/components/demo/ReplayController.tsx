import React, { useEffect, useRef } from "react";
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
    seekToStep,
    tickStep,
  } = useReplayStore();

  /**
   * W2 Fix: Drift compensation thực sự bằng cách track accumulated drift
   * qua useRef và trừ khỏi delay của tick tiếp theo.
   *
   * Vấn đề gốc (Pitfall I2):
   * - setTimeout(fn, 500) ở tốc độ 10x → baseDelay = 50ms
   * - Mỗi lần setTimeout fire trễ 5ms → sau 100 tick: 500ms drift
   *
   * Giải pháp: Đo thực tế vs expected, trừ drift vào lần tiếp theo.
   */
  const driftRef = useRef<number>(0);
  const expectedAtRef = useRef<number>(performance.now());

  useEffect(() => {
    if (!isPlaying || currentStep >= events.length - 1) {
      // Reset drift khi dừng hoặc hết events
      driftRef.current = 0;
      return;
    }

    const currentEvent = events[currentStep];
    const nominalDelay = (currentEvent?.delayMs ?? 500) / playbackSpeed;

    // Compensate: trừ accumulated drift từ tick trước
    const compensatedDelay = Math.max(0, nominalDelay - driftRef.current);

    const scheduledAt = performance.now();
    const timerId = setTimeout(() => {
      const actualAt = performance.now();
      // Đo drift của tick này và cộng dồn cho tick tiếp theo
      const thisDrift = actualAt - scheduledAt - compensatedDelay;
      driftRef.current = Math.max(0, thisDrift); // Không bù trừ âm (không "tăng tốc")

      expectedAtRef.current = actualAt + nominalDelay;
      tickStep();
    }, compensatedDelay);

    return () => clearTimeout(timerId);
  }, [isPlaying, currentStep, playbackSpeed, events]);

  if (events.length === 0) return null;

  const currentEvent = events[currentStep];
  const progress =
    events.length > 1 ? (currentStep / (events.length - 1)) * 100 : 0;

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
        minWidth: "600px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button
          onClick={() => {
            driftRef.current = 0;
            jumpToStep(0);
          }}
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
          flex: 1,
          minWidth: "200px",
        }}
      >
        <input
          type="range"
          min={0}
          max={Math.max(0, events.length - 1)}
          value={currentStep}
          onChange={(e) => {
            driftRef.current = 0;
            // NW5 Fix: seekToStep — không dừng play khi user scrub slider
            seekToStep(parseInt(e.target.value, 10));
          }}
          style={{ flex: 1, accentColor: "#06b6d4" }}
        />
        <span
          style={{ fontSize: "0.85rem", color: "#9ca3af", minWidth: "60px" }}
        >
          {currentStep + 1} / {events.length}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <FastForward size={16} style={{ color: "#9ca3af" }} />
        <select
          value={playbackSpeed}
          onChange={(e) => {
            driftRef.current = 0; // Reset drift khi đổi tốc độ
            setSpeed(parseFloat(e.target.value));
          }}
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
        <div>
          Event:{" "}
          <code style={{ color: "#a7f3d0" }}>{currentEvent?.type || "IDLE"}</code>
        </div>
        <div style={{ color: "#4b5563", fontSize: "0.7rem", marginTop: "2px" }}>
          {Math.round(progress)}% complete
        </div>
      </div>
    </div>
  );
};
