import { Module } from "@nestjs/common";
import { RunController } from "./run.controller.js";
import { RunService } from "./run.service.js";

@Module({
  controllers: [RunController],
  providers: [RunService],
  exports: [RunService],
})
export class RunModule {}
