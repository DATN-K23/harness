import { describe, it, expect, beforeEach } from "vitest";
import { useRunStore } from "../run.store.js";
import type { RunSchema, ToolCallSchema } from "../../generated/api/index.js";

describe("useRunStore (Safety Net)", () => {
  beforeEach(() => {
    useRunStore.getState().reset();
  });

  it("khởi tạo store với trạng thái mặc định", () => {
    const state = useRunStore.getState();
    expect(state.currentRun).toBeNull();
    expect(state.sseStatus).toBe("offline");
    expect(state.toolCalls).toEqual([]);
    expect(state.modelEvents).toEqual([]);
  });

  it("setRun và setRunStatus hoạt động chính xác", () => {
    const mockRun: RunSchema = {
      id: "run-test-1",
      title: "Test Run",
      targetRepository: "org/repo",
      findingId: "H-01",
      status: "PENDING",
      totalDurationMs: 0,
    };

    useRunStore.getState().setRun(mockRun);
    expect(useRunStore.getState().currentRun?.status).toBe("PENDING");

    useRunStore.getState().setRunStatus("RUNNING");
    expect(useRunStore.getState().currentRun?.status).toBe("RUNNING");
  });

  it("appendToolCall khử trùng lặp (deduplicate) dựa trên ID", () => {
    const tc1: ToolCallSchema = {
      id: "tc-001",
      stepIndex: 1,
      toolName: "read_file",
      argumentsJson: "{}",
      resultJson: "{}",
      isError: false,
      durationMs: 50,
      tokensUsed: 10,
    };

    useRunStore.getState().appendToolCall(tc1);
    expect(useRunStore.getState().toolCalls).toHaveLength(1);

    // Gửi lại cùng ID
    useRunStore.getState().appendToolCall(tc1);
    expect(useRunStore.getState().toolCalls).toHaveLength(1);
  });

  it("appendThought khử trùng lặp theo ID và stepIndex", () => {
    useRunStore.getState().appendThought({
      id: "thought-1",
      stepIndex: 1,
      thought: "Phân tích bảo mật...",
    });
    expect(useRunStore.getState().modelEvents).toHaveLength(1);

    // Gửi lại cùng ID
    useRunStore.getState().appendThought({
      id: "thought-1",
      stepIndex: 1,
      thought: "Phân tích bảo mật trùng...",
    });
    expect(useRunStore.getState().modelEvents).toHaveLength(1);

    // Gửi lại cùng stepIndex và eventType THOUGHT dù không có ID
    useRunStore.getState().appendThought({
      stepIndex: 1,
      thought: "Thought khác cùng step...",
    });
    expect(useRunStore.getState().modelEvents).toHaveLength(1);
  });

  it("reset đưa store về trạng thái rỗng", () => {
    useRunStore.getState().setRun({
      id: "run-99",
      title: "Run",
      targetRepository: "repo",
      findingId: "F1",
      status: "COMPLETED",
      totalDurationMs: 100,
    });
    useRunStore.getState().setSseStatus("connected");

    useRunStore.getState().reset();
    const state = useRunStore.getState();
    expect(state.currentRun).toBeNull();
    expect(state.sseStatus).toBe("offline");
    expect(state.toolCalls).toHaveLength(0);
  });
});
