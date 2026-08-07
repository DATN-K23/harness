import { describe, it, expect, beforeEach, vi } from "vitest";
import { NotFoundException, ConflictException } from "@nestjs/common";
import { RunService } from "../../modules/run/run.service.js";

describe("RunService (Unit)", () => {
  let runService: RunService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      run: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        updateMany: vi.fn(),
      },
      toolCall: {
        findMany: vi.fn(),
      },
      modelEvent: {
        findMany: vi.fn(),
      },
    };
    runService = new RunService(mockPrisma);
  });

  describe("createRun", () => {
    it("tạo run mới với config snapshot mặc định", async () => {
      const dto = {
        title: "Test Run",
        targetRepository: "owner/repo",
        findingId: "F-01",
      };

      mockPrisma.run.create.mockImplementation(async ({ data }: any) => ({
        id: "run-uuid-1",
        ...data,
      }));

      const result = await runService.createRun(dto);
      expect(result.id).toBe("run-uuid-1");
      expect(mockPrisma.run.create).toHaveBeenCalledOnce();
    });
  });

  describe("getRun", () => {
    it("trả về run nếu tìm thấy ID", async () => {
      const mockRun = { id: "run-1", title: "Run 1", status: "RUNNING" };
      mockPrisma.run.findUnique.mockResolvedValue(mockRun);

      const result = await runService.getRun("run-1");
      expect(result).toEqual(mockRun);
    });

    it("throw NotFoundException nếu không tìm thấy ID", async () => {
      mockPrisma.run.findUnique.mockResolvedValue(null);

      await expect(runService.getRun("non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("listRuns", () => {
    it("trả về danh sách phân trang đúng cấu trúc _paginated", async () => {
      mockPrisma.run.findMany.mockResolvedValue([{ id: "run-1" }]);
      mockPrisma.run.count.mockResolvedValue(1);

      const result = await runService.listRuns(1, 10);
      expect(result._paginated).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.pagination.pageSize).toBe(10);
      expect(result.pagination.totalItems).toBe(1);
    });

    it("giới hạn (cap) pageSize tối đa 100 theo security protocol", async () => {
      mockPrisma.run.findMany.mockResolvedValue([]);
      mockPrisma.run.count.mockResolvedValue(0);

      const result = await runService.listRuns(1, 500);
      expect(result.pagination.pageSize).toBe(100);
    });
  });

  describe("cancelRun", () => {
    it("hủy run đang RUNNING thành công", async () => {
      mockPrisma.run.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.run.findUnique.mockResolvedValue({
        id: "run-1",
        status: "CANCELLED",
      });

      const result = await runService.cancelRun("run-1");
      expect(result?.status).toBe("CANCELLED");
      expect(mockPrisma.run.updateMany).toHaveBeenCalledWith({
        where: {
          id: "run-1",
          status: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] },
        },
        data: {
          status: "CANCELLED",
          completedAt: expect.any(Date),
        },
      });
    });

    it("throw ConflictException nếu run đã ở trạng thái COMPLETED", async () => {
      mockPrisma.run.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.run.findUnique.mockResolvedValue({
        id: "run-1",
        status: "COMPLETED",
      });

      await expect(runService.cancelRun("run-1")).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
