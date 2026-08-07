import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { StreamService } from "../../modules/stream/stream.service.js";

describe("StreamService (Unit)", () => {
  let streamService: StreamService;
  let mockPrisma: any;
  let eventEmitter: EventEmitter2;

  beforeEach(() => {
    mockPrisma = {
      modelEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      toolCall: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    // C2 Fix: StreamService nhận EventEmitter2 làm dependency thứ 2
    eventEmitter = new EventEmitter2();
    streamService = new StreamService(mockPrisma, eventEmitter as any);
    // Simulate onModuleInit bridge setup
    streamService.onModuleInit();
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

  it("không phát event của runId khác", () => {
    const stream$ = streamService.getStreamForRun("run-1");
    const events: any[] = [];

    stream$.subscribe((e) => events.push(e));

    // Publish event cho run-2 (không nên đến subscriber của run-1)
    streamService.publishEvent({
      runId: "run-2",
      eventType: "step:thought",
      stepIndex: 1,
      payload: { thought: "Should be filtered" },
    });

    expect(events.length).toBe(0);
  });
});

