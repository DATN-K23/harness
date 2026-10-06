## Why

Sau khi hoàn thành đợt tích hợp TV6 trên nhánh `feat/frontend`, mã nguồn phát sinh một số "God Components" và "God Router" có độ dài lớn (> 350 dòng), coupling cao giữa tầng lưu trữ dữ liệu, mô phỏng và định tuyến API, đồng thời tầng giao diện (Desktop UI) thiếu vắng unit test coverage (0% test safety net).
Đợt thay đổi đặc tả này nhằm mục đích tái cấu trúc có hệ thống theo tiêu chuẩn `architecture-doctor` (Safety Net trước khi phẫu thuật, tách tầng Clean Architecture) và `ui-ux-designer` (chuẩn hóa Design Tokens, khả năng tiếp cận WCAG 2.1 AA) mà không làm thay đổi các hợp đồng hành vi nghiên cứu đã công bố.

## Scope & Non-Goals

- **Scope**:
  - Thiết lập Safety Net: tác vụ kiểm thử tự động cho các UI stores và formatting utils.
  - Phân tách tầng Backend Daemon: tách Pydantic Schemas và logic mô phỏng `mock_agent_loop` ra khỏi controller `routers/runs.py`.
  - Phân rã Frontend Desktop UI: tách custom hook `useTraceData`, component `TopNavigation`, và fixture tĩnh khỏi `TraceView.tsx` và `App.tsx`.
  - Chuẩn hóa Design Tokens và Accessibility WCAG 2.1 AA: bổ sung tokens `:focus-visible`, semantic button classes và thuộc tính hỗ trợ điều hướng bàn phím.
- **Explicit Non-Goals**:
  - Không thay đổi bất kỳ REST endpoint hay SSE event contract nào.
  - Không can thiệp vào cách ly Ground Truth hay dữ liệu đánh giá CandidateFinding.
  - Không thay đổi hành vi tương tác của TV1 Agent Worker.

## What Changes

- **Backend Architecture Decoupling**:
  - Tạo `harness.entrypoints.daemon.schemas.runs` lưu trữ tập trung các Pydantic Schemas.
  - Tạo `harness.services.simulation` chuyên trách mô phỏng audit run với cơ chế dual-write (DB commit trước khi EventBus publish).
  - Tinh gọn `routers/runs.py` thành HTTP controller mỏng (< 140 dòng).
- **Frontend View Modularization & Safety Net**:
  - Viết unit tests cho `useRunStore` và `export` utilities.
  - Tách hàm thuần túy `generateRunsCSV` và `generateRunsJSON` khỏi browser I/O side-effects.
  - Tạo custom hook `useTraceData` đảm nhận toàn bộ luồng REST hydration và SSE subscription.
  - Tách `TopNavigation` và `demo.fixture.ts` để giảm tải cho `App.tsx`.
- **Design System & A11y Polish**:
  - Chuẩn hóa CSS custom properties trong `index.css` (`--focus-ring`, `--gradient-brand`, button classes).
  - Bổ sung `scope="col"`, `tabIndex={0}`, `role="button"`, phím `Enter`/`Space` cho `DashboardView.tsx`.

## Capabilities

### New Capabilities

- `ui-test-safety-net`: Cung cấp bộ unit test và cơ chế kiểm thử thuần túy không phụ thuộc DOM cho trạng thái UI và tiện ích định dạng báo cáo.

### Modified Capabilities

- `asynchronous-run-api`: Đặc tả việc phân rã tầng Schema và Service độc lập cho router Daemon API, bảo toàn tuyệt đối chữ ký REST và định dạng SSE.
- `trace-view`: Đặc tả việc tách biệt presentation component và dữ liệu qua custom hook `useTraceData`, bổ sung hỗ trợ điều hướng bàn phím theo chuẩn WCAG 2.1 AA.

## Impact

- Affected Code:
  - `runtime/src/harness/entrypoints/daemon/`
  - `runtime/src/harness/services/`
  - `apps/desktop/ui/src/`
- System Impact: Cải thiện tính bảo trì, triệt tiêu technical debt, nâng số lượng unit test từ 4 lên 14 tests, và bảo toàn 100% hợp đồng API và kiểm thử E2E hiện có.
