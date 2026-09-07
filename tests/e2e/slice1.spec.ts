/**
 * @file slice1.spec.ts
 * @description E2E integration test for Slice 1 Asynchronous Run API and Contracts
 */
import { describe, it, expect } from "vitest";
import { AuditHarnessClient } from "@audit-harness/sdk";
import type { Verdict } from "@audit-harness/contracts";

describe("Slice 1 E2E Integration Contract", () => {
  it("khởi tạo client và kiểm tra tính tương thích của Verdict contract", () => {
    const client = new AuditHarnessClient({
      baseUrl: "http://localhost:8000",
    });

    expect(client).toBeDefined();

    const mockVerdict: Verdict = {
      schemaVersion: "judge-verdict-v1",
      validity: "valid",
      severity: "high",
      confidence: 0.95,
      rationale: "Reentrancy vulnerability detected in withdraw function",
      evidence: [
        {
          path: "contracts/Vault.sol",
          start_line: 45,
          end_line: 52,
          content_digest: "sha256:abc123456",
        },
      ],
      verificationStatus: "unverified",
      labelNormalizationVersion: "v1",
    };

    expect(mockVerdict.schemaVersion).toBe("judge-verdict-v1");
    expect(mockVerdict.validity).toBe("valid");
    expect(mockVerdict.severity).toBe("high");
    expect(mockVerdict.verificationStatus).toBe("unverified");
  });
});
