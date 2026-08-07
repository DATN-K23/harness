import { Controller, Get, Param, BadRequestException } from "@nestjs/common";
import { DemoService } from "./demo.service.js";
import { SkipResponseTransform } from "../../common/decorators/skip-response-transform.decorator.js";

/** NI2 Fix: Chỉ cho phép alphanumeric + dash/underscore, tối đa 64 ký tự */
const SAFE_RUN_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

@Controller("demo/runs")
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Get(":id/timeline")
  @SkipResponseTransform()
  async getDemoTimeline(@Param("id") runId: string) {
    // NI2 Fix: Validate runId format để tránh path probe và unexpected filesystem access
    if (!SAFE_RUN_ID_REGEX.test(runId)) {
      throw new BadRequestException({
        errorCode: "ERR_INVALID_RUN_ID",
        message:
          "runId chỉ được chứa chữ cái, số, dấu gạch ngang và gạch dưới (tối đa 64 ký tự).",
      });
    }
    return this.demoService.loadDemoFixture(runId);
  }
}
