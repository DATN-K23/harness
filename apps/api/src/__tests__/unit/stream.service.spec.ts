import { describe, it, expect, beforeEach, vi } from "vitest";
import { StreamService } from "../../modules/stream/stream.service.js";

describe("StreamService (Unit)", () => {
  let streamService: StreamService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      modelEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      toolCall: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    streamService = new StreamService(mockPrisma);
  });

  it("phát live event khi không truyền fromStep", () => {
    const stream$ = streamService.getStreamForRun("run-1");
    const events: any[] = [];

    stream$.subscribe((e) => events.push(e));

    streamService.publishEvent({
      runId: "run-1",
      eventType: "step:thought",
      stepIndex: 1,
      payload: { thought: "Testing" },
    });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("step:thought");
  });
});
