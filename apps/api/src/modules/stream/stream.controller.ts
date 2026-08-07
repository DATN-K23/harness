import {
  Controller,
  Get,
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

  @Get(":id/stream")
  @Sse()
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

    // Heartbeat keep-alive mỗi 15 giây
    const heartbeat$ = interval(15000).pipe(
      map(
        () =>
          ({
            id: "0",
            type: "heartbeat",
            data: JSON.stringify({ timestamp: new Date().toISOString() }),
          }) as MessageEvent,
      ),
    );

    return merge(realEvents$, heartbeat$);
  }
}
