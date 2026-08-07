import { Injectable, MessageEvent } from "@nestjs/common";
import { Subject, Observable, filter, map, merge, from } from "rxjs";
import { mergeMap, distinct } from "rxjs/operators";
import { PrismaService } from "../prisma/prisma.service.js";

export interface HarnessStreamEvent {
  runId: string;
  eventType: string;
  stepIndex?: number;
  payload: Record<string, any>;
}

@Injectable()
export class StreamService {
  private eventSubject$ = new Subject<HarnessStreamEvent>();

  constructor(private readonly prisma: PrismaService) {}

  public publishEvent(event: HarnessStreamEvent): void {
    this.eventSubject$.next(event);
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
