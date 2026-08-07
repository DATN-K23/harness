import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditHarnessClient } from "../client.js";

describe("AuditHarnessClient", () => {
  let client: AuditHarnessClient;

  beforeEach(() => {
    client = new AuditHarnessClient({
      baseUrl: "http://localhost:3000",
    });
    vi.restoreAllMocks();
  });

  it("gửi request POST /api/v1/runs thành công", async () => {
    const mockRun = {
      id: "run-123",
      title: "Reentrancy Verification",
      targetRepository: "code4rena/vault",
      findingId: "H-01",
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        code: 201,
        message: "Run initiated",
        data: mockRun,
        meta: { requestId: "req_1", timestamp: new Date().toISOString() },
      }),
    } as Response);

    const result = await client.createRun({
      title: "Reentrancy Verification",
      targetRepository: "code4rena/vault",
      findingId: "H-01",
    });

    expect(result).toEqual(mockRun);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/runs",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("gửi request POST /api/v1/runs/:id/cancel để hủy run", async () => {
    const mockCancelled = {
      id: "run-123",
      status: "CANCELLED",
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        code: 200,
        message: "Run cancelled",
        data: mockCancelled,
        meta: { requestId: "req_2", timestamp: new Date().toISOString() },
      }),
    } as Response);

    const result = await client.cancelRun("run-123");

    expect(result).toEqual(mockCancelled);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/runs/run-123/cancel",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
