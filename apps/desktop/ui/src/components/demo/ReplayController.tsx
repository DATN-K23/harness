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
        gap: "16px",
        zIndex: 50,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          type="button"
          onClick={() => {
            driftRef.current = 0;
            jumpToStep(0);
          }}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            padding: "4px 6px",
            borderRadius: "4px",
            transition: "all 0.15s ease",
            display: "inline-flex",
            alignItems: "center",
            cursor: "pointer",
          }}
          onMouseOver={(e) =>
            (e.currentTarget.style.color = "var(--text-primary)")
          }
          onMouseOut={(e) =>
            (e.currentTarget.style.color = "var(--text-secondary)")
          }
          title="Reset to Start"
          aria-label="Reset to Start"
        >
          <RotateCcw size={14} />
        </button>

        <button
          type="button"
          onClick={() => setPlaying(!isPlaying)}
          style={{
            background: isPlaying
              ? "rgba(255, 255, 255, 0.08)"
              : "rgba(6, 182, 212, 0.2)",
            color: isPlaying ? "var(--text-primary)" : "var(--accent-cyan)",
            border: `1px solid ${
              isPlaying ? "var(--border-subtle)" : "rgba(6, 182, 212, 0.4)"
            }`,
            padding: "4px 12px",
            borderRadius: "6px",
            fontWeight: 600,
            fontSize: "0.75rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseOver={(e) =>
            (e.currentTarget.style.background = isPlaying
              ? "rgba(255, 255, 255, 0.12)"
              : "rgba(6, 182, 212, 0.3)")
          }
          onMouseOut={(e) =>
            (e.currentTarget.style.background = isPlaying
              ? "rgba(255, 255, 255, 0.08)"
              : "rgba(6, 182, 212, 0.2)")
          }
        >
          {isPlaying ? (
            <Pause size={13} />
          ) : (
            <Play size={13} fill="currentColor" />
          )}
          {isPlaying ? "Pause" : "Play"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flex: 1,
          maxWidth: "700px",
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
            height: "4px",
          }}
        />
        <span
          className="tabular-nums font-mono"
          style={{
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            minWidth: "65px",
            textAlign: "right",
          }}
        >
          {currentStep + 1} / {events.length}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <FastForward size={13} style={{ color: "var(--text-muted)" }} />
          <select
            value={playbackSpeed}
            onChange={(e) => {
              driftRef.current = 0; // Reset drift khi đổi tốc độ
              setSpeed(parseFloat(e.target.value));
            }}
            style={{
              background: "var(--surface-canvas)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "4px",
              padding: "2px 6px",
              fontSize: "0.75rem",
              fontFamily: "var(--font-mono)",
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1.0x</option>
            <option value={2}>2.0x</option>
            <option value={5}>5.0x</option>
            <option value={10}>10x</option>
          </select>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            paddingLeft: "12px",
            borderLeft: "1px solid var(--border-subtle)",
          }}
        >
          <span
            style={{
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--text-muted)",
            }}
          >
            Event:
          </span>
          <code
            className="font-mono"
            style={{
              fontSize: "0.72rem",
              color: "var(--accent-cyan)",
              background: "rgba(6, 182, 212, 0.08)",
              padding: "1px 6px",
              borderRadius: "3px",
              border: "1px solid rgba(6, 182, 212, 0.15)",
            }}
          >
            {currentEvent?.type || "IDLE"}
          </code>
          <span
            className="tabular-nums font-mono"
            style={{
              color: "var(--text-muted)",
              fontSize: "0.7rem",
            }}
          >
            {Math.round(progress)}%
          </span>
        </div>
      </div>
    </div>
  );
};
