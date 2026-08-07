import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { createHash } from "crypto";
import type { CreateRunDto } from "@audit-harness/contracts";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class RunService {
  constructor(private readonly prisma: PrismaService) {}

  private buildConfigSnapshot(dto: CreateRunDto) {
    const config = (dto.config as any) ?? {};
    const userProvided = {
      modelProvider: config.modelProvider ?? "fake",
      modelName: config.modelName ?? "claude-3-5-sonnet",
      temperature: config.temperature ?? 0.0,
      maxSteps: config.maxSteps ?? 50,
      enableMemory: config.enableMemory ?? true,
      enableCompaction: config.enableCompaction ?? true,
      enableVerification: config.enableVerification ?? true,
    };

    const TOKEN_PER_STEP_ESTIMATE = 3000;
    const systemGenerated = {
      promptVersion: process.env.PROMPT_VERSION ?? "v1.0.0",
      tokenBudget: Math.min(
        userProvided.maxSteps * TOKEN_PER_STEP_ESTIMATE,
        200000,
      ),
      configHash: createHash("sha256")
        .update(JSON.stringify(userProvided))
        .digest("hex")
        .slice(0, 32),
    };

    return { ...userProvided, ...systemGenerated };
  }

  async createRun(dto: CreateRunDto) {
    const snapshotData = this.buildConfigSnapshot(dto);
    const run = await this.prisma.run.create({
      data: {
        title: dto.title,
        targetRepository: dto.targetRepository,
        findingId: dto.findingId,
        status: "PENDING",
        configSnapshot: {
          create: snapshotData,
        },
      },
      include: {
        configSnapshot: true,
      },
    });

    return run;
  }

  async getRun(id: string) {
    const run = await this.prisma.run.findUnique({
      where: { id },
      include: {
        configSnapshot: true,
        verdict: true,
      },
    });
    if (!run) {
      throw new NotFoundException(`Run with ID '${id}' was not found`);
    }
    return run;
  }

  async listRuns(page = 1, pageSize = 10, status?: string) {
    // NW1 Fix: Cap pageSize theo spec 03-security-protocol.md (limit ≤ 100)
    const safePageSize = Math.min(pageSize, 100);
    const skip = (page - 1) * safePageSize;
    const where = status ? { status: status as any } : {};

    const [items, totalItems] = await Promise.all([
      this.prisma.run.findMany({
        where,
        skip,
        take: safePageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.run.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / safePageSize);

    // NC3 Fix: Dùng _paginated flag convention thay vì { data, pagination }
    // để ResponseTransformInterceptor nhận biết explicit (không heuristic)
    return {
      _paginated: true as const,
      items,
      pagination: {
        page,
        pageSize: safePageSize,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getToolCalls(runId: string, fromStep = 0, limit = 50) {
    await this.getRun(runId);
    return this.prisma.toolCall.findMany({
      where: { runId, stepIndex: { gte: fromStep } },
      take: Math.min(limit, 200),
      orderBy: { stepIndex: "asc" },
    });
  }

  async getModelEvents(runId: string, fromStep = 0, limit = 50) {
    await this.getRun(runId);
    return this.prisma.modelEvent.findMany({
      where: { runId, stepIndex: { gte: fromStep } },
      take: Math.min(limit, 200),
      orderBy: { stepIndex: "asc" },
    });
  }

  async cancelRun(runId: string) {
    // NW6 Fix: Atomic updateMany với điều kiện where — tránh TOCTOU race
    // Thay vì read-check-write (3 bước), dùng 1 operation nguyên tử:
    // Chỉ update nếu run hiện tại KHÔNG ở terminal state
    const result = await this.prisma.run.updateMany({
      where: {
        id: runId,
        status: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] },
      },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
      },
    });

    if (result.count === 0) {
      // Run không tồn tại hoặc đã ở terminal state
      const run = await this.prisma.run.findUnique({ where: { id: runId } });
      if (!run) {
        throw new NotFoundException(`Run with ID '${runId}' was not found`);
      }
      throw new ConflictException({
        errorCode: "ERR_RUN_ALREADY_TERMINAL",
        message: `Run '${runId}' is already in a terminal state: ${run.status}`,
      });
    }

    return this.prisma.run.findUnique({
      where: { id: runId },
      include: { configSnapshot: true, verdict: true },
    });
  }
}
