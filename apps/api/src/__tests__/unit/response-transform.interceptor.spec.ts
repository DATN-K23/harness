import { describe, it, expect, beforeEach, vi } from "vitest";
import { of } from "rxjs";
import { ResponseTransformInterceptor } from "../../common/interceptors/response-transform.interceptor.js";

describe("ResponseTransformInterceptor (Unit)", () => {
  let interceptor: ResponseTransformInterceptor<any>;
  let mockReflector: any;
  let mockExecutionContext: any;
  let mockCallHandler: any;

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    };
    mockExecutionContext = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue({ statusCode: 200 }),
        getRequest: vi.fn().mockReturnValue({ headers: {} }),
      }),
    };
    interceptor = new ResponseTransformInterceptor(mockReflector);
  });

  it("wrap response bình thường vào data payload", async () => {
    mockCallHandler = {
      handle: () => of({ id: "123", name: "Test" }),
    };

    const observable$ = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );

    observable$.subscribe((res: any) => {
      expect(res.success).toBe(true);
      expect(res.code).toBe(200);
      expect(res.data).toEqual({ id: "123", name: "Test" });
      expect(res.meta.requestId).toBeDefined();
    });
  });

  it("trích xuất pagination khi response có _paginated flag", async () => {
    const paginatedData = {
      _paginated: true,
      items: [{ id: "1" }, { id: "2" }],
      pagination: {
        page: 1,
        pageSize: 10,
        totalItems: 2,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };

    mockCallHandler = {
      handle: () => of(paginatedData),
    };

    const observable$ = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );

    observable$.subscribe((res: any) => {
      expect(res.success).toBe(true);
      expect(res.data).toEqual([{ id: "1" }, { id: "2" }]);
      expect(res.meta.pagination).toEqual(paginatedData.pagination);
    });
  });

  it("bỏ qua transform khi có @SkipResponseTransform decorator", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);
    const rawData = { raw: "stream" };
    mockCallHandler = {
      handle: () => of(rawData),
    };

    const observable$ = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );

    observable$.subscribe((res: any) => {
      expect(res).toEqual(rawData);
    });
  });
});
