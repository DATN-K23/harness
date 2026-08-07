import {
  Controller,
  Param,
  Sse,
  Query,
  Headers,
  MessageEvent,
} from "@nestjs/common";
import { Observable, interval, map, merge } from "rxjs";
import { StreamService } from "./stream.service.js";
import { SkipResponseTransform } from "../../common/decorators/skip-response-transform.decorator.js";

@Controller("runs")
export class StreamController {
  constructor(private readonly streamService: StreamService) {}

  /**
   * SSE Gateway — GET /api/v1/runs/:id/stream
   * Dùng @Sse() standalone (không kết hợp với @Get()) theo NestJS docs.
   * Hỗ trợ Last-Event-ID header và fromStep query param để resume connection.
   */
  @Sse(":id/stream")
  @SkipResponseTransform()
  streamRunEvents(
    @Param("id") runId: string,
    @Query("fromStep") fromStep?: string,
    @Headers("last-event-id") lastEventId?: string,
  ): Observable<MessageEvent> {
    const stepNumber = fromStep
      ? parseInt(fromStep, 10)
      : lastEventId
        ? parseInt(lastEventId, 10)
        : undefined;

    const realEvents$ = this.streamService.getStreamForRun(runId, stepNumber);

    // Heartbeat keep-alive mỗi 15 giây — dùng id "hb" để không bị distinct() lọc
    const heartbeat$ = interval(15000).pipe(
      map(
        () =>
          ({
            id: "hb",
            type: "heartbeat",
            data: JSON.stringify({ timestamp: new Date().toISOString() }),
          }) as MessageEvent,
      ),
    );

    return merge(realEvents$, heartbeat$);
  }
}
