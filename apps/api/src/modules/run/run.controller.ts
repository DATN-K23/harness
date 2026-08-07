import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Res,
  UsePipes,
  Header,
  Headers,
  BadRequestException,
} from "@nestjs/common";
import type { Response } from "express";
import { CreateRunSchema } from "@audit-harness/contracts";
import { RunService } from "./run.service.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { SkipResponseTransform } from "../../common/decorators/skip-response-transform.decorator.js";

@Controller("runs")
export class RunController {
  constructor(private readonly runService: RunService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateRunSchema))
  async createRun(@Body() dto: any) {
    return this.runService.createRun(dto);
  }

  @Get()
  async listRuns(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("status") status?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 10;
    return this.runService.listRuns(p, ps, status);
  }

  @Get(":id")
  async getRun(@Param("id") id: string) {
    return this.runService.getRun(id);
  }

  @Get(":id/tool-calls")
  async getToolCalls(
    @Param("id") id: string,
    @Query("fromStep") fromStep?: string,
    @Query("limit") limit?: string,
  ) {
    const fs = fromStep ? parseInt(fromStep, 10) : 0;
    const l = limit ? parseInt(limit, 10) : 50;
    return this.runService.getToolCalls(id, fs, l);
  }

  @Get(":id/model-events")
  async getModelEvents(
    @Param("id") id: string,
    @Query("fromStep") fromStep?: string,
    @Query("limit") limit?: string,
  ) {
    const fs = fromStep ? parseInt(fromStep, 10) : 0;
    const l = limit ? parseInt(limit, 10) : 50;
    return this.runService.getModelEvents(id, fs, l);
  }

  @Post(":id/cancel")
  async cancelRun(
    @Param("id") id: string,
    @Headers("x-request-id") requestId?: string,
  ) {
    // W5 Fix: x-request-id bắt buộc cho idempotency trace theo spec
    if (!requestId || requestId.trim() === "") {
      throw new BadRequestException({
        errorCode: "ERR_MISSING_REQUEST_ID",
        message: "Header 'x-request-id' là bắt buộc cho endpoint cancel.",
      });
    }
    return this.runService.cancelRun(id);
  }

  @Get(":id/export")
  @SkipResponseTransform()
  @Header("Content-Type", "application/json")
  async exportRunData(@Param("id") id: string, @Res() res: Response) {
    const EXPORT_LIMIT = 200;
    const run = await this.runService.getRun(id);
    const toolCalls = await this.runService.getToolCalls(id, 0, EXPORT_LIMIT);
    const modelEvents = await this.runService.getModelEvents(id, 0, EXPORT_LIMIT);

    // W6 Fix: Cảnh báo rõ ràng khi data bị truncate thay vì âm thầm mất dữ liệu
    const isTruncated =
      toolCalls.length === EXPORT_LIMIT || modelEvents.length === EXPORT_LIMIT;

    const payload = {
      run,
      toolCalls,
      modelEvents,
      exportedAt: new Date().toISOString(),
      meta: {
        exportLimit: EXPORT_LIMIT,
        isTruncated,
        truncationWarning: isTruncated
          ? `Dữ liệu bị giới hạn ở ${EXPORT_LIMIT} records. Sử dụng API pagination để lấy toàn bộ.`
          : null,
      },
    };

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="run-${id}-export.json"`,
    );
    res.json(payload);
  }
}
