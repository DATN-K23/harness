import { Controller, Get, Param } from "@nestjs/common";
import { DemoService } from "./demo.service.js";
import { SkipResponseTransform } from "../../common/decorators/skip-response-transform.decorator.js";

@Controller("demo/runs")
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Get(":id/timeline")
  @SkipResponseTransform()
  async getDemoTimeline(@Param("id") runId: string) {
    return this.demoService.loadDemoFixture(runId);
  }
}
