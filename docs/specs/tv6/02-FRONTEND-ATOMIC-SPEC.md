# Technical Specification — TV6: Frontend Atomic Specification (`apps/web`)
## Document Identifier: SPEC-TV6-02-FRONTEND-ATOMIC
**Standard Compliance:** ISO/IEC/IEEE 29148:2018 / W3C Web Content Accessibility Guidelines (WCAG 2.1 AA)  
**Status:** Approved Architectural Specification  
**Track:** TV6 — Application & Demo  

---

## 1. Design System & Aesthetic Foundations

Frontend `apps/web` tuân thủ phong cách **Minimalist Light/Dark Hybrid Design System**, kết hợp giữa tính hiện đại của **shadcn/ui** và tính chính xác của các bảng điều khiển chuyên sâu.

### 1.1 Visual Tokens & Color Palette
- **Light Mode Palette**: Clean Zinc/Slate background (`#F8FAFC`), crisp border (`#E2E8F0`), high-contrast dark text (`#0F172A`).
- **Dark Mode Palette**: Deep Slate background (`#090D16`), card surface (`#121826`), muted border (`#1E293B`), text primary (`#F8FAFC`).
- **Accent Status Colors**:
  - `Valid / Pass / Success`: Emerald (`#10B981`)
  - `Invalid / Fail / Danger`: Rose (`#F43F5E`)
  - `Running / In-Progress`: Amber (`#F59E0B`) with subtle pulse animation
  - `Tool Call / Informational`: Sky (`#0284C7`)
- **Typography Standard**:
  - Primary UI Font: `Inter`, system-ui, sans-serif.
  - Monospace Log / Code / JSON Font: `JetBrains Mono`, `Fira Code`, monospace.

---

## 2. Router & View Hierarchy

Ứng dụng SPA được phân chia thành 5 tuyến đường (routes) chính:

| Route Path | Page Name | Primary Objective |
| :--- | :--- | :--- |
| `/` | Dashboard | Tổng quan hệ thống, thống kê lượt chạy, nút bấm tạo Audit Run mới |
| `/runs` | Run Explorer | Bảng tìm kiếm, lọc và phân trang danh sách các Audit Run |
| `/runs/:id` | **Trace View (Primary View)** | Hiển thị chi tiết từng step suy luận, tool call log, và verdict của 1 Run |
| `/compare` | Multi-Run Comparator | So sánh song song 2 hoặc nhiều Run (dùng cho nghiên cứu TV5) |
| `/demo` | **Offline Demo Replay** | Màn hình phát lại kịch bản Offline Demo với thanh điều khiển Replay |

---

## 3. Atomic UI Component Specifications

### 3.1 Component `TraceView` (`apps/web/src/components/trace/TraceView.tsx`)
Màn hình trung tâm hiển thị toàn bộ lộ trình suy luận của Agent.

- **Props Interface**:
  ```typescript
  interface TraceViewProps {
    runId: string;
    isLiveMode: boolean;
    isReplayActive?: boolean;
  }
  ```

#### 3.1.1 Luồng Khởi tạo Trang (Page Refresh State Recovery)

Khi component mount tại route `/runs/:id` (kể cả sau F5 / reload tab), bắt buộc thực hiện theo thứ tự sau để tránh mất dữ liệu lịch sử:

```
+---------------------------------------------------------------+
|               Luồng Khởi tạo (Initialization Flow)          |
|                                                               |
|  1. REST: GET /api/v1/runs/:id         [Lấy thông tin Run]   |
|     → Hydrate runStore (status, title, config)                |
|                                                               |
|  2. REST: GET /api/v1/runs/:id/tool-calls  [Lịch sử đầy đủ]  |
|     → Hydrate toolCallList[] vào UI State                     |
|                                                               |
|  3. Nếu run.status === 'RUNNING':                            |
|     Subscribe SSE stream với fromStep = toolCallList.length  |
|     → Chỉ nhận các event mới hơn (delta) để append vào list |
+---------------------------------------------------------------+
```

```typescript
// file: apps/web/src/components/trace/TraceView.tsx (excerpt)
import { useEffect, useRef } from 'react';
import { useAuditHarnessClient } from '../../hooks/useAuditHarnessClient';
import { useRunStore } from '../../stores/run.store';

function TraceView({ runId }: TraceViewProps) {
  const client = useAuditHarnessClient();
  const { setRun, toolCalls, appendToolCall, setSseStatus } = useRunStore();
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    async function initialize() {
      // Bước 1: Lấy thông tin Run
      const run = await client.getRun(runId);
      setRun(run);

      // Bước 2: Lấy toàn bộ lịch sử Tool Calls đã ghi
      const historicalToolCalls = await client.getToolCalls(runId);
      historicalToolCalls.forEach(appendToolCall);

      // Bước 3: Nếu đang chạy, subscribe SSE từ bước tiếp theo
      if (run.status === 'RUNNING') {
        setSseStatus('connecting');
        unsubscribeRef.current = client.subscribeRunStream(
          runId,
          {
            onThought: (e) => { /* ... */ },
            onToolCall: (e) => appendToolCall(e),
            onCompleted: () => setSseStatus('offline'),
            onError: () => setSseStatus('reconnecting'),
            onStatusChanged: (e) => { /* cập nhật status */ },
          },
          { fromStep: historicalToolCalls.length }, // Chỉ nhận event mới hơn
        );
        setSseStatus('connected');
      }
    }

    initialize();
    return () => unsubscribeRef.current?.(); // Cleanup khi unmount
  }, [runId]);
}
```

#### 3.1.2 Cấu trúc Component
  1. `TraceHeader`: Hiển thị ID Run, Target Repository, Status Badge (Running/Completed), Token Usage Counter, Wall-clock Timer. **Bắt buộc hiển thị SSE Connection Badge** (xem mục 3.1.3) và nút **"Abort Run"** (xem mục 3.1.4).
  2. `VerdictBanner`: (Xuất hiện khi completed) Render kết luận cuối cùng (VALID / INVALID), Severity Level, và nút xem PoC Test Source Code.
  3. `StepList`: Danh sách ảo hoá (Virtualized List using `@tanstack/react-virtual`) chứa các `StepCard`.
  4. `TraceFooter`: Thanh bật/tắt Auto-scroll ("Lock to bottom"), bộ lọc tìm kiếm theo từ khoá log, nút bấm Export CSV/JSON.

#### 3.1.3 SSE Connection Status Badge

Header phải hiển thị badge kết nối SSE dựa trên trạng thái `sseStatus` trong store:

| `sseStatus` | Badge UI | Mô tả |
| :--- | :--- | :--- |
| `'connected'` | 🟢 `Connected` (Emerald) | Kết nối SSE thành công, nhận event live |
| `'reconnecting'` | 🟡 `Reconnecting...` (Amber, pulse) | Mất kết nối, SDK đang retry với backoff |
| `'offline'` | ⚪ `Offline` (Slate) | Run đã kết thúc hoặc bị hủy, không có stream |
| `'connecting'` | ⏳ `Connecting...` (Sky) | Đang thực hiện handshake ban đầu |

#### 3.1.4 Nút "Abort Run" (Stop Audit)

- Chỉ hiển thị khi `run.status === 'RUNNING'`.
- Giao diện: Nút đỏ `Abort Run` ở `TraceHeader`, nằm bên cạnh Status Badge.
- Khi nhấn: Hiển thị **dialog xác nhận** trước khi gọi API:

```typescript
// Cơ chế trong TraceHeader component
async function handleAbortRun() {
  const confirmed = await showConfirmDialog({
    title: 'Abort Audit Run?',
    description: 'Hành động này sẽ dừng Agent Loop ngay lập tức. Dữ liệu đã ghị được giữ nguyên.',
    confirmLabel: 'Yes, Abort',
    variant: 'destructive',
  });
  if (!confirmed) return;

  try {
    await client.cancelRun(runId); // Gọi SDK cancelRun
    setRun((prev) => ({ ...prev, status: 'CANCELLED' }));
  } catch (err) {
    toast.error('Không thể hủy run: ' + err.message);
  }
}
```

### 3.2 Component `ToolCallCard` (`apps/web/src/components/trace/ToolCallCard.tsx`)
Card hiển thị nguyên tử việc thực thi một công cụ của Agent.

> **Yêu cầu Virtual List**: Mặc định, `ToolCallCard` **BUỘC phải** render ở trạng thái **thu gọn** (collapsed/preview) với **chiều cao cố định ~64px** (`estimateSize: () => 64`). Điều này giúp `@tanstack/react-virtual` tính toán lưới cuộn ổn định, tránh lỗi **scroll jumping** khi có nhiều card tự mở rộng trong khi auto-scroll đang kích hoạt.

- **Hai Trạng thái Render**:
  - **Preview Mode (mặc định, collapsed)**: Chiều cao cố định 64px. Hiển thị: icon tool, tên tool, duration badge, và nút `▼ Expand`.
  - **Expanded Mode (khi người dùng nhấn Expand)**: Tính toán lại dynamic height, render đầy đủ các sub-component.

- **Sub-components (chỉ hiển thị khi Expanded)**:
  - `ToolHeader`: Icon của tool, Tên tool (`read_file`, `grep`, `verification`), Thời gian thực thi (`durationMs`), Token consumed.
  - `CollapsibleArguments`: Bảng hiển thị JSON input arguments với nút bấm "Copy JSON".
  - `ResultPayloadViewer`: Bảng hiển thị kết quả output. Nếu là `read_file` -> hiển thị Monaco/Shiki Code Highlighting. Nếu là lỗi (`isError = true`) -> render viền đỏ đứt nét kèm giải thích cho LLM.

### 3.3 Component `ReplayController` (`apps/web/src/components/demo/ReplayController.tsx`)
Thanh công cụ điều khiển phát lại dành riêng cho chế độ Offline Demo.

- **Interactive Controls**:
  - `Play/Pause Button`: Tạm dừng hoặc tiếp tục luồng phát log.
  - `Speed Selector`: Chuyển đổi tốc độ phát `0.5x`, `1x`, `2x`, `5x`, `10x` hoặc `Instant`.
  - `Progress Timeline Slider`: Drag slider để nhảy trực tiếp tới bước bất kỳ (`stepIndex`).
  - `Step Backward / Forward Buttons`: Nhảy lùi hoặc tiến đúng 1 bước `stepIndex`.

```
+-----------------------------------------------------------------------------------+
|                               REPLAY CONTROLLER                                   |
|   [ || Pause ]  [ << Step Back ]  [ Step Forward >> ]   Speed: [ 2x  v ]           |
|   Progress: ====[==========================================>-------------] 65%     |
|   Current: Step 12 / 18 | Token: 24,500 | Elapsed: 01:45 (Simulated)                |
+-----------------------------------------------------------------------------------+
```

### 3.4 Component `MultiRunComparisonTable` (`apps/web/src/components/compare/MultiRunComparisonTable.tsx`)
Bảng so sánh đa chỉ số dành cho việc phân tích Ablation Study (TV5).

- **Comparison Features**:
  - So sánh theo hàng: Total Steps, Wall-clock Duration, Token Count, Final Verdict Match, Total Cost (USD).
  - Highlighting Delta: Tô màu xanh lá lá cho chỉ số tối ưu hơn (ví dụ: tiết kiệm token hơn 30%), tô màu đỏ cho chỉ số kém hơn.

---

## 4. State Management & Performance Benchmarks

### 4.1 Global State (Zustand Store)
Dùng `Zustand` cho state toàn cục nhẹ, dễ bảo trì:
- `useThemeStore`: Quản lý Light/Dark mode preference.
- `useRunStore`: Lưu giữ danh sách active runs, **SSE connection status** (`sseStatus: 'connecting' | 'connected' | 'reconnecting' | 'offline'`).
- `useReplayStore`: Lưu thông tin timeline `currentStep`, `playbackSpeed`, `isPlaying`.

### 4.2 Performance Requirements (Non-Functional Requirements)
1. **Zero-Lag Event Rendering**: Luồng SSE có thể nhận tới 50 events/giây. Frontend sử dụng `requestAnimationFrame` batching để gom các event render tối đa 60 FPS, không gây đơ tab trình duyệt.
2. **Memory Cap**: Hỗ trợ xem các run có tới 1,000 tool calls hoặc 50,000 dòng log mà lượng RAM tiêu tốn trên browser không vượt quá **150 MB** nhờ Virtualized List rendering.
