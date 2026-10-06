import { describe, it, expect } from "vitest";
import {
  generateRunsCSV,
  generateRunsJSON,
  exportRunsToCSV,
  exportRunsToJSON,
} from "../export.js";
import type { RunSchema } from "../../generated/api/index.js";

describe("export utils (Safety Net)", () => {
  const mockRuns: RunSchema[] = [
    {
      id: "run-001",
      title: "Test Audit",
      targetRepository: "owner/repo",
      findingId: "H-01",
      status: "COMPLETED",
      totalDurationMs: 4500,
      verdict: {
        schemaVersion: "judge-verdict-v1",
        validity: "valid",
        severity: "high",
        confidence: 0.95,
        rationale: "Found bug",
        evidence: [],
        verificationStatus: "unverified",
        labelNormalizationVersion: "v1.0",
      },
    },
  ];

  it("generateRunsCSV định dạng bảng CSV chính xác", () => {
    const csv = generateRunsCSV(mockRuns);

    expect(csv).toContain("Run ID,Title,Repository");
    expect(csv).toContain('"run-001"');
    expect(csv).toContain('"valid"');
    expect(csv).toContain('"high"');
    expect(csv).toContain('"0.95"');
  });

  it("generateRunsCSV trả về rỗng khi không có runs", () => {
    expect(generateRunsCSV([])).toBe("");
  });

  it("generateRunsJSON xuất định dạng JSON chính xác", () => {
    const jsonStr = generateRunsJSON(mockRuns);
    const parsed = JSON.parse(jsonStr) as RunSchema[];

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe("run-001");
    expect(parsed[0]?.findingId).toBe("H-01");
    expect(parsed[0]?.verdict?.severity).toBe("high");
  });

  it("generateRunsJSON trả về rỗng khi không có runs", () => {
    expect(generateRunsJSON([])).toBe("");
  });

  it("exportRunsToCSV và exportRunsToJSON an toàn khi chạy môi trường non-browser", () => {
    expect(() => exportRunsToCSV(mockRuns)).not.toThrow();
    expect(() => exportRunsToJSON(mockRuns)).not.toThrow();
    expect(() => exportRunsToCSV([])).not.toThrow();
    expect(() => exportRunsToJSON([])).not.toThrow();
  });
});
