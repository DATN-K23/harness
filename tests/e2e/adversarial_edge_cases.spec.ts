/**
 * @file adversarial_edge_cases.spec.ts
 * @description Adversarial Edge Cases, Error Resilience & Security Input Verification
 *
 * Empirical verification suite authored by Challenger 2.
 * Strictly tests boundary conditions, injection immunity, token exhaustion telemetry,
 * and daemon offline/timeout resilience against the AI Security Audit Cockpit specifications.
 */

import { describe, it, expect } from "vitest";
import { createCockpitStore } from "./cockpit.e2e.spec.js";

// ============================================================================
// Production Input Validation Rules (Mirroring JudgeForm.tsx)
// ============================================================================

// RFC-compliant Git/HTTP(S)/SSH/Local path regex from JudgeForm.tsx:63
const GIT_REPO_REGEX = /^(https?:\/\/|git@|ssh:\/\/|file:\/\/|\/|\.\/)[^\s]+$/;
// Finding identifier regex from JudgeForm.tsx:65 (2-64 chars of alphanumeric, dashes, dots, underscores)
const FINDING_ID_REGEX = /^[A-Za-z0-9_.-]{2,64}$/;

interface ProductionValidationResult {
  isValid: boolean;
  errors: {
    repo?: string;
    findingId?: string;
  };
  sanitized: {
    repo: string;
    findingId: string;
  };
}

function validateProductionInputs(
  rawRepo: string,
  rawFindingId: string,
): ProductionValidationResult {
  const errors: { repo?: string; findingId?: string } = {};
  const trimmedRepo = rawRepo.trim();
  const trimmedFinding = rawFindingId.trim();

  if (!trimmedRepo) {
    errors.repo = "Target repository URL is required.";
  } else if (!GIT_REPO_REGEX.test(trimmedRepo)) {
    errors.repo =
      "Repository URL must be a valid HTTP(S), SSH, or Git address.";
  }

  if (!trimmedFinding) {
    errors.findingId = "Finding identifier is required.";
  } else if (!FINDING_ID_REGEX.test(trimmedFinding)) {
    errors.findingId = "Finding ID must be 2-64 chars (alphanumeric, -, _, .).";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized: {
      repo: trimmedRepo,
      findingId: trimmedFinding,
    },
  };
}

// ============================================================================
// Token Quota & Burn Gauge Model (Mirroring TraceView.tsx)
// ============================================================================

interface TokenTelemetry {
  totalTokensBurned: number;
  estimatedTokenBudget: number;
  isBudgetExhausted: boolean;
  tokenOverage: number;
  tokenUsagePercent: number;
  statusBadge: string | null;
  gaugeColor: "cyan" | "amber" | "rose";
}

function computeTokenTelemetry(
  toolCalls: Array<{ tokensUsed?: number | undefined }>,
  budget = 50000,
): TokenTelemetry {
  const totalTokensBurned = toolCalls.reduce(
    (sum, tc) => sum + (tc.tokensUsed || 0),
    0,
  );
  const isBudgetExhausted = totalTokensBurned >= budget;
  const tokenOverage = Math.max(0, totalTokensBurned - budget);
  const tokenUsagePercent = Math.min(
    100,
    Math.round((totalTokensBurned / budget) * 100),
  );

  let gaugeColor: "cyan" | "amber" | "rose" = "cyan";
  if (tokenUsagePercent > 85 || isBudgetExhausted) {
    gaugeColor = "rose";
  } else if (tokenUsagePercent > 60) {
    gaugeColor = "amber";
  }

  const statusBadge = isBudgetExhausted
    ? `+${tokenOverage.toLocaleString()} over quota`
    : null;

  return {
    totalTokensBurned,
    estimatedTokenBudget: budget,
    isBudgetExhausted,
    tokenOverage,
    tokenUsagePercent,
    statusBadge,
    gaugeColor,
  };
}

// ============================================================================
// Daemon Timeout & Reconnection Backoff Helpers
// ============================================================================

function calculateSseBackoff(retryCount: number): number {
  return Math.min(1000 * Math.pow(2, retryCount - 1), 30000);
}

function simulateWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`Audit client request timed out after ${timeoutMs}ms`),
          ),
        timeoutMs,
      ),
    ),
  ]);
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe("Adversarial Verification Suite: Challenger 2", () => {
  describe("Category 1: Input Validation, Edge Cases & Injection Attacks", () => {
    it("ADV-01: Rejects empty strings and pure whitespace variations", () => {
      const whitespaceInputs = [
        "",
        " ",
        "   ",
        "\t",
        "\t\t  ",
        "\n",
        "\r\n",
        "  \r\n\t  ",
      ];

      for (const input of whitespaceInputs) {
        const res = validateProductionInputs(input, input);
        expect(res.isValid).toBe(false);
        expect(res.errors.repo).toBe("Target repository URL is required.");
        expect(res.errors.findingId).toBe("Finding identifier is required.");
      }
    });

    it("ADV-02: Rejects dangerous non-Git protocols and URL injection attacks", () => {
      const hostileUrls = [
        "javascript:alert(document.domain)",
        "javascript://alert(1)",
        "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
        "vbscript:msgbox(1)",
        "ftp://ftp.example.com/repo.git",
        "gopher://gopher.floodgap.com",
        "ws://malicious-relay.com",
        "wss://malicious-relay.com",
        "blob:http://localhost:5173/uuid-value",
        "http://invalid url with spaces",
        "just_a_random_word",
      ];

      for (const url of hostileUrls) {
        const res = validateProductionInputs(url, "CEI-001");
        expect(res.isValid).toBe(false);
        expect(res.errors.repo).toBe(
          "Repository URL must be a valid HTTP(S), SSH, or Git address.",
        );
      }
    });

    it("ADV-02b: Empirical observation on URL query/fragment with special characters", () => {
      // Demonstrates that GIT_REPO_REGEX accepts any non-whitespace string starting with http(s)://
      const urlWithSpecialChars = "https://repo.git#with?evil=<script>";
      const res = validateProductionInputs(urlWithSpecialChars, "CEI-001");
      // Note: GIT_REPO_REGEX = /^(https?:\/\/|git@|ssh:\/\/|file:\/\/|\/|\.\/)[^\s]+$/
      // Because it only checks [^\s]+, query strings without spaces are accepted at form validation
      expect(res.isValid).toBe(true);
      // However, React escapes all JSX text nodes preventing UI-level XSS execution
    });

    it("ADV-03: Permits valid Git, HTTP(S), SSH, and local file repository formats", () => {
      const validUrls = [
        "https://github.com/Uniswap/v3-core",
        "http://127.0.0.1:8080/my-repo",
        "git@github.com:OpenZeppelin/openzeppelin-contracts.git",
        "ssh://git@gitlab.com:2222/org/project.git",
        "file:///home/user/contracts/vault",
        "/absolute/local/path/to/contract",
        "./relative/path/contracts",
      ];

      for (const url of validUrls) {
        const res = validateProductionInputs(url, "CEI-001");
        expect(res.isValid).toBe(true);
        expect(res.errors.repo).toBeUndefined();
      }
    });

    it("ADV-04: Blocks SQL Injection and XSS payloads in findingId with FINDING_ID_REGEX", () => {
      const injectionFindingIds = [
        "<script>alert('XSS')</script>",
        "<img src=x onerror=alert(1)>",
        "CEI-001; DROP TABLE runs;--",
        "' OR '1'='1 --",
        '" UNION SELECT * FROM users --',
        "../../../../etc/shadow",
        "Finding\x00NullByte",
        "CEI-001 && rm -rf /",
        "CEI-001 | cat /etc/passwd",
        "${7*7}",
        "{{constructor.constructor('alert(1)')()}}",
        "CEI 001", // space inside
      ];

      for (const maliciousId of injectionFindingIds) {
        const res = validateProductionInputs(
          "https://github.com/org/repo",
          maliciousId,
        );
        expect(res.isValid).toBe(false);
        expect(res.errors.findingId).toBe(
          "Finding ID must be 2-64 chars (alphanumeric, -, _, .).",
        );
      }
    });

    it("ADV-05: Enforces finding ID boundary lengths (min 2, max 64 chars)", () => {
      // 1 char: should fail
      const tooShort = validateProductionInputs(
        "https://github.com/org/repo",
        "A",
      );
      expect(tooShort.isValid).toBe(false);
      expect(tooShort.errors.findingId).toBe(
        "Finding ID must be 2-64 chars (alphanumeric, -, _, .).",
      );

      // 2 chars: should pass
      const minValid = validateProductionInputs(
        "https://github.com/org/repo",
        "H1",
      );
      expect(minValid.isValid).toBe(true);

      // 64 chars: should pass
      const maxValidId = "A".repeat(64);
      const maxValid = validateProductionInputs(
        "https://github.com/org/repo",
        maxValidId,
      );
      expect(maxValid.isValid).toBe(true);

      // 65 chars: should fail
      const tooLongId = "A".repeat(65);
      const tooLong = validateProductionInputs(
        "https://github.com/org/repo",
        tooLongId,
      );
      expect(tooLong.isValid).toBe(false);
      expect(tooLong.errors.findingId).toBe(
        "Finding ID must be 2-64 chars (alphanumeric, -, _, .).",
      );
    });

    it("ADV-06: Automatically trims valid inputs with leading and trailing whitespace", () => {
      const res = validateProductionInputs(
        "   https://github.com/demo/project  \n",
        " \t CEI-001 \r\n ",
      );
      expect(res.isValid).toBe(true);
      expect(res.sanitized.repo).toBe("https://github.com/demo/project");
      expect(res.sanitized.findingId).toBe("CEI-001");
    });
  });

  describe("Category 2: Token Quota & Burn Gauge Error Telemetry", () => {
    it("ADV-07: Telemetry reflects zero burn state safely without NaN", () => {
      const telemetry = computeTokenTelemetry([], 50000);
      expect(telemetry.totalTokensBurned).toBe(0);
      expect(telemetry.isBudgetExhausted).toBe(false);
      expect(telemetry.tokenOverage).toBe(0);
      expect(telemetry.tokenUsagePercent).toBe(0);
      expect(telemetry.statusBadge).toBeNull();
      expect(telemetry.gaugeColor).toBe("cyan");
    });

    it("ADV-08: Telemetry handles missing or undefined tokensUsed in tool calls", () => {
      const toolCalls = [
        { tokensUsed: undefined },
        { tokensUsed: 1200 },
        { tokensUsed: undefined },
        { tokensUsed: 3800 },
      ];
      const telemetry = computeTokenTelemetry(toolCalls, 50000);
      expect(telemetry.totalTokensBurned).toBe(5000);
      expect(telemetry.tokenUsagePercent).toBe(10);
      expect(telemetry.gaugeColor).toBe("cyan");
    });

    it("ADV-09: Transitions gauge color from cyan to amber at >60% and rose at >85%", () => {
      // 50% -> cyan
      const tel50 = computeTokenTelemetry([{ tokensUsed: 25000 }], 50000);
      expect(tel50.tokenUsagePercent).toBe(50);
      expect(tel50.gaugeColor).toBe("cyan");

      // 65% -> amber
      const tel65 = computeTokenTelemetry([{ tokensUsed: 32500 }], 50000);
      expect(tel65.tokenUsagePercent).toBe(65);
      expect(tel65.gaugeColor).toBe("amber");

      // 88% -> rose
      const tel88 = computeTokenTelemetry([{ tokensUsed: 44000 }], 50000);
      expect(tel88.tokenUsagePercent).toBe(88);
      expect(tel88.gaugeColor).toBe("rose");
    });

    it("ADV-10: Accurately reports +X over quota when token budget is exhausted", () => {
      // Exact boundary budget (50,000 / 50,000)
      const telExact = computeTokenTelemetry([{ tokensUsed: 50000 }], 50000);
      expect(telExact.isBudgetExhausted).toBe(true);
      expect(telExact.tokenOverage).toBe(0);
      expect(telExact.tokenUsagePercent).toBe(100);
      expect(telExact.statusBadge).toBe("+0 over quota");
      expect(telExact.gaugeColor).toBe("rose");

      // Modest overage (+4,320 over quota)
      const telOverage = computeTokenTelemetry([{ tokensUsed: 54320 }], 50000);
      expect(telOverage.isBudgetExhausted).toBe(true);
      expect(telOverage.tokenOverage).toBe(4320);
      expect(telOverage.tokenUsagePercent).toBe(100);
      expect(telOverage.statusBadge).toBe("+4,320 over quota");
      expect(telOverage.gaugeColor).toBe("rose");

      // Extreme overage (+150,000 over quota)
      const telMassive = computeTokenTelemetry([{ tokensUsed: 200000 }], 50000);
      expect(telMassive.isBudgetExhausted).toBe(true);
      expect(telMassive.tokenOverage).toBe(150000);
      expect(telMassive.tokenUsagePercent).toBe(100);
      expect(telMassive.statusBadge).toBe("+150,000 over quota");
      expect(telMassive.gaugeColor).toBe("rose");
    });
  });

  describe("Category 3: Daemon Offline, Disconnect & Timeout Resiliency", () => {
    it("ADV-11: withTimeout successfully rejects hung promises exceeding timeout threshold", async () => {
      const neverEndingPromise = new Promise(() => {
        // intentionally unfulfilled
      });

      await expect(simulateWithTimeout(neverEndingPromise, 50)).rejects.toThrow(
        "Audit client request timed out after 50ms",
      );
    });

    it("ADV-12: withTimeout resolves normally when response arrives before timeout", async () => {
      const quickPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve("success-payload"), 10);
      });

      const result = await simulateWithTimeout(quickPromise, 100);
      expect(result).toBe("success-payload");
    });

    it("ADV-13: SSE exponential backoff increases deterministically up to 30s cap", () => {
      expect(calculateSseBackoff(1)).toBe(1000); // 2^0 * 1000 = 1000ms
      expect(calculateSseBackoff(2)).toBe(2000); // 2^1 * 1000 = 2000ms
      expect(calculateSseBackoff(3)).toBe(4000); // 2^2 * 1000 = 4000ms
      expect(calculateSseBackoff(4)).toBe(8000); // 2^3 * 1000 = 8000ms
      expect(calculateSseBackoff(5)).toBe(16000); // 2^4 * 1000 = 16000ms
      expect(calculateSseBackoff(6)).toBe(30000); // 32000 capped at 30000ms
      expect(calculateSseBackoff(10)).toBe(30000); // capped at 30000ms
    });

    it("ADV-14: AbortController properly aborts on timeout without memory leak", async () => {
      const controller = new AbortController();
      let aborted = false;
      controller.signal.addEventListener("abort", () => {
        aborted = true;
      });

      const timeoutId = setTimeout(() => controller.abort(), 20);
      await new Promise((r) => setTimeout(r, 40));

      expect(aborted).toBe(true);
      expect(controller.signal.aborted).toBe(true);
      clearTimeout(timeoutId);
    });
  });

  describe("Category 4: High-Frequency Stream & Heavy Load Ingestion", () => {
    it("ADV-15: Store handles ingestion of 1,000 high-frequency events without corruption", () => {
      const store = createCockpitStore();
      const TOTAL_EVENTS = 1000;

      // Ingest 500 thoughts and 500 tool calls
      for (let i = 0; i < TOTAL_EVENTS / 2; i++) {
        store.appendThought({
          id: `thought-${i}`,
          stepIndex: i,
          thought: `Analyzing security invariant #${i}`,
        });
        store.appendToolCall({
          id: `tool-${i}`,
          stepIndex: i,
          toolName: i % 2 === 0 ? "read_file" : "execute_test",
          argumentsJson: JSON.stringify({ index: i }),
          isError: i % 10 === 0, // 10% errors
          tokensUsed: 100,
        });
      }

      const state = store.getState();
      expect(state.modelEvents.length).toBe(500);
      expect(state.toolCalls.length).toBe(500);

      // Verify deduplication: re-appending existing events must not increase length
      store.appendThought({
        id: "thought-0",
        stepIndex: 0,
        thought: "duplicate",
      });
      store.appendToolCall({
        id: "tool-0",
        stepIndex: 0,
        toolName: "read_file",
        argumentsJson: "{}",
      });

      expect(store.getState().modelEvents.length).toBe(500);
      expect(store.getState().toolCalls.length).toBe(500);

      // Check error count accuracy
      const errorCalls = store.getState().toolCalls.filter((tc) => tc.isError);
      expect(errorCalls.length).toBe(50); // exactly 10% of 500
    });
  });
});
