import React from "react";
import type { VerdictSchema as Verdict } from "../../generated/api/index.js";

interface VerdictBannerProps {
  verdict: Verdict | null | undefined;
}

export const VerdictBanner: React.FC<VerdictBannerProps> = ({ verdict }) => {
  if (!verdict) return null;

  // VALID = lỗ hổng tồn tại = NGUY HIỂM (đỏ rực)
  // INVALID = lỗ hổng không tồn tại = AN TOÀN (xanh êm)
  const isVulnerable = verdict.status === "VALID";

  const confidencePct = Math.round(verdict.confidenceScore * 100);

  return (
    <div
      className={isVulnerable ? "verdict-glow-danger" : "verdict-glow-success"}
      style={{
        background: isVulnerable
          ? "rgba(244, 63, 94, 0.08)"
          : "rgba(16, 185, 129, 0.08)",
        border: `1px solid ${isVulnerable ? "rgba(244, 63, 94, 0.5)" : "rgba(16, 185, 129, 0.5)"}`,
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <span style={{ fontSize: "1.5rem" }}>
              {isVulnerable ? "🚨" : "✅"}
            </span>
            <h3
              style={{
                fontSize: "1.15rem",
                fontWeight: 700,
                color: isVulnerable ? "#f43f5e" : "#10b981",
              }}
            >
              Verdict: {verdict.status}
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
                background: isVulnerable
                  ? "rgba(244, 63, 94, 0.2)"
                  : "rgba(16, 185, 129, 0.2)",
                color: isVulnerable ? "#fca5a5" : "#6ee7b7",
                border: `1px solid ${isVulnerable ? "rgba(244, 63, 94, 0.3)" : "rgba(16, 185, 129, 0.3)"}`,
              }}
            >
              {verdict.severity}
            </span>
          </div>
        </div>

        {/* Confidence score */}
        <div style={{ textAlign: "right", minWidth: "120px" }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "6px" }}>
            AI Confidence
          </div>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: 800,
              color: isVulnerable ? "#f43f5e" : "#10b981",
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
                background: isVulnerable
                  ? "linear-gradient(90deg, #f43f5e, #be123c)"
                  : "linear-gradient(90deg, #10b981, #059669)",
                borderRadius: "2px",
                transition: "width 1s ease-out",
              }}
            />
          </div>
        </div>
      </div>

      {/* Explanation */}
      <p style={{ color: "#d1d5db", fontSize: "0.95rem", lineHeight: "1.6", marginBottom: verdict.pocSourceCode ? "16px" : "0" }}>
        {verdict.explanation}
      </p>

      {/* PoC Source Code */}
      {verdict.pocSourceCode && (
        <div style={{ marginTop: "16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            <span style={{ fontSize: "0.75rem", color: "var(--accent-rose)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>
              🧪 Verification PoC
            </span>
          </div>
          <pre
            style={{
              background: "rgba(0, 0, 0, 0.4)",
              padding: "16px",
              borderRadius: "10px",
              overflowX: "auto",
              fontSize: "0.85rem",
              color: "#fca5a5",
              border: "1px solid rgba(244, 63, 94, 0.2)",
              fontFamily: "var(--font-mono)",
              lineHeight: "1.6",
            }}
          >
            {verdict.pocSourceCode}
          </pre>
        </div>
      )}
    </div>
  );
};
