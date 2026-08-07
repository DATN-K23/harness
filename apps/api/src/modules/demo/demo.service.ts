import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { readFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";

const DemoEventSchema = z.object({
  type: z.enum([
    "step:thought",
    "step:tool_call",
    "run:verdict",
    "run:completed",
    "run:status_changed",
    "heartbeat",
  ]),
  payload: z.record(z.unknown()),
  delayMs: z.number().optional(),
});

const DemoFixtureSchema = z.object({
  events: z.array(DemoEventSchema),
});

export type DemoEvent = z.infer<typeof DemoEventSchema>;
export type DemoFixture = z.infer<typeof DemoFixtureSchema>;

@Injectable()
export class DemoService {
  async loadDemoFixture(runId: string): Promise<DemoFixture> {
    const fixturePath = join(process.cwd(), "demo-fixtures", `${runId}.json`);
    try {
      const raw = await readFile(fixturePath, "utf-8");
      const parsed = JSON.parse(raw);
      return DemoFixtureSchema.parse(parsed);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new BadRequestException(
          `Demo fixture '${runId}' có format không hợp lệ: ${err.message}`,
        );
      }
      throw new NotFoundException(`Demo fixture '${runId}' không tồn tại`);
    }
  }
}
