import React, { useState } from "react";
import { Play, Settings, ShieldAlert, Cpu } from "lucide-react";

interface JudgeFormProps {
  onStartRun: (config: any) => void;
  isStarting: boolean;
}

export const JudgeForm: React.FC<JudgeFormProps> = ({
  onStartRun,
  isStarting,
}) => {
  const [repo, setRepo] = useState("https://github.com/demo/project");
  const [findingId, setFindingId] = useState("CEI-001");
  const [modelName, setModelName] = useState("claude-3-5-sonnet");
  const [tokenBudget, setTokenBudget] = useState(50000);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStartRun({ repo, findingId, modelName, tokenBudget });
  };

  return (
    <div style={{ maxWidth: "900px", margin: "40px auto", padding: "0 24px" }}>
      <div style={{ textAlign: "center", marginBottom: "40px" }}>
        <h1
          style={{
            fontSize: "2.5rem",
            fontWeight: 700,
            marginBottom: "12px",
            background: "var(--judge-accent)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Audit Initialization
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
          Configure and deploy an AI Agent to verify security findings.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 350px",
          gap: "24px",
        }}
      >
        {/* Cột trái - Input chính */}
        <div
          className="glass-panel"
          style={{
            padding: "32px",
            borderRadius: "var(--border-radius-lg, 16px)",
          }}
        >
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              marginBottom: "24px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <ShieldAlert size={20} color="var(--accent-cyan)" />
            Target Configuration
          </h2>

          <div style={{ marginBottom: "24px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "8px",
                color: "var(--text-secondary)",
                fontSize: "0.9rem",
              }}
            >
              Target Repository URL
            </label>
            <input
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "12px 16px",
                background: "rgba(15, 23, 42, 0.5)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "1rem",
                outline: "none",
                transition: "all 0.2s",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--accent-cyan)";
                e.target.style.boxShadow = "0 0 0 2px rgba(6, 182, 212, 0.2)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--border-color)";
                e.target.style.boxShadow = "none";
              }}
            />
          </div>

          <div style={{ marginBottom: "32px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "8px",
                color: "var(--text-secondary)",
                fontSize: "0.9rem",
              }}
            >
              Finding ID (Issue/Vulnerability to Verify)
            </label>
            <input
              type="text"
              value={findingId}
              onChange={(e) => setFindingId(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "12px 16px",
                background: "rgba(15, 23, 42, 0.5)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "1rem",
                outline: "none",
                transition: "all 0.2s",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--accent-cyan)";
                e.target.style.boxShadow = "0 0 0 2px rgba(6, 182, 212, 0.2)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--border-color)";
                e.target.style.boxShadow = "none";
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isStarting}
            style={{
              width: "100%",
              padding: "16px",
              background: "var(--judge-accent)",
              color: "#fff",
              borderRadius: "8px",
              fontWeight: 700,
              fontSize: "1.1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              boxShadow: "0 4px 14px rgba(6, 182, 212, 0.4)",
              opacity: isStarting ? 0.7 : 1,
              cursor: isStarting ? "not-allowed" : "pointer",
            }}
            onMouseOver={(e) => {
              if (!isStarting) e.currentTarget.style.transform = "scale(1.02)";
            }}
            onMouseOut={(e) => {
              if (!isStarting) e.currentTarget.style.transform = "scale(1)";
            }}
          >
            {isStarting ? (
              <span
                style={{ display: "flex", alignItems: "center", gap: "10px" }}
              >
                <span
                  className="animate-spin"
                  style={{
                    display: "inline-block",
                    width: "20px",
                    height: "20px",
                    border: "2px solid #fff",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                  }}
                ></span>
                Initializing Agent...
              </span>
            ) : (
              <>
                <Play size={20} fill="currentColor" />
                Start Audit Run
              </>
            )}
          </button>
        </div>

        {/* Cột phải - Cấu hình nâng cao */}
        <div
          className="glass-panel"
          style={{
            padding: "24px",
            borderRadius: "var(--border-radius-lg, 16px)",
            height: "fit-content",
          }}
        >
          <h2
            style={{
              fontSize: "1.1rem",
              fontWeight: 600,
              marginBottom: "20px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "var(--text-secondary)",
            }}
          >
            <Settings size={18} />
            Agent Settings
          </h2>

          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "8px",
                color: "var(--text-muted)",
                fontSize: "0.85rem",
              }}
            >
              <Cpu
                size={14}
                style={{
                  display: "inline",
                  verticalAlign: "middle",
                  marginRight: "4px",
                }}
              />
              Model Selection
            </label>
            <select
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                background: "rgba(15, 23, 42, 0.8)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                color: "var(--text-primary)",
                fontSize: "0.9rem",
                outline: "none",
              }}
            >
              <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
              <option value="gpt-4o">GPT-4o (OpenAI)</option>
              <option value="fake-model">Fake Model (Testing)</option>
            </select>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "8px",
                color: "var(--text-muted)",
                fontSize: "0.85rem",
              }}
            >
              <span>Token Budget</span>
              <span style={{ color: "var(--accent-cyan)" }}>
                {tokenBudget.toLocaleString()}
              </span>
            </label>
            <input
              type="range"
              min={10000}
              max={150000}
              step={5000}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(parseInt(e.target.value))}
              style={{ width: "100%", accentColor: "var(--accent-cyan)" }}
            />
          </div>
        </div>
      </form>
    </div>
  );
};
