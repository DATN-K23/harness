# Plan: Dọn bớt UI — chỉ hiện chức năng chính

Ngày: 2026-10-02. Nhánh: `feat/frontend`. Phạm vi: **ẩn tạm (không render), không xóa code, không đổi layout/routing**.

## Nguyên tắc

- 1 màn hình = chức năng chính. Mọi telemetry/dev-jargon ẩn khỏi view chính.
- Thực hiện bằng cách không render các block phụ (giữ component/code để khôi phục sau).
- Không đụng API, store, backend.

## 1. `JudgeForm.tsx` — form chỉ còn 3 món

Giữ: ô repo + ô finding + nút Start (kèm validation hiện có `JudgeForm.tsx:95-121`, submit `123-133`).

Ẩn tạm:
- Header badge `Autonomous Judge v1.0` + `Zero-Trust Sandbox` (`146-217`).
- `Quick Test Presets` (`228-~260`) — chuyển sang khu demo sau.
- `LLM Inference Engine` dropdown — default `claude-3-5-sonnet`, giấu sau `<details>Nâng cao</details>`.
- `Max Token Quota` slider — default `50000`, cho vào `Nâng cao`.
- Khối `Sandbox capabilities` (`read_file, exec_script, forge_test, ast_grep`) — xóa khỏi view (Judge chỉ tool đọc; `exec_script` lộ sai cam kết).
- Recent runs trong form (trùng Lịch sử).

## 2. `TraceView.tsx` — verdict trước, trace sau

Giữ theo thứ tự: `TraceHeader` (gọn) → `VerdictBanner` → danh sách event → error + Retry (`455-494`).

Ẩn tạm:
- Toàn bộ Telemetry HUD Strip (`212-452`): Token Burn gauge, filter tabs All/Tools/Thoughts/Errors, Auto-scroll toggle. Mặc định: hiện tất cả event, auto-scroll ON (giữ state, bỏ nút).
- Dòng `Agent Trajectory Timeline (N events)` + `Sandbox execution in progress...` (`496-547`) — gộp thành 1 dòng trạng thái duy nhất trong header.
- Empty state đổi copy: `Awaiting incoming SSE events...` → `Chưa có run nào. Tạo run mới từ khung bên trái.` (bỏ chữ SSE).

## 3. `TraceHeader.tsx` — 1 dòng trạng thái

Giữ: run id + trạng thái run (running/completed/failed...).
Ẩn tạm: badge SSE `Connected/Reconnecting...` chi tiết, nút cancel/trigger thừa (giữ 1 nút Hủy khi running nếu backend đã có, hiện tại cancel là giả → ẩn luôn tới khi P4 làm cancel thật).

## 4. `TopNavigation.tsx` — 2 nút

- Gộp `Live Mode / Demo Replay / Analytics` (`269-359`) thành 2 nút: `Chấm mới` / `Lịch sử`. Demo replay là 1 dòng trong Lịch sử.
- Badge daemon (`198-254`): chỉ giữ chấm xanh/đỏ, bỏ chữ `Daemon :3000` + latency `12ms` khỏi mặt chính (giữ trong tooltip).
- Bỏ chip repo breadcrumb (`165-185`).

## 5. `App.tsx` — bỏ thanh đáy

- Xóa docked transport bar (`205-293`: `RUN ACTIVE`, `Engine: DeepSeek-V3`, `Buffer: Virtualized (60fps)`).
- Nguồn sự thật duy nhất: engine/model hiển thị (nếu cần) lấy từ run thật, không hardcode 2 nơi mâu thuẫn (form `Claude 3.5` vs đáy `DeepSeek-V3`).
- Giữ error ribbon (`100-133`) nhưng chuyển lỗi start-run vào inline trong form.

## Copywriting (đổi chữ dev → chữ người dùng)

| Cũ | Mới |
|---|---|
| `Awaiting incoming SSE events from agent sandbox...` | `Chưa có run nào. Tạo run mới từ khung bên trái.` |
| `Synchronizing trajectory stream...` | `Đang tải...` |
| `Daemon :3000 12ms` | chấm trạng thái + tooltip |
| `Buffer: Virtualized (60fps)` | xóa |
| `Demo Trajectory Replay` | `Chạy mẫu` (1 dòng trong Lịch sử) |

## Nghiệm thu

- [ ] Mở app chưa start: chỉ thấy form 3 món, không khung trống, không `Not Found`.
- [ ] Start 1 run: đúng 1 trạng thái nhất quán mọi vị trí; verdict đọc được trong 5 giây đầu.
- [ ] Không còn chữ `SSE`, `Virtualized`, `Daemon :3000`, `configSnapshot` ở view chính.
- [ ] `pnpm --filter ./apps/desktop/ui exec tsc --noEmit` pass; `vitest run` pass (2 file, 10 test); chụp screenshot 1920x1080 đối chiếu.
