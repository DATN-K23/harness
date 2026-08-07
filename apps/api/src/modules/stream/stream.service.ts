import { Injectable, MessageEvent, OnModuleInit } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  Subject,
  Observable,
  filter,
  map,
  merge,
  from,
} from "rxjs";
import { mergeMap, distinct } from "rxjs/operators";
import { PrismaService } from "../prisma/prisma.service.js";

export interface HarnessStreamEvent {
  runId: string;
  eventType: string;
  stepIndex?: number;
  payload: Record<string, any>;
}

/**
 * Tên event chuẩn cho EventEmitter2 internal bus.
 * Worker (cùng process) emit event này → StreamService forward qua SSE.
 *
 * @note Kiến trúc extensible: khi Worker tách thành process riêng,
 * thay LocalEventBusAdapter bằng RedisEventBusAdapter mà không cần
 * sửa StreamService hay Controller.
 */
export const HARNESS_STREAM_EVENT = "harness.stream.event";

@Injectable()
export class StreamService implements OnModuleInit {
  /**
   * Internal Subject — nhận event từ EventEmitter2 (local bus)
   * và broadcast đến tất cả SSE subscriber của cùng runId.
   */
  private readonly eventSubject$ = new Subject<HarnessStreamEvent>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Bridge: EventEmitter2 → RxJS Subject.
   * Đảm bảo mọi service trong cùng process đều có thể publish event
   * mà không cần inject StreamService trực tiếp (tránh circular dependency).
   */
  onModuleInit() {
    this.eventEmitter.on(HARNESS_STREAM_EVENT, (event: HarnessStreamEvent) => {
      this.eventSubject$.next(event);
    });
  }

  /**
   * Publish event lên local bus. Dùng cho Demo mode và Worker (same-process).
   * EventEmitter2 listener ở onModuleInit() sẽ forward vào Subject.
   */
  public publishEvent(event: HarnessStreamEvent): void {
    this.eventEmitter.emit(HARNESS_STREAM_EVENT, event);
  }

  public getStreamForRun(
    runId: string,
    fromStep?: number,
  ): Observable<MessageEvent> {
    const mapToMessageEvent = (event: HarnessStreamEvent): MessageEvent =>
      ({
        id: String(event.stepIndex ?? Date.now()),
        type: event.eventType,
        data: JSON.stringify(event.payload),
      }) as MessageEvent;

    const liveStream$ = this.eventSubject$.asObservable().pipe(
      filter((event) => event.runId === runId),
      filter(
        (event) => fromStep === undefined || (event.stepIndex ?? -1) > fromStep,
      ),
      map(mapToMessageEvent),
    );

    if (fromStep === undefined || fromStep < 0) {
      return liveStream$;
    }

    const historicalReplay$ = from(
      this.replayHistoricalEvents(runId, fromStep),
    ).pipe(mergeMap((events) => from(events)));

    return merge(historicalReplay$, liveStream$).pipe(
      distinct((event: MessageEvent) => event.id),
    );
  }

  private async replayHistoricalEvents(
    runId: string,
    fromStep: number,
  ): Promise<MessageEvent[]> {
    const [modelEvents, toolCalls] = await Promise.all([
      this.prisma.modelEvent.findMany({
        where: { runId, stepIndex: { gt: fromStep } },
        orderBy: { stepIndex: "asc" },
      }),
      this.prisma.toolCall.findMany({
        where: { runId, stepIndex: { gt: fromStep } },
        orderBy: { stepIndex: "asc" },
      }),
    ]);

    return [
      ...modelEvents.map(
        (e) =>
          ({
            id: String(e.stepIndex),
            type: this.mapEventType(e.eventType),
            data: JSON.stringify({
              runId,
              stepIndex: e.stepIndex,
              content: e.content,
            }),
          }) as MessageEvent,
      ),
      ...toolCalls.map(
        (tc) =>
          ({
            id: String(tc.stepIndex),
            type: "step:tool_call",
            data: JSON.stringify({
              runId,
              stepIndex: tc.stepIndex,
              toolName: tc.toolName,
              arguments: JSON.parse(tc.argumentsJson),
              result: tc.resultJson,
              isError: tc.isError,
              durationMs: tc.durationMs,
              tokensUsed: tc.tokensUsed,
            }),
          }) as MessageEvent,
      ),
    ].sort((a, b) => parseInt(a.id!) - parseInt(b.id!));
  }

  private mapEventType(dbEventType: string): string {
    const mapping: Record<string, string> = {
      THOUGHT: "step:thought",
      TOOL_REQUEST: "step:tool_call",
      SYSTEM_PROMPT: "run:status_changed",
      ERROR: "run:status_changed",
    };
    return mapping[dbEventType] ?? "run:status_changed";
  }
}
