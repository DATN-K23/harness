import React, { useState } from "react";
import type { VerdictSchema as Verdict } from "../../generated/api/index.js";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  FileCode,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface VerdictBannerProps {
  verdict: Verdict | null | undefined;
}

export const VerdictBanner: React.FC<VerdictBannerProps> = ({ verdict }) => {
  const [showFullRationale, setShowFullRationale] = useState(false);
  if (!verdict) return null;

  const {
    validity,
    severity,
    confidence,
    rationale,
    evidence,
    verificationStatus,
  } = verdict;

  const isFindingConfirmed = validity.toLowerCase() === "valid";
  const isHighSeverity =
    severity.toLowerCase() === "high" || severity.toLowerCase() === "critical";

  const confidencePct = Math.round(confidence * 100);

  let themeColor = "var(--accent-emerald)";
  let bgRgba = "var(--accent-emerald-bg)";
  let borderRgba = "rgba(16, 185, 129, 0.35)";
  let badgeBgRgba = "rgba(16, 185, 129, 0.2)";
  let barGradient = "linear-gradient(90deg, var(--accent-emerald), #059669)";

  if (isFindingConfirmed) {
    if (isHighSeverity) {
      themeColor = "var(--accent-rose)";
      bgRgba = "var(--accent-rose-bg)";
      borderRgba = "rgba(244, 63, 94, 0.35)";
      badgeBgRgba = "rgba(244, 63, 94, 0.2)";
      barGradient = "linear-gradient(90deg, var(--accent-rose), #be123c)";
    } else {
      themeColor = "var(--accent-amber)";
      bgRgba = "var(--accent-amber-bg)";
      borderRgba = "rgba(245, 158, 11, 0.35)";
      badgeBgRgba = "rgba(245, 158, 11, 0.2)";
      barGradient = "linear-gradient(90deg, var(--accent-amber), #d97706)";
    }
  }

  const isRationaleLong = (rationale || "").length > 180;

  return (
    <div
      style={{
        background: bgRgba,
        border: `1px solid ${borderRgba}`,
        borderRadius: "8px",
        padding: "12px 16px",
        marginBottom: "12px",
        animation: "fadeInUp 0.3s ease-out forwards",
      }}
    >
      {/* Top HUD Strip */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {isFindingConfirmed ? (
              isHighSeverity ? (
                <ShieldAlert size={18} color="var(--accent-rose)" />
              ) : (
                <AlertTriangle size={18} color="var(--accent-amber)" />
              )
            ) : (
              <ShieldCheck size={18} color="var(--accent-emerald)" />
            )}
          </div>

          <h3
            style={{
              fontSize: "0.95rem",
              fontWeight: 700,
              color: themeColor,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Verdict: {validity}
          </h3>

          {/* Severity badge */}
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "0.72rem",
              fontWeight: 700,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              background: badgeBgRgba,
              color: themeColor,
              border: `1px solid ${borderRgba}`,
            }}
          >
            {severity}
          </span>

          {/* Verification tag */}
          {verificationStatus && (
            <span
              style={{
                padding: "2px 8px",
                borderRadius: "4px",
                fontSize: "0.7rem",
                fontWeight: 600,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                background: "rgba(255, 255, 255, 0.05)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {verificationStatus}
            </span>
          )}
        </div>

        {/* Confidence Gauge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            minWidth: "150px",
          }}
        >
          <div style={{ textAlign: "right" }}>
            <span
              style={{
                fontSize: "0.68rem",
                color: "var(--text-muted)",
                display: "block",
                textTransform: "uppercase",
              }}
            >
              AI Confidence
            </span>
            <span
              className="tabular-nums"
              style={{
                fontSize: "1rem",
                fontWeight: 800,
                color: themeColor,
                fontFamily: "var(--font-mono)",
              }}
            >
              {confidencePct}%
            </span>
          </div>

          <div
            style={{
              width: "70px",
              height: "6px",
              background: "rgba(0, 0, 0, 0.3)",
              borderRadius: "3px",
              overflow: "hidden",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${confidencePct}%`,
                background: barGradient,
                borderRadius: "3px",
              }}
            />
          </div>
        </div>
      </div>

      {/* Rationale */}
      {rationale && (
        <div style={{ marginTop: "8px" }}>
          <p
            style={{
              color: "var(--text-normal)",
              fontSize: "0.82rem",
              lineHeight: "1.4",
              display:
                !showFullRationale && isRationaleLong ? "-webkit-box" : "block",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {rationale}
          </p>

          {isRationaleLong && (
            <button
              type="button"
              onClick={() => setShowFullRationale(!showFullRationale)}
              style={{
                marginTop: "4px",
                color: "var(--accent-cyan)",
                fontSize: "0.72rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                fontWeight: 500,
              }}
            >
              {showFullRationale ? (
                <>
                  Show Less <ChevronUp size={12} />
                </>
              ) : (
                <>
                  Show Full Analysis <ChevronDown size={12} />
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Evidence Chips */}
      {evidence && evidence.length > 0 && (
        <div
          style={{
            marginTop: "8px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "0.68rem",
              color: "var(--text-muted)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              flexShrink: 0,
            }}
          >
            Evidence:
          </span>
          {evidence.map((ev, idx) => (
            <div
              key={idx}
              style={{
                background: "var(--surface-input)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "4px",
                padding: "2px 8px",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "0.72rem",
                maxWidth: "100%",
                overflow: "hidden",
              }}
            >
              <FileCode
                size={11}
                color="var(--accent-cyan)"
                style={{ flexShrink: 0 }}
              />
              <span
                style={{
                  color: "var(--accent-cyan)",
                  fontFamily: "var(--font-mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "320px",
                }}
                title={ev.path}
              >
                {ev.path}
              </span>
              <span
                className="tabular-nums font-mono"
                style={{
                  color: "var(--text-muted)",
                  flexShrink: 0,
                }}
              >
                :L{ev.start_line}-L{ev.end_line}
              </span>
              {ev.note && (
                <span
                  style={{
                    color: "var(--text-dim)",
                    marginLeft: "4px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "240px",
                    flexShrink: 1,
                  }}
                  title={ev.note}
                >
                  ({ev.note})
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
