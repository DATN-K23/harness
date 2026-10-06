/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { AuditHarnessClient } from "../client.js";

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(),
}));

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
    } as unknown as Response);

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
    } as unknown as Response);

    const result = await client.cancelRun("run-123");

    expect(result).toEqual(mockCancelled);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/runs/run-123/cancel",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  describe("subscribeRunStream", () => {
    it("gửi query param from_step và header Last-Event-ID chính xác", () => {
      const listener = {
        onopen: vi.fn(),
      };

      const unsubscribe = client.subscribeRunStream("run-456", listener, {
        fromStep: 7,
      });

      expect(fetchEventSource).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/runs/run-456/stream?from_step=7",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Last-Event-ID": "7",
          }),
        }),
      );

      unsubscribe();
    });

    it("phân phối chính xác các sự kiện canonical SSE (thought, tool_call, status_changed, verdict, completed)", () => {
      let onmessageCallback: (event: {
        event: string;
        data: string;
      }) => void = () => {};

      vi.mocked(fetchEventSource).mockImplementation((_url, options) => {
        if (options?.onmessage) {
          onmessageCallback = options.onmessage as (event: {
            event: string;
            data: string;
          }) => void;
        }
        return Promise.resolve();
      });

      const onThought = vi.fn();
      const onToolCall = vi.fn();
      const onStatusChanged = vi.fn();
      const onVerdict = vi.fn();
      const onCompleted = vi.fn();

      const unsubscribe = client.subscribeRunStream("run-789", {
        onThought,
        onToolCall,
        onStatusChanged,
        onVerdict,
        onCompleted,
      });

      // 1. Thought event
      onmessageCallback({
        event: "thought",
        data: JSON.stringify({
          id: "th-1",
          stepIndex: 1,
          thought: "Analyzing contract",
        }),
      });
      expect(onThought).toHaveBeenCalledWith(
        expect.objectContaining({
          stepIndex: 1,
          thought: "Analyzing contract",
        }),
      );

      // 2. Tool call event
      onmessageCallback({
        event: "tool_call",
        data: JSON.stringify({
          id: "tc-1",
          stepIndex: 2,
          tool_name: "read_source",
        }),
      });
      expect(onToolCall).toHaveBeenCalledWith(
        expect.objectContaining({ stepIndex: 2, tool_name: "read_source" }),
      );

      // 3. Status changed event
      onmessageCallback({
        event: "status_changed",
        data: JSON.stringify({ status: "RUNNING" }),
      });
      expect(onStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({ status: "RUNNING" }),
      );

      // 4. Verdict event (judge-verdict-v1)
      onmessageCallback({
        event: "verdict",
        data: JSON.stringify({
          schemaVersion: "judge-verdict-v1",
          validity: "valid",
          severity: "high",
          confidence: 0.9,
          rationale: "Reentrancy detected",
          evidence: [],
          verificationStatus: "unverified",
        }),
      });
      expect(onVerdict).toHaveBeenCalledWith(
        expect.objectContaining({
          validity: "valid",
          severity: "high",
          confidence: 0.9,
        }),
      );

      // 5. Completed event
      onmessageCallback({
        event: "completed",
        data: JSON.stringify({
          totalDurationMs: 3200,
          totalTokensUsed: 1500,
          totalCostUsd: 0.02,
        }),
      });
      expect(onCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ totalDurationMs: 3200 }),
      );

      unsubscribe();
    });
  });
});
