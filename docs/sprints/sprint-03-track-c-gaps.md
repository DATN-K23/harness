# Track C (Sprint 3) — Đã dọn sạch toàn bộ Gaps

Cập nhật 2026-10-18 (sau vòng sửa dứt điểm N1, N2, N3 và các điểm nhỏ).

Bằng chứng nền:
- `bun turbo typecheck`: **6/6 packages pass**, 0 lỗi TS.
- `bun turbo test`: **6/6 packages pass**, **699 pass / 0 fail** trong `@harness/core`, 30/30 pass trong `@harness/cli`.
- `openspec validate "multi-turn-runner" --type change --strict`: **Valid**.

---

## Trạng thái giải quyết chi tiết

### 1. N1 — Loại bỏ hoàn toàn lỗi lặp `system_prompt` và `candidate_finding`
- **Giải pháp:** `historyItems` trong `MultiTurnRunner` chỉ lưu trữ các tool turns (`tool_request` và `tool_result`). Hai initial items (`system_prompt`, `candidate_finding`) được persist vào `context.item_added` độc lập và được `assembleTurnRequest` ghép đúng 1 lần duy nhất ở đầu mỗi request.
- **Bằng chứng test:** Test `each turn request contains exactly 1 system_prompt and exactly 1 candidate_finding (N1 fixed)` trong `multi-turn-runner.test.ts` khẳng định request ở mọi lượt (lượt 1, lượt 2, ...) luôn có **chính xác 1 `system_prompt`** và **đúng 1 `candidate_finding`**.

### 2. N2 — Nối hoàn chỉnh Resume với `hydrateHistory` và `interruptedToolItems`
- **Giải pháp:** Trước khi khởi tạo run, runner kiểm tra `existingEvents = await store.loadEvents({ runId })`. Nếu run đã có sự kiện từ trước (resumed run):
  - Gọi `hydrateHistory(existingEvents)` khôi phục lịch sử context.
  - Nếu phát hiện tool call bị ngắt giữa chừng do worker chết (`pendingToolCalls > 0`), gọi `interruptedToolItems` sinh error `tool_result` gián đoạn, persist vào trajectory và đưa vào request tiếp theo cho model.
- **Bằng chứng test:** Test `resumes run with pending interrupted tool calls using interruptedToolItems (N2 implemented)` trong `multi-turn-runner.test.ts` kiểm chứng toàn bộ luồng recovery.

### 3. N3 — Đồng bộ `maxSourceEntries` cho mọi lượt và ghi vào Run Config Snapshot
- **Giải pháp:** `maxSourceEntries` được truyền xuyên suốt qua `MultiTurnRunInput` vào `assembleTurnRequest` ở mọi lượt gọi gateway, và được ghi nhận vào `toolOutputMaxLines` trong `RunConfigSnapshot` (tuân thủ Rule R1).
- **Bằng chứng test:** Test `propagates maxSourceEntries to all turn requests and records in runConfigSnapshot (N3 fixed)` trong `multi-turn-runner.test.ts`.

### 4. Các điểm nhỏ đã siết chặt
- `failEarly` và lỗi giữa run: Loại bỏ hoàn toàn `"claim_lost"` (thay bằng `"work_handoff_failure"` thuộc vocabulary chuẩn). Khi run đã `running`, mọi lỗi xảy ra đều kích hoạt `finishRun` thực hiện CAS `transition` sang `failed`, đảm bảo **run không bao giờ bị kẹt ở `running`**.
- Khớp `itemId`: Sử dụng bảng ánh xạ `itemIdsByCallId` bảo đảm `tool.completed.itemId` khớp 100% với `resItem.id` trong `context.item_added`.
- Cờ `isTruncated`: Tool handler `read_file` và `grep` set trực tiếp trường `isTruncated: true` trong `ToolExecutionResult` khi chạm ngưỡng giới hạn.
- Terminal events: `run.budget_exhausted`, `run.cancelled`, `run.failed` đều được bọc an toàn qua `safeAppend` và kiểm tra kết quả `transition` cuối cùng.
