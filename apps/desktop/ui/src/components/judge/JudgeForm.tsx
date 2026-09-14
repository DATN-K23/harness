import React, { useState, useEffect } from "react";
import {
  Play,
  Cpu,
  CheckCircle2,
  Wrench,
  Sparkles,
  AlertCircle,
  Square,
} from "lucide-react";
import { RunsService, type RunSchema } from "../../generated/api/index.js";

interface JudgeFormProps {
  onStartRun: (config: {
    repo: string;
    findingId: string;
    modelName: string;
    tokenBudget: number;
  }) => void;
  isStarting: boolean;
  activeRun?: RunSchema | null;
  onAbortRun?: () => void;
  onSelectRecentRun?: (runId: string) => void;
}

interface TestPreset {
  name: string;
  repo: string;
  findingId: string;
  description: string;
  tokenBudget?: number;
}

const TEST_PRESETS: TestPreset[] = [
  {
    name: "Vault Reentrancy",
    repo: "https://github.com/demo/project",
    findingId: "CEI-001",
    description: "State update after external call vulnerability",
    tokenBudget: 50000,
  },
  {
    name: "OpenZeppelin ERC20",
    repo: "https://github.com/OpenZeppelin/openzeppelin-contracts",
    findingId: "OZ-ERC20-404",
    description: "Transfer fee round-down edge condition",
    tokenBudget: 75000,
  },
  {
    name: "Uniswap-v3 Core",
    repo: "https://github.com/Uniswap/v3-core",
    findingId: "UNI-SWAP-009",
    description: "Tick math overflow boundary check",
    tokenBudget: 100000,
  },
];

// RFC-compliant Git/HTTP(S)/SSH/Local path regex
const GIT_REPO_REGEX = /^(https?:\/\/|git@|ssh:\/\/|file:\/\/|\/|\.\/)[^\s]+$/;
// Finding identifier regex: 2-64 chars of alphanumeric, dashes, dots, or underscores
const FINDING_ID_REGEX = /^[A-Za-z0-9_.-]{2,64}$/;

export const JudgeForm: React.FC<JudgeFormProps> = ({
  onStartRun,
  isStarting,
  activeRun,
  onAbortRun,
  onSelectRecentRun,
}) => {
  const [repo, setRepo] = useState("https://github.com/demo/project");
  const [findingId, setFindingId] = useState("CEI-001");
  const [modelName, setModelName] = useState("claude-3-5-sonnet");
  const [tokenBudget, setTokenBudget] = useState(50000);

  const [errors, setErrors] = useState<{ repo?: string; findingId?: string }>(
    {},
  );
  const [isShaking, setIsShaking] = useState(false);
  const [recentRuns, setRecentRuns] = useState<RunSchema[]>([]);

  useEffect(() => {
    let mounted = true;
    RunsService.getRunsApiV1RunsGet()
      .then((runs) => {
        if (mounted) {
          setRecentRuns(runs.slice(0, 4));
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [activeRun?.status]);

  const validateForm = (): boolean => {
    const newErrors: { repo?: string; findingId?: string } = {};
    const trimmedRepo = repo.trim();
    const trimmedFinding = findingId.trim();

    if (!trimmedRepo) {
      newErrors.repo = "Target repository URL is required.";
    } else if (!GIT_REPO_REGEX.test(trimmedRepo)) {
      newErrors.repo =
        "Repository URL must be a valid HTTP(S), SSH, or Git address.";
    }

    if (!trimmedFinding) {
      newErrors.findingId = "Finding identifier is required.";
    } else if (!FINDING_ID_REGEX.test(trimmedFinding)) {
      newErrors.findingId =
        "Finding ID must be 2-64 chars (alphanumeric, -, _, .).";
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
      onStartRun({
        repo: repo.trim(),
        findingId: findingId.trim(),
        modelName,
        tokenBudget,
      });
    }
  };

  const applyPreset = (preset: TestPreset) => {
    setRepo(preset.repo);
    setFindingId(preset.findingId);
    if (preset.tokenBudget) {
      setTokenBudget(preset.tokenBudget);
    }
    setErrors({});
  };

  const isRunning = activeRun?.status === "RUNNING";

  return (
    <div
      style={{
        width: "100%",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      {/* Pane Header */}
      <div
        style={{
          borderBottom: "1px solid var(--border-subtle)",
          paddingBottom: "12px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "4px",
          }}
        >
          <span
            style={{
              padding: "2px 8px",
              background: "var(--accent-cyan-bg)",
              border: "1px solid rgba(6, 182, 212, 0.3)",
              borderRadius: "4px",
              color: "var(--accent-cyan)",
              fontSize: "0.7rem",
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Autonomous Judge v1.0
          </span>
          <span
            style={{
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            Zero-Trust Sandbox
          </span>
        </div>
        <h2
          style={{
            fontSize: "1.1rem",
            fontWeight: 700,
            color: "var(--text-bright)",
            letterSpacing: "-0.3px",
            marginTop: "6px",
          }}
        >
          Operational Controls
        </h2>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: "0.78rem",
            marginTop: "2px",
          }}
        >
          Configure verification target, model parameters, and resource bounds.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className={isShaking ? "animate-shake" : ""}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        {/* Quick Test Presets */}
        <div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "6px",
              color: "var(--text-normal)",
              fontSize: "0.78rem",
              fontWeight: 600,
            }}
          >
            <Sparkles size={13} color="var(--accent-amber)" />
            Quick Test Presets (1-Click Load)
          </label>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {TEST_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => applyPreset(p)}
                style={{
                  padding: "5px 10px",
                  background:
                    findingId === p.findingId
                      ? "var(--accent-cyan-bg)"
                      : "var(--surface-input)",
                  border:
                    findingId === p.findingId
                      ? "1px solid var(--accent-cyan)"
                      : "1px solid var(--border-subtle)",
                  borderRadius: "6px",
                  color:
                    findingId === p.findingId
                      ? "var(--accent-cyan)"
                      : "var(--text-normal)",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  transition: "all 0.15s ease",
                  cursor: "pointer",
                }}
              >
                ⚡ {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Target Repository Input */}
        <div>
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "5px",
              color: "var(--text-normal)",
              fontSize: "0.78rem",
              fontWeight: 600,
            }}
          >
            <span>
              Target Repository URL{" "}
              <span style={{ color: "var(--accent-rose)" }}>*</span>
            </span>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
              Git / HTTPS
            </span>
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
              padding: "8px 12px",
              background: "var(--surface-input)",
              border: errors.repo
                ? "1px solid var(--accent-rose)"
                : "1px solid var(--border-medium)",
              borderRadius: "6px",
              color: "var(--text-bright)",
              fontSize: "0.82rem",
              fontFamily: "var(--font-mono)",
              outline: "none",
              transition: "all 0.15s",
            }}
          />
          {errors.repo && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                marginTop: "4px",
                color: "var(--accent-rose)",
                fontSize: "0.72rem",
              }}
            >
              <AlertCircle size={13} />
              <span>{errors.repo}</span>
            </div>
          )}
        </div>

        {/* Finding ID Input with suggestion chips */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "5px",
            }}
          >
            <label
              style={{
                color: "var(--text-normal)",
                fontSize: "0.78rem",
                fontWeight: 600,
              }}
            >
              Finding ID <span style={{ color: "var(--accent-rose)" }}>*</span>
            </label>
            <div style={{ display: "flex", gap: "4px" }}>
              {["CEI-001", "OZ-ERC20-404", "UNI-SWAP-009"].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setFindingId(chip);
                    if (errors.findingId)
                      setErrors({ ...errors, findingId: undefined });
                  }}
                  style={{
                    fontSize: "0.68rem",
                    padding: "1px 5px",
                    borderRadius: "4px",
                    background: "var(--surface-card)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
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
              padding: "8px 12px",
              background: "var(--surface-input)",
              border: errors.findingId
                ? "1px solid var(--accent-rose)"
                : "1px solid var(--border-medium)",
              borderRadius: "6px",
              color: "var(--text-bright)",
              fontSize: "0.82rem",
              fontFamily: "var(--font-mono)",
              outline: "none",
              transition: "all 0.15s",
            }}
          />
          {errors.findingId && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                marginTop: "4px",
                color: "var(--accent-rose)",
                fontSize: "0.72rem",
              }}
            >
              <AlertCircle size={13} />
              <span>{errors.findingId}</span>
            </div>
          )}
        </div>

        {/* Model Selection */}
        <div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "5px",
              color: "var(--text-normal)",
              fontSize: "0.78rem",
              fontWeight: 600,
            }}
          >
            <Cpu size={13} color="var(--accent-cyan)" />
            LLM Inference Engine
          </label>
          <select
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              background: "var(--surface-input)",
              border: "1px solid var(--border-medium)",
              borderRadius: "6px",
              color: "var(--text-bright)",
              fontSize: "0.82rem",
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

        {/* Token Budget Slider */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "4px",
              fontSize: "0.78rem",
            }}
          >
            <span style={{ color: "var(--text-normal)", fontWeight: 600 }}>
              Max Token Quota
            </span>
            <span
              className="tabular-nums"
              style={{
                color: "var(--accent-cyan)",
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                fontSize: "0.8rem",
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
            style={{
              width: "100%",
              accentColor: "var(--accent-cyan)",
              cursor: "pointer",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: "var(--text-muted)",
              fontSize: "0.7rem",
              marginTop: "2px",
              fontFamily: "var(--font-mono)",
            }}
          >
            <button
              type="button"
              onClick={() => setTokenBudget(50000)}
              style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}
            >
              50k (Std)
            </button>
            <button
              type="button"
              onClick={() => setTokenBudget(100000)}
              style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}
            >
              100k (Deep)
            </button>
            <span>150k Max</span>
          </div>
        </div>

        {/* Sandbox Capabilities Matrix */}
        <div
          style={{
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "6px",
            padding: "10px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "8px",
              color: "var(--text-muted)",
              fontSize: "0.72rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            <Wrench size={12} />
            Sandbox Capabilities
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "6px",
              fontSize: "0.75rem",
              color: "var(--text-normal)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <CheckCircle2 size={13} color="var(--accent-emerald)" />
              <code style={{ fontSize: "0.72rem" }}>read_file</code>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <CheckCircle2 size={13} color="var(--accent-emerald)" />
              <code style={{ fontSize: "0.72rem" }}>exec_script</code>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <CheckCircle2 size={13} color="var(--accent-emerald)" />
              <code style={{ fontSize: "0.72rem" }}>forge_test</code>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <CheckCircle2 size={13} color="var(--accent-emerald)" />
              <code style={{ fontSize: "0.72rem" }}>ast_grep</code>
            </div>
          </div>
        </div>

        {/* Submit or Abort Action */}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="submit"
            disabled={isStarting}
            style={{
              flex: 1,
              padding: "10px 16px",
              background: "var(--judge-accent)",
              color: "#ffffff",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              boxShadow: "0 2px 10px rgba(6, 182, 212, 0.25)",
              opacity: isStarting ? 0.75 : 1,
              cursor: isStarting ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {isStarting ? (
              <span
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <span
                  className="animate-spin"
                  style={{
                    display: "inline-block",
                    width: "14px",
                    height: "14px",
                    border: "2px solid #ffffff",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                  }}
                />
                Deploying Agent Sandbox...
              </span>
            ) : (
              <>
                <Play size={15} fill="currentColor" />
                Start Verification Run
              </>
            )}
          </button>

          {isRunning && onAbortRun && (
            <button
              type="button"
              onClick={onAbortRun}
              style={{
                padding: "10px 14px",
                background: "var(--accent-rose)",
                color: "#ffffff",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "0.82rem",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
              title="Abort Active Run"
            >
              <Square size={14} fill="currentColor" />
              Abort
            </button>
          )}
        </div>
      </form>

      {/* Recent Runs Feed */}
      {recentRuns.length > 0 && (
        <div
          style={{
            marginTop: "8px",
            borderTop: "1px solid var(--border-subtle)",
            paddingTop: "12px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Recent Audit Runs
            </span>
            <span style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>
              {recentRuns.length} runs
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {recentRuns.map((r) => (
              <div
                key={r.id}
                onClick={() => onSelectRecentRun?.(r.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                  background: "var(--surface-card)",
                  borderRadius: "5px",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
                className="hover-scale"
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background:
                        r.status === "COMPLETED"
                          ? "var(--accent-emerald)"
                          : r.status === "FAILED"
                            ? "var(--accent-rose)"
                            : "var(--accent-cyan)",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-normal)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "140px",
                    }}
                  >
                    {r.findingId || r.id}
                  </span>
                </div>
                <span
                  className="tabular-nums"
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "0.7rem",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {(r.totalDurationMs / 1000).toFixed(1)}s
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
