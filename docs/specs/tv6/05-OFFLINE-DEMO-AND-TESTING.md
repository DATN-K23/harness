# Technical Specification — TV6: Offline Demo & Quality Verification Plan
## Document Identifier: SPEC-TV6-05-DEMO-TESTING
**Standard Compliance:** ISO/IEC/IEEE 29148:2018 / IEEE 829 (Software Test Documentation)  
**Status:** Approved Architectural Specification  
**Track:** TV6 — Application & Demo  

---

## 1. Offline Demo Operation Protocol (Bảo vệ Đồ án)

Để đảm bảo buổi bảo vệ đồ án diễn ra thành công 100% không chịu rủi ro về kết nối mạng internet hay quota API LLM provider, TV6 thiết lập quy trình vận hành **Offline Demo Mode**.

### 1.1 Offline Demo Execution Checklist (Dành cho thành viên TV6)

1. **Chuẩn bị trước buổi bảo vệ 1 ngày**:
   - Chạy lệnh xuất dữ liệu snapshot cho 3 kịch bản demo mẫu (Reentrancy, Access Control, Oracle Manipulation):
     ```bash
     corepack pnpm demo:export-snapshot --run-id=run-reentrancy-01 --output=docs/fixtures/demo-runs/run-01.json
     ```
   - Kiểm tra file SQLite DB tĩnh đính kèm `demo.db` có chứa đầy đủ thông tin `Run`, `ToolCall`, `Verdict` và `ModelEvent`.

2. **Khởi tạo môi trường Demo Offline trên laptop bảo vệ**:
   - Tắt kết nối Wifi / Ethernet (Ngắt kết nối mạng hoàn toàn).
   - Đặt biến môi trường `DEMO_MODE=true`.
   - Chạy lệnh khởi động hệ thống hai mode:
     ```bash
     corepack pnpm demo:start
     ```
   - NestJS API (`apps/api`) sẽ lắng nghe tại `http://localhost:3000` ở chế độ phát lại offline.
   - React SPA (`apps/web`) sẽ lắng nghe tại `http://localhost:5173`.

3. **Thao tác trình chiếu trước Hội đồng**:
   - Truy cập giao diện `/demo`.
   - Chọn Kịch bản Reentrancy Verification -> Nhấn "Play".
   - Sử dụng thanh điều khiển **ReplayController** để thay đổi tốc độ (2x / 5x) hoặc ấn "Pause" tại bước Agent phát hiện lỗ hổng để giải thích chi tiết cho Hội đồng.

---

## 1.2 Kiến trúc Offline Demo Replay — Client-Driven Model

> **Đổi Mới Kiến trúc**: Phiên bản trước sử dụng `DemoReplayService` phía Backend với `setTimeout` để giả lập nhịp độ phát sự kiện. Mô hình này có nhiều điểm yếu nghiêm trọng:
> - **Không phản hồi tức thì**: Server cần phải chờ `setTimeout` mới có thể phản hồi lệnh Pause/Jump từ UI → độ trễ tối thiểu 500-2000ms.
> - **Phục tạp không cần thiết**: Server cần quản lý trạng thái phát lại (Replay State) — việc này thuộc về UI concern.

### Mô hình Mới: Client-Driven Replay

| Yếu tố | Mô hình Cũ (Server-Driven) | Mô hình Mới (Client-Driven) |
| :--- | :--- | :--- |
| Timer quản lý | Backend `setTimeout` | Frontend `setInterval` |
| Điều khiển Pause/Jump | HTTP request mới + chờ timer | Cập nhật Zustand Store tức thì (0ms) |
| Điều kiện offline | Cần server chạy (local) | Hoàn toàn tự trị sau 1 REST call |
| API Demo | `GET /demo/runs/:id/stream` (SSE) | `GET /api/v1/demo/runs/:id/timeline` (REST JSON) |
| Cơ chế | Server push event từng cái | Client tự phát event từng bước |

### `ReplayController` Store (Zustand)

```typescript
// file: apps/web/src/stores/replay.store.ts
import { create } from 'zustand';

interface DemoEvent {
  type: string;
  payload: Record<string, any>;
  delayMs?: number; // Thời gian delay gốc giữa các bước
}

interface ReplayStore {
  events: DemoEvent[];
  currentStep: number;
  isPlaying: boolean;
  playbackSpeed: number; // 0.5 | 1 | 2 | 5 | 10
  
  // Actions
  setEvents: (events: DemoEvent[]) => void;
  setPlaying: (isPlaying: boolean) => void;
  setSpeed: (speed: number) => void;
  jumpToStep: (step: number) => void;
  tickStep: () => void; // Gọi bởi setInterval
}

export const useReplayStore = create<ReplayStore>((set) => ({
  events: [],
  currentStep: 0,
  isPlaying: false,
  playbackSpeed: 1,

  setEvents: (events) => set({ events, currentStep: 0 }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setSpeed: (playbackSpeed) => set({ playbackSpeed }),
  jumpToStep: (step) => set({ currentStep: step, isPlaying: false }),
  tickStep: () =>
    set((state) => ({
      currentStep: Math.min(state.currentStep + 1, state.events.length - 1),
      isPlaying: state.currentStep + 1 < state.events.length,
    })),
}));
```

### Vòng lặp Replay Timer (trong `ReplayController` component)

```typescript
// file: apps/web/src/components/demo/ReplayController.tsx (excerpt)
useEffect(() => {
  if (!isPlaying || currentStep >= events.length) return;

  const currentEvent = events[currentStep];
  const delayMs = (currentEvent.delayMs ?? 500) / playbackSpeed;

  const timerId = setTimeout(() => {
    // Phát event hiện tại vào UI State
    dispatchEventToUI(currentEvent);
    tickStep(); // Bước tiếp theo
  }, delayMs);

  return () => clearTimeout(timerId); // Cleanup khi isPlaying = false hoặc unmount
}, [isPlaying, currentStep, playbackSpeed]);
```

> [!WARNING]
> **⚠️ PITFALL — Tick Drift (I2)**: Chuỗi `setTimeout` lồng nhau (mỗi lần render tạo 1 timer mới) sẽ cộng dồn thêm thời gian render component + re-run Effect vào `delayMs` thực tế. Kết quả: replay **chậm dần** càng lâu chạy (drift). Ảnh hưởng demo experience khi playbackSpeed cao (5x/10x).
>
> **Cách fix khi implement**: Thay vì dùng `delayMs` tuyệt đối, tính `nextTick` dựa trên **wall-clock timestamp** để compensation:
> ```typescript
> // Pattern đúng: bù trừ thời gian render
> const expectedAt = performance.now() + delayMs;
> const timerId = setTimeout(() => {
>   const drift = performance.now() - expectedAt; // > 0 nếu bị trễ
>   dispatchEventToUI(currentEvent);
>   tickStep();
>   // Truyền `drift` sang step tiếp theo để trừ vào delayMs kế tiếp
> }, Math.max(0, delayMs));
> ```
> Với demo tốc độ 1x, drift là chấp nhận được. Bắt buộc xử lý khi `playbackSpeed >= 5`.


---

## 2. Test Plan & Quality Assurance (Vitest + React Testing Library)

Mọi thành phần code trong TV6 phải được kiểm thử tự động với tỷ lệ bao phủ mã nguồn (code coverage) tối thiểu **80%**.

```
TV6 Test Suite Hierarchy
├── apps/web/src/__tests__/
│   ├── unit/
│   │   ├── ReplayController.test.tsx    # Test nút Play/Pause/Speed slider logic (client timer)
│   │   └── ToolCallCard.test.tsx        # Test render preview (64px fixed-height) và expanded state
│   └── e2e/
│       ├── trace-view-flow.spec.ts      # E2E test cho luồng hiển thị TraceView (Page Recovery)
│       └── offline-failover.spec.ts     # E2E test ngắt mạng và thao tác ReplayController
├── apps/api/src/__tests__/
│   ├── unit/
│   │   └── stream.service.spec.ts       # Test RxJS event filtering và replayHistoricalEvents
│   └── integration/
│       └── run.controller.spec.ts       # Integration test API endpoints (Supertest)
└── packages/sdk/src/__tests__/
    └── client.spec.ts                   # Test mock fetchEventSource SSE listener
```

---

## 3. Quality Verification Gate Checklist

Trước khi merge bất kỳ Pull Request nào của TV6, bộ kiểm tra chất lượng (Quality Gate) bắt buộc phải vượt qua các lệnh sau:

```bash
# 1. Format check & Linter
corepack pnpm run format:check
corepack pnpm run lint

# 2. Typecheck strict
corepack pnpm run typecheck

# 3. Dependency Cruiser (Kiểm tra không vi phạm ranh giới package)
corepack pnpm run deps:check

# 4. Vitest Unit & Integration tests
corepack pnpm run test

# 5. Full Verification
corepack pnpm run verify
```

- **Thành công**: Tất cả 5 lệnh trên phải trả về exit code `0` (Zero warnings/errors).

---

## 4. Kịch bản Kiểm thử E2E: Offline Failover Test

> **Mục tiêu**: Đảm bảo `ReplayController` hoạt động trơn tru hoàn toàn khi tắt mạng sau khi đã tải xong timeline JSON (chứng minh mô hình Client-Driven là offline-capable 100%).

### Test File: `apps/web/src/__tests__/e2e/offline-failover.spec.ts`

```typescript
// file: apps/web/src/__tests__/e2e/offline-failover.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Offline Demo Failover', () => {
  test('ReplayController vẫn hoạt động sau khi ngắt mạng hoàn toàn', async ({ page, context }) => {
    // 1. Truy cập trang Demo khi có mạng
    await page.goto('http://localhost:5173/demo');
    await page.waitForSelector('[data-testid="demo-case-reentrancy"]');
    await page.click('[data-testid="demo-case-reentrancy"]');

    // 2. Chờ load timeline JSON xong (1 REST request duy nhất)
    await page.waitForSelector('[data-testid="replay-controller"]');
    await expect(page.locator('[data-testid="timeline-loaded"]')).toBeVisible();

    // 3. Ngắt mạng hoàn toàn (offline mode)
    await context.setOffline(true);

    // 4. Nhấn Play — ReplayController phải phản hồi tức khắc (client timer)
    await page.click('[data-testid="play-button"]');
    await expect(page.locator('[data-testid="step-card"]')).toHaveCount({ min: 1 });

    // 5. Kiểm tra Pause hoạt động ngay lập tức (0ms)
    const stepBeforePause = await page.locator('[data-testid="current-step"]').textContent();
    await page.click('[data-testid="pause-button"]');
    await page.waitForTimeout(500); // Chờ 500ms để kiểm tra step không tiến thêm
    const stepAfterPause = await page.locator('[data-testid="current-step"]').textContent();
    expect(stepBeforePause).toBe(stepAfterPause); // Step không đổi sau Pause

    // 6. Kiểm tra Jump to Step
    await page.fill('[data-testid="step-slider"]', '5');
    await expect(page.locator('[data-testid="current-step"]')).toHaveText('5');

    // 7. Kiểm tra Speed change (5x)
    await page.selectOption('[data-testid="speed-selector"]', '5');
    await page.click('[data-testid="play-button"]');
    await page.waitForTimeout(1000); // 1 giây — tốc độ 5x nên đã tiến khá nhiều bước
    const stepAfterSpeed = await page.locator('[data-testid="current-step"]').textContent();
    expect(Number(stepAfterSpeed)).toBeGreaterThan(5);

    // 8. Phục hồi mạng và kiểm tra không có crash
    await context.setOffline(false);
    await expect(page.locator('[data-testid="replay-controller"]')).toBeVisible();
  });

  test('Khởi động lại (F5) trên TraceView khôi phục được lịch sử', async ({ page }) => {
    // Giả lập: Run đang chạy với 10 tool calls đã ghi
    await page.goto('http://localhost:5173/runs/run-demo-01');
    await page.waitForSelector('[data-testid="tool-call-card"]');

    const initialCount = await page.locator('[data-testid="tool-call-card"]').count();
    expect(initialCount).toBeGreaterThanOrEqual(10);

    // F5 reload
    await page.reload();
    await page.waitForSelector('[data-testid="tool-call-card"]');

    // Sau reload, phải vẫn có được ít nhất số lượng tool calls ban đầu
    const afterReloadCount = await page.locator('[data-testid="tool-call-card"]').count();
    expect(afterReloadCount).toBeGreaterThanOrEqual(initialCount);

    // Badge SSE phải hiển Connected hoặc Offline (không phải blank)
    await expect(page.locator('[data-testid="sse-status-badge"]')).toBeVisible();
  });
});
```
