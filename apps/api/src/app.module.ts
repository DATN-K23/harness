import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR, APP_FILTER } from "@nestjs/core";
import { PrismaModule } from "./modules/prisma/prisma.module.js";
import { RunModule } from "./modules/run/run.module.js";
import { StreamModule } from "./modules/stream/stream.module.js";
import { DemoModule } from "./modules/demo/demo.module.js";
import { ResponseTransformInterceptor } from "./common/interceptors/response-transform.interceptor.js";
import { GlobalHttpExceptionFilter } from "./common/filters/http-exception.filter.js";

@Module({
  imports: [PrismaModule, RunModule, StreamModule, DemoModule],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseTransformInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalHttpExceptionFilter,
    },
  ],
})
export class AppModule {}
