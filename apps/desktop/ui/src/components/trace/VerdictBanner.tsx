import React from "react";
import type { VerdictSchema as Verdict } from "../../generated/api/index.js";

interface VerdictBannerProps {
  verdict: Verdict | null | undefined;
}

export const VerdictBanner: React.FC<VerdictBannerProps> = ({ verdict }) => {
  if (!verdict) return null;

  const {
    validity,
    severity,
    confidence,
    rationale,
    evidence,
    verificationStatus,
  } = verdict;

  const isVulnerable = validity === "valid";
  const isHighSeverity = severity === "high" || severity === "critical";

  const confidencePct = Math.round(confidence * 100);

  let glowClass = "verdict-glow-success";
  let themeColor = "#10b981"; // Success Green
  let bgRgba = "rgba(16, 185, 129, 0.08)";
  let borderRgba = "rgba(16, 185, 129, 0.5)";
  let gradient = "linear-gradient(90deg, #10b981, #059669)";

  if (isVulnerable) {
    if (isHighSeverity) {
      glowClass = "verdict-glow-danger";
      themeColor = "#f43f5e"; // Rose
      bgRgba = "rgba(244, 63, 94, 0.08)";
      borderRgba = "rgba(244, 63, 94, 0.5)";
      gradient = "linear-gradient(90deg, #f43f5e, #be123c)";
    } else {
      glowClass = "verdict-glow-warning";
      themeColor = "#f59e0b"; // Amber
      bgRgba = "rgba(245, 158, 11, 0.08)";
      borderRgba = "rgba(245, 158, 11, 0.5)";
      gradient = "linear-gradient(90deg, #f59e0b, #d97706)";
    }
  }

  return (
    <div
      className={glowClass}
      style={{
        background: bgRgba,
        border: `1px solid ${borderRgba}`,
        borderRadius: "16px",
        padding: "24px",
        marginBottom: "24px",
        animation: "fadeInUp 0.4s ease-out forwards",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "16px",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "6px",
            }}
          >
            <span style={{ fontSize: "1.5rem" }}>
              {isVulnerable ? (isHighSeverity ? "🚨" : "⚠️") : "✅"}
            </span>
            <h3
              style={{
                fontSize: "1.15rem",
                fontWeight: 700,
                color: themeColor,
                textTransform: "capitalize",
              }}
            >
              Verdict: {validity}
            </h3>
            {/* Severity badge */}
            <span
              style={{
                padding: "3px 10px",
                borderRadius: "20px",
                fontSize: "0.75rem",
                fontWeight: 700,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                background: bgRgba.replace("0.08", "0.2"),
                color: themeColor,
                border: `1px solid ${bgRgba.replace("0.08", "0.3")}`,
              }}
            >
              {severity}
            </span>
            {/* Unverified tag */}
            {verificationStatus === "unverified" && (
              <span
                style={{
                  padding: "3px 10px",
                  borderRadius: "20px",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  letterSpacing: "0.5px",
                  textTransform: "uppercase",
                  background: "rgba(245, 158, 11, 0.15)",
                  color: "#fcd34d",
                  border: "1px solid rgba(245, 158, 11, 0.4)",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                UNVERIFIED
              </span>
            )}
          </div>
        </div>

        {/* Confidence score */}
        <div style={{ textAlign: "right", minWidth: "120px" }}>
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginBottom: "6px",
            }}
          >
            AI Confidence
          </div>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: 800,
              color: themeColor,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {confidencePct}%
          </div>
          {/* Confidence progress bar */}
          <div
            style={{
              marginTop: "6px",
              height: "4px",
              background: "rgba(255,255,255,0.08)",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${confidencePct}%`,
                background: gradient,
                borderRadius: "2px",
                transition: "width 1s ease-out",
              }}
            />
          </div>
        </div>
      </div>

      {/* Rationale */}
      <p
        style={{
          color: "#d1d5db",
          fontSize: "0.95rem",
          lineHeight: "1.6",
          marginBottom: evidence?.length ? "20px" : "0",
        }}
      >
        {rationale}
      </p>

      {/* Evidence Cards */}
      {evidence && evidence.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "1px",
              marginBottom: "8px",
            }}
          >
            📁 Evidence
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {evidence.map((ev, idx) => (
              <div
                key={idx}
                style={{
                  background: "rgba(0, 0, 0, 0.3)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: "8px",
                  padding: "12px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                }}
                className="glass-panel"
              >
                <div>
                  <span
                    style={{
                      color: "var(--accent-cyan)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.85rem",
                    }}
                  >
                    {ev.path}
                  </span>
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.85rem",
                      marginLeft: "8px",
                    }}
                  >
                    L{ev.startLine}-L{ev.endLine}
                  </span>
                </div>
                {ev.note && (
                  <span
                    style={{
                      color: "var(--text-secondary)",
                      fontSize: "0.85rem",
                    }}
                  >
                    {ev.note}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
