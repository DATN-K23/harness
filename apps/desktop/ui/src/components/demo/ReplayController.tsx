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
        bottom: "40px",
        left: "50%",
        transform: "translateX(-50%)",
        padding: "16px 32px",
        borderRadius: "40px" /* Pill shape */,
        display: "flex",
        alignItems: "center",
        gap: "24px",
        zIndex: 100,
        boxShadow: "0 20px 40px -10px rgba(0, 0, 0, 0.5)",
        border: "1px solid var(--glass-border)",
        background: "rgba(11, 17, 32, 0.7)" /* Darker glass for player */,
        backdropFilter: "blur(40px) saturate(200%)",
        minWidth: "650px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button
          onClick={() => {
            driftRef.current = 0;
            jumpToStep(0);
          }}
          style={{
            color: "var(--text-secondary)",
            padding: "8px",
            borderRadius: "50%",
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
          }}
          onMouseOver={(e) =>
            (e.currentTarget.style.background = "rgba(255,255,255,0.1)")
          }
          onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
          title="Reset to Start"
        >
          <RotateCcw size={20} />
        </button>

        <button
          onClick={() => setPlaying(!isPlaying)}
          style={{
            background: isPlaying
              ? "var(--bg-card-hover)"
              : "var(--accent-cyan)",
            color: isPlaying ? "var(--text-primary)" : "#fff",
            padding: "12px 24px",
            borderRadius: "30px",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxShadow: isPlaying ? "none" : "0 4px 12px rgba(6, 182, 212, 0.3)",
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onMouseOver={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
          onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          {isPlaying ? (
            <Pause size={18} />
          ) : (
            <Play size={18} fill="currentColor" />
          )}
          {isPlaying ? "Pause" : "Play"}
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
          style={{
            flex: 1,
            accentColor: "var(--accent-cyan)",
            cursor: "pointer",
          }}
        />
        <span
          style={{
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            minWidth: "60px",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {currentStep + 1} / {events.length}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <FastForward size={18} style={{ color: "var(--text-muted)" }} />
        <select
          value={playbackSpeed}
          onChange={(e) => {
            driftRef.current = 0; // Reset drift khi đổi tốc độ
            setSpeed(parseFloat(e.target.value));
          }}
          style={{
            background: "rgba(255, 255, 255, 0.05)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "6px 10px",
            fontSize: "0.85rem",
            outline: "none",
            cursor: "pointer",
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
          fontSize: "0.75rem",
          color: "var(--accent-cyan)",
          paddingLeft: "16px",
          borderLeft: "1px solid var(--border-color)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          Event:{" "}
          <code
            style={{
              color: "var(--text-primary)",
              background: "rgba(0,0,0,0.3)",
              padding: "2px 6px",
              borderRadius: "4px",
            }}
          >
            {currentEvent?.type || "IDLE"}
          </code>
        </div>
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "0.7rem",
            marginTop: "4px",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(progress)}% complete
        </div>
      </div>
    </div>
  );
};
