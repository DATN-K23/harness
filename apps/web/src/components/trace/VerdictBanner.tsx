import React from "react";
import type { Verdict } from "@audit-harness/contracts";

interface VerdictBannerProps {
  verdict: Verdict | null | undefined;
}

export const VerdictBanner: React.FC<VerdictBannerProps> = ({ verdict }) => {
  if (!verdict) return null;

  const isSuccess = verdict.status === "VALID";

  return (
    <div
      style={{
        background: isSuccess
          ? "rgba(16, 185, 129, 0.1)"
          : "rgba(244, 63, 94, 0.1)",
        border: `1px solid ${isSuccess ? "#10b981" : "#f43f5e"}`,
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "24px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <h3
          style={{
            fontSize: "1.1rem",
            fontWeight: 700,
            color: isSuccess ? "#10b981" : "#f43f5e",
          }}
        >
          Audit Verdict: {verdict.status} ({verdict.severity})
        </h3>
        <span style={{ fontSize: "0.875rem", color: "#9ca3af" }}>
          Confidence: {Math.round(verdict.confidenceScore * 100)}%
        </span>
      </div>
      <p style={{ color: "#d1d5db", fontSize: "0.95rem", lineHeight: "1.5" }}>
        {verdict.explanation}
      </p>
      {verdict.pocSourceCode && (
        <div style={{ marginTop: "16px" }}>
          <h4
            style={{
              fontSize: "0.875rem",
              color: "#9ca3af",
              marginBottom: "8px",
            }}
          >
            Verification PoC Test:
          </h4>
          <pre
            style={{
              background: "#111827",
              padding: "12px",
              borderRadius: "8px",
              overflowX: "auto",
              fontSize: "0.85rem",
              color: "#38bdf8",
            }}
          >
            {verdict.pocSourceCode}
          </pre>
        </div>
      )}
    </div>
  );
};
