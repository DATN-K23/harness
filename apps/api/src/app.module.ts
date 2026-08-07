import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR, APP_FILTER, Reflector } from "@nestjs/core";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { PrismaModule } from "./modules/prisma/prisma.module.js";
import { RunModule } from "./modules/run/run.module.js";
import { StreamModule } from "./modules/stream/stream.module.js";
import { DemoModule } from "./modules/demo/demo.module.js";
import { ResponseTransformInterceptor } from "./common/interceptors/response-transform.interceptor.js";
import { GlobalHttpExceptionFilter } from "./common/filters/http-exception.filter.js";

@Module({
  imports: [
    // EventEmitter2 — local event bus cho StreamService bridge (C2 fix)
    EventEmitterModule.forRoot({ wildcard: false, delimiter: "." }),
    PrismaModule,
    RunModule,
    StreamModule,
    DemoModule,
  ],
  providers: [
    {
      // C3 Fix: useFactory + inject: [Reflector] để NestJS DI inject đúng instance
      // useClass không hoạt động khi constructor nhận Reflector ở scope APP_INTERCEPTOR
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) =>
        new ResponseTransformInterceptor(reflector),
      inject: [Reflector],
    },
    {
      provide: APP_FILTER,
      useClass: GlobalHttpExceptionFilter,
    },
  ],
})
export class AppModule {}

