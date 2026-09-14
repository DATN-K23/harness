import React, { useState } from "react";
import {
  Play,
  Settings,
  ShieldAlert,
  Cpu,
  CheckCircle2,
  Wrench,
  Sparkles,
  AlertCircle,
} from "lucide-react";

interface JudgeFormProps {
  onStartRun: (config: {
    repo: string;
    findingId: string;
    modelName: string;
    tokenBudget: number;
  }) => void;
  isStarting: boolean;
}

interface TestPreset {
  name: string;
  repo: string;
  findingId: string;
  description: string;
}

const TEST_PRESETS: TestPreset[] = [
  {
    name: "Vault Reentrancy",
    repo: "https://github.com/demo/project",
    findingId: "CEI-001",
    description: "State update after external call vulnerability",
  },
  {
    name: "OpenZeppelin ERC20",
    repo: "https://github.com/OpenZeppelin/openzeppelin-contracts",
    findingId: "OZ-ERC20-404",
    description: "Transfer fee round-down edge condition",
  },
  {
    name: "Uniswap-v3 Core",
    repo: "https://github.com/Uniswap/v3-core",
    findingId: "UNI-SWAP-009",
    description: "Tick math overflow boundary check",
  },
];

export const JudgeForm: React.FC<JudgeFormProps> = ({
  onStartRun,
  isStarting,
}) => {
  const [repo, setRepo] = useState("https://github.com/demo/project");
  const [findingId, setFindingId] = useState("CEI-001");
  const [modelName, setModelName] = useState("claude-3-5-sonnet");
  const [tokenBudget, setTokenBudget] = useState(50000);

  const [errors, setErrors] = useState<{ repo?: string; findingId?: string }>(
    {},
  );
  const [isShaking, setIsShaking] = useState(false);

  const validateForm = (): boolean => {
    const newErrors: { repo?: string; findingId?: string } = {};
    if (!repo.trim()) {
      newErrors.repo = "Target repository URL is required.";
    } else if (
      !repo.startsWith("http://") &&
      !repo.startsWith("https://") &&
      !repo.startsWith("git@")
    ) {
      newErrors.repo = "Repository URL must be a valid HTTP(S) or Git address.";
    }

    if (!findingId.trim()) {
      newErrors.findingId = "Finding identifier is required.";
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
      return false;
    }
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      onStartRun({ repo, findingId, modelName, tokenBudget });
    }
  };

  const applyPreset = (preset: TestPreset) => {
    setRepo(preset.repo);
    setFindingId(preset.findingId);
    setErrors({});
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "24px auto", padding: "0 32px" }}>
      {/* Header Banner */}
      <div style={{ marginBottom: "28px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "6px",
          }}
        >
          <span
            style={{
              padding: "4px 10px",
              background: "rgba(6, 182, 212, 0.15)",
              border: "1px solid rgba(6, 182, 212, 0.4)",
              borderRadius: "20px",
              color: "var(--accent-cyan)",
              fontSize: "0.78rem",
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Autonomous Judge Engine v1.0
          </span>
        </div>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 700,
            marginBottom: "6px",
            color: "var(--text-primary)",
            letterSpacing: "-0.5px",
          }}
        >
          Security Audit Initialization
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
          Deploy an autonomous AI agent in a sandboxed runtime to verify smart
          contract vulnerability claims.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className={isShaking ? "animate-shake" : ""}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)",
          gap: "24px",
          alignItems: "stretch",
        }}
      >
        {/* Left Column: Target Configuration & Presets */}
        <div
          className="glass-panel"
          style={{
            padding: "28px",
            borderRadius: "14px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
              }}
            >
              <h2
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  color: "var(--text-primary)",
                }}
              >
                <ShieldAlert size={18} color="var(--accent-cyan)" />
                Target Specification
              </h2>
              <span
                style={{
                  fontSize: "0.8rem",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Zero-Trust Sandbox
              </span>
            </div>

            {/* Quick Test Presets */}
            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  marginBottom: "8px",
                  color: "var(--text-secondary)",
                  fontSize: "0.82rem",
                  fontWeight: 500,
                }}
              >
                <Sparkles size={14} color="var(--accent-amber)" />
                Quick Test Presets (1-Click Load)
              </label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {TEST_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => applyPreset(p)}
                    style={{
                      padding: "6px 12px",
                      background:
                        findingId === p.findingId
                          ? "rgba(6, 182, 212, 0.2)"
                          : "rgba(30, 41, 59, 0.6)",
                      border:
                        findingId === p.findingId
                          ? "1px solid var(--accent-cyan)"
                          : "1px solid var(--border-color)",
                      borderRadius: "6px",
                      color:
                        findingId === p.findingId
                          ? "var(--accent-cyan)"
                          : "var(--text-secondary)",
                      fontSize: "0.82rem",
                      fontWeight: 500,
                      transition: "all 0.15s ease",
                    }}
                  >
                    ⚡ {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Repository URL Input */}
            <div style={{ marginBottom: "18px" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "6px",
                  color: "var(--text-secondary)",
                  fontSize: "0.88rem",
                  fontWeight: 500,
                }}
              >
                Target Repository URL{" "}
                <span style={{ color: "var(--accent-rose)" }}>*</span>
              </label>
              <input
                type="text"
                value={repo}
                onChange={(e) => {
                  setRepo(e.target.value);
                  if (errors.repo) setErrors({ ...errors, repo: undefined });
                }}
                className={errors.repo ? "input-error" : ""}
                placeholder="https://github.com/org/smart-contract-repo"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  background: "rgba(15, 23, 42, 0.7)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                  fontSize: "0.92rem",
                  fontFamily: "var(--font-mono)",
                  outline: "none",
                  transition: "all 0.2s",
                }}
              />
              {errors.repo && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    marginTop: "6px",
                    color: "var(--accent-rose)",
                    fontSize: "0.8rem",
                  }}
                >
                  <AlertCircle size={14} />
                  {errors.repo}
                </div>
              )}
            </div>

            {/* Finding ID Input */}
            <div style={{ marginBottom: "24px" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "6px",
                  color: "var(--text-secondary)",
                  fontSize: "0.88rem",
                  fontWeight: 500,
                }}
              >
                Finding ID / Vulnerability Key{" "}
                <span style={{ color: "var(--accent-rose)" }}>*</span>
              </label>
              <input
                type="text"
                value={findingId}
                onChange={(e) => {
                  setFindingId(e.target.value);
                  if (errors.findingId)
                    setErrors({ ...errors, findingId: undefined });
                }}
                className={errors.findingId ? "input-error" : ""}
                placeholder="e.g. CEI-001, H-01, VULN-2026"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  background: "rgba(15, 23, 42, 0.7)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                  fontSize: "0.92rem",
                  fontFamily: "var(--font-mono)",
                  outline: "none",
                  transition: "all 0.2s",
                }}
              />
              {errors.findingId && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    marginTop: "6px",
                    color: "var(--accent-rose)",
                    fontSize: "0.8rem",
                  }}
                >
                  <AlertCircle size={14} />
                  {errors.findingId}
                </div>
              )}
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isStarting}
            style={{
              width: "100%",
              padding: "14px 20px",
              background: "var(--judge-accent)",
              color: "#ffffff",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              boxShadow: "0 4px 16px rgba(6, 182, 212, 0.35)",
              opacity: isStarting ? 0.75 : 1,
              cursor: isStarting ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
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
                    width: "18px",
                    height: "18px",
                    border: "2px solid #ffffff",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                  }}
                />
                Deploying Agent Sandbox...
              </span>
            ) : (
              <>
                <Play size={18} fill="currentColor" />
                Start Verification Run
              </>
            )}
          </button>
        </div>

        {/* Right Column: Agent Settings & Capabilities Preview */}
        <div
          className="glass-panel"
          style={{
            padding: "28px",
            borderRadius: "14px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
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
              Runtime Telemetry & Quota
            </h2>

            {/* Model Selection */}
            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "8px",
                  color: "var(--text-secondary)",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                }}
              >
                <Cpu
                  size={14}
                  style={{
                    display: "inline",
                    verticalAlign: "middle",
                    marginRight: "6px",
                  }}
                />
                LLM Inference Engine
              </label>
              <select
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "rgba(15, 23, 42, 0.8)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              >
                <option value="claude-3-5-sonnet">
                  Claude 3.5 Sonnet (Recommended)
                </option>
                <option value="gpt-4o">GPT-4o (OpenAI)</option>
                <option value="fake-model">Mock Simulator (Offline QA)</option>
              </select>
            </div>

            {/* Token Budget Range */}
            <div style={{ marginBottom: "24px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "8px",
                  fontSize: "0.85rem",
                }}
              >
                <span style={{ color: "var(--text-secondary)" }}>
                  Max Token Quota
                </span>
                <span
                  style={{
                    color: "var(--accent-cyan)",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                  }}
                >
                  {tokenBudget.toLocaleString()} tokens
                </span>
              </div>
              <input
                type="range"
                min={10000}
                max={150000}
                step={5000}
                value={tokenBudget}
                onChange={(e) => setTokenBudget(parseInt(e.target.value, 10))}
                style={{ width: "100%", accentColor: "var(--accent-cyan)" }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "var(--text-muted)",
                  fontSize: "0.75rem",
                  marginTop: "4px",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <span>10k (Fast Scan)</span>
                <span>150k (Deep Formal)</span>
              </div>
            </div>

            {/* Sandbox Capabilities Checklist */}
            <div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  marginBottom: "10px",
                  color: "var(--text-secondary)",
                  fontSize: "0.82rem",
                  fontWeight: 500,
                }}
              >
                <Wrench size={14} />
                Allowed Sandbox Tools
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                  fontSize: "0.8rem",
                  color: "var(--text-secondary)",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <CheckCircle2 size={14} color="var(--accent-emerald)" />
                  <code>read_file</code>
                </div>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <CheckCircle2 size={14} color="var(--accent-emerald)" />
                  <code>exec_script</code>
                </div>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <CheckCircle2 size={14} color="var(--accent-emerald)" />
                  <code>forge_test</code>
                </div>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <CheckCircle2 size={14} color="var(--accent-emerald)" />
                  <code>ast_grep</code>
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              padding: "12px",
              background: "rgba(6, 182, 212, 0.05)",
              border: "1px dashed rgba(6, 182, 212, 0.3)",
              borderRadius: "8px",
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              lineHeight: 1.4,
              marginTop: "20px",
            }}
          >
            🔒 All tools execute in isolated ephemeral containers. Network
            access is strictly air-gapped.
          </div>
        </div>
      </form>
    </div>
  );
};
