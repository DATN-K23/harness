import React, { useState, useMemo } from "react";
import type { ToolCallSchema as ToolCall } from "../../generated/api/index.js";
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Clock,
  Coins,
  FileText,
  Search,
  ShieldCheck,
  Terminal,
  Wrench,
  Copy,
  Check,
} from "lucide-react";

interface ToolCallCardProps {
  toolCall: ToolCall;
  timeDelta?: string;
}

const MAX_LINES = 500;
const MAX_BYTES = 20 * 1024; // 20KB
const PREVIEW_LINES = 100;
const PREVIEW_CHARS = 4000;

interface PayloadViewerProps {
  title: string;
  formattedPayload: string;
  textColor: string;
  borderColor: string;
  copiedSection: "args" | "res" | null;
  onCopy: () => void;
  sectionKey: "args" | "res";
}

const PayloadViewer: React.FC<PayloadViewerProps> = ({
  title,
  formattedPayload,
  textColor,
  borderColor,
  copiedSection,
  onCopy,
  sectionKey,
}) => {
  const [showFull, setShowFull] = useState(false);

  const lines = useMemo(() => formattedPayload.split("\n"), [formattedPayload]);
  const totalLines = lines.length;
  const byteSize = useMemo(
    () => new Blob([formattedPayload]).size,
    [formattedPayload],
  );
  const isOversized = totalLines > MAX_LINES || byteSize > MAX_BYTES;

  const displayContent = useMemo(() => {
    if (!isOversized || showFull) {
      return formattedPayload;
    }
    if (totalLines > MAX_LINES) {
      return (
        lines.slice(0, PREVIEW_LINES).join("\n") +
        `\n\n... [Truncated ${totalLines - PREVIEW_LINES} lines (${(byteSize / 1024).toFixed(1)} KB total) to protect UI performance]`
      );
    }
    return (
      formattedPayload.slice(0, PREVIEW_CHARS) +
      `\n\n... [Truncated payload (${(byteSize / 1024).toFixed(1)} KB total) to protect UI performance]`
    );
  }, [formattedPayload, isOversized, showFull, totalLines, lines, byteSize]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "4px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              fontSize: "0.68rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              fontWeight: 600,
            }}
          >
            {title}
          </span>
          <span
            className="tabular-nums font-mono"
            style={{
              fontSize: "0.65rem",
              color: "var(--text-dim)",
            }}
          >
            ({totalLines} lines, {(byteSize / 1024).toFixed(1)} KB)
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {isOversized && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowFull(!showFull);
              }}
              style={{
                color: "var(--accent-cyan)",
                fontSize: "0.68rem",
                display: "flex",
                alignItems: "center",
                gap: "3px",
                padding: "2px 6px",
                borderRadius: "3px",
                background: "var(--accent-cyan-bg)",
                border: "1px solid rgba(6, 182, 212, 0.2)",
                fontWeight: 600,
              }}
            >
              {showFull ? "Collapse" : `Show Full Output (${totalLines} lines)`}
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            style={{
              color: "var(--text-muted)",
              fontSize: "0.68rem",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 6px",
              borderRadius: "3px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--border-subtle)",
            }}
            title="Copy full payload to clipboard"
          >
            {copiedSection === sectionKey ? (
              <Check size={11} color="var(--accent-emerald)" />
            ) : (
              <Copy size={11} />
            )}
            {copiedSection === sectionKey ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <pre
        style={{
          background: "rgba(0, 0, 0, 0.45)",
          padding: "8px 10px",
          borderRadius: "4px",
          fontSize: "0.75rem",
          color: textColor,
          border: `1px solid ${borderColor}`,
          maxHeight: showFull ? "500px" : "220px",
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontFamily: "var(--font-mono)",
        }}
      >
        {displayContent}
      </pre>
    </div>
  );
};

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  toolCall,
  timeDelta,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedSection, setCopiedSection] = useState<"args" | "res" | null>(
    null,
  );

  const getToolIcon = (name: string) => {
    switch (name) {
      case "read_file":
        return <FileText size={14} color="var(--accent-cyan)" />;
      case "grep":
      case "ast_grep":
        return <Search size={14} color="var(--accent-cyan)" />;
      case "verification":
      case "forge_test":
        return <ShieldCheck size={14} color="var(--accent-emerald)" />;
      case "exec_script":
        return <Terminal size={14} color="var(--accent-amber)" />;
      default:
        return <Wrench size={14} color="var(--accent-cyan)" />;
    }
  };

  /** Safe JSON parser to defend against malformed payloads */
  const formatArgumentsJson = (jsonStr: string): string => {
    if (!jsonStr) return "{}";
    try {
      const parsed: unknown =
        typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return jsonStr;
    }
  };

  /** Extract brief snippet from arguments */
  const getArgSnippet = (): string => {
    if (!toolCall.argumentsJson) return "";
    try {
      const parsed = JSON.parse(toolCall.argumentsJson) as Record<
        string,
        unknown
      >;
      if (typeof parsed.path === "string") return parsed.path;
      if (typeof parsed.file === "string") return parsed.file;
      if (typeof parsed.query === "string") return parsed.query;
      if (typeof parsed.command === "string") return parsed.command;
      const firstVal = Object.values(parsed)[0];
      if (typeof firstVal === "string") return firstVal;
    } catch {
      // Fallback
    }
    return "";
  };

  const copyToClipboard = (text: string, section: "args" | "res") => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedSection(section);
        setTimeout(() => setCopiedSection(null), 1500);
      })
      .catch(() => {});
  };

  const argSnippet = getArgSnippet();

  return (
    <div
      style={{
        borderRadius: "6px",
        border: toolCall.isError
          ? "1px solid rgba(244, 63, 94, 0.4)"
          : "1px solid var(--border-subtle)",
        borderLeft: toolCall.isError
          ? "3px solid var(--accent-rose)"
          : "3px solid var(--accent-cyan)",
        marginBottom: "6px",
        overflow: "hidden",
        background: "var(--surface-card)",
        transition: "all 0.15s ease",
      }}
      className="hover-scale"
    >
      {/* Header Preview Row (Compact 36px) */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          minHeight: "36px",
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          background: isExpanded ? "rgba(255, 255, 255, 0.03)" : "transparent",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minWidth: 0,
            flex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            {getToolIcon(toolCall.toolName)}
          </div>
          <span
            className="tabular-nums"
            style={{
              fontWeight: 600,
              color: toolCall.isError
                ? "var(--accent-rose)"
                : "var(--accent-cyan)",
              fontSize: "0.78rem",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
            }}
          >
            Step #{toolCall.stepIndex}: {toolCall.toolName}
          </span>

          {argSnippet && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                fontSize: "0.72rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "360px",
                background: "rgba(0, 0, 0, 0.25)",
                padding: "1px 6px",
                borderRadius: "3px",
              }}
              title={argSnippet}
            >
              {argSnippet}
            </span>
          )}

          {toolCall.isError && (
            <span
              style={{
                color: "var(--accent-rose)",
                fontSize: "0.7rem",
                display: "flex",
                alignItems: "center",
                gap: "3px",
                background: "var(--accent-rose-bg)",
                padding: "1px 6px",
                borderRadius: "3px",
                fontWeight: 600,
              }}
            >
              <AlertTriangle size={11} /> Error
            </span>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexShrink: 0,
          }}
        >
          {timeDelta && (
            <span
              className="tabular-nums font-mono"
              style={{
                fontSize: "0.72rem",
                color: "var(--accent-cyan)",
                background: "var(--accent-cyan-bg)",
                padding: "1px 6px",
                borderRadius: "3px",
                border: "1px solid rgba(6, 182, 212, 0.25)",
                display: "inline-flex",
                alignItems: "center",
                fontWeight: 600,
              }}
              title={`Timeline delta: ${timeDelta} from start`}
            >
              {timeDelta}
            </span>
          )}

          <span
            className="tabular-nums font-mono"
            style={{
              fontSize: "0.72rem",
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Clock size={11} /> {toolCall.durationMs}ms
          </span>
          <span
            className="tabular-nums font-mono"
            style={{
              fontSize: "0.72rem",
              color: "var(--text-dim)",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Coins size={11} /> {toolCall.tokensUsed ?? 0} tok
          </span>
          <button
            type="button"
            style={{
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
            }}
            aria-label={
              isExpanded ? "Collapse tool details" : "Expand tool details"
            }
          >
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded View */}
      {isExpanded && (
        <div
          style={{
            padding: "10px 12px",
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--surface-input)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px",
          }}
        >
          {/* Arguments Panel with Truncation Defense */}
          <PayloadViewer
            title="Arguments"
            formattedPayload={formatArgumentsJson(toolCall.argumentsJson)}
            textColor="var(--accent-cyan)"
            borderColor="var(--border-subtle)"
            copiedSection={copiedSection}
            onCopy={() =>
              copyToClipboard(
                formatArgumentsJson(toolCall.argumentsJson),
                "args",
              )
            }
            sectionKey="args"
          />

          {/* Result Output Panel with Truncation Defense */}
          <PayloadViewer
            title="Result Output"
            formattedPayload={toolCall.resultJson || "{}"}
            textColor={
              toolCall.isError ? "var(--accent-rose)" : "var(--accent-emerald)"
            }
            borderColor={
              toolCall.isError
                ? "rgba(244, 63, 94, 0.2)"
                : "rgba(16, 185, 129, 0.2)"
            }
            copiedSection={copiedSection}
            onCopy={() => copyToClipboard(toolCall.resultJson || "", "res")}
            sectionKey="res"
          />
        </div>
      )}
    </div>
  );
};
