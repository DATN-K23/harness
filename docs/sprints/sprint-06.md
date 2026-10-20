# Sprint 6 — Giúp model làm việc với context vừa đủ

> Đây là bản tổng quan dành cho cả nhóm. Checklist triển khai chi tiết nằm ở [sprint-06-for-agent.md](sprint-06-for-agent.md).

## Sprint này giải quyết việc gì?

Mỗi lượt làm việc, model nhận hướng dẫn, yêu cầu, thông tin source, lịch sử trao đổi, mô tả tools và kết quả tool. Càng chạy lâu, lượng thông tin gửi đi càng lớn. Sprint 6 bổ sung một **Context Engine** để chuẩn bị gói thông tin đó trước mỗi lần gọi model, kiểm tra giới hạn, và ghi lại những gì đã thay đổi.

Hình dung đơn giản:

```text
Runner gom context
        |
        v
Context Engine kiểm tra và chuẩn bị
   | vừa                    | không thể tiếp tục
   v                        v
Gọi model              Dừng có lý do
   |
   +--> ghi usage thật
   |
   +--> model gọi tool --> lọc thông tin nhạy cảm --> giới hạn kết quả --> lượt tiếp theo
```

Engine dùng chung cho Judge và Audit. Engine không tự gọi model, không tự giữ lịch sử, và không sửa bản lịch sử gốc đã lưu. Runner vẫn điều phối các lượt gọi và chịu trách nhiệm ghi dữ liệu.

## Checklist mục tiêu

### Kết quả research gate — Task 1 (2026-10-20)

- Đã ghi adaptation decision record tại [Task 1 report](../../.superpowers/sdd/sprint-06-for-agent/task-1-report.md); code Sprint 6 là Harness-owned implementation, không tuyên bố port từ revision không có trong checkout.
- Reference checkout quan sát được: `/Users/nguyenbaoan/codeLab/OpenCode`, HEAD `5542415b6424aa9bad8827dc72e8cd0630b2c0ab`. Attribution object `3f393d78bf` không có trong checkout (`git cat-file` không resolve); không khẳng định source hiện tại trùng revision attribution.
- Kết luận sơ bộ: reuse `ContextEnginePort`; phải bind phép đo với request sanitized đầy đủ gồm tool schema/output cap; `needs_compaction` không gọi model nội bộ; L3 default-off. Đây là quyết định thiết kế có điều kiện, không phải approval thay mặt nhóm.
- Bạn đã chọn default Sprint 6: `W_exp=16,384`, output reserve `4,096`, trigger 80%, safety factor 1.2; bật L2 sau sanitizer; L3 và compaction tắt; pin evidence và giữ tool call/result thành cặp; usage thiếu ghi unavailable, không giả thành 0. Các lựa chọn này là quyết định Sprint 6 của bạn, không phải phê duyệt hồi tố của các track.
- Tokenizer ứng viên đã kiểm tra metadata: `js-tiktoken@1.0.21`, MIT, có subpath `o200k_base`, pure JS và chỉ phụ thuộc `base64-js`. Bạn đã cho phép pin package này để kiểm tra trong Bun, parity và benchmark; kết luận tích hợp chờ các test đó. Chi tiết evidence/research OpenCode trong report.

### 1. Đọc, nghiên cứu và thống nhất trước khi code

- [x] Đọc hai tài liệu TV2: [bản nghiên cứu](../tv2-context-research-and-plan.md) và [contract Context Engine](../tv2-context-engine-contract.md).
- [x] Nghiên cứu OpenCode; ghi rõ checkout HEAD và việc source attribution revision không có trong checkout.
- [x] So sánh thiết kế TV2/OpenCode với Context Engine, runner và event hiện có của Harness.
- [x] Ghi rõ Harness-owned implementation, contract reuse và behavior không mang sang trong [Task 1 report](../../.superpowers/sdd/sprint-06-for-agent/task-1-report.md).
- [x] Người dùng chọn các giá trị Sprint 6 ảnh hưởng kết quả: o200k, cửa sổ, output reserve, trigger, safety, L2 shaping và L3/compaction tắt.
- [x] Thứ tự sanitizer → shaping, continuation/read offset và Trace View telemetry được kiểm tra/ghi nhận trong plan và task reports; không coi đó là phê duyệt liên track.
- [x] Không tuyên bố copy/adapt code từ commit không xác minh được; giữ attribution các phần kế thừa theo NOTICE.

### 2. Context Engine biết kiểm tra và chuẩn bị context

- [x] `MultiTurnRunner` dùng production engine stateless theo ContextEngine contract; workflow cung cấp policy/items, engine không tự gọi model.
- [x] Trước mỗi model call, engine nhận items, policy, model limits, run budget và canonical request đầy đủ.
- [x] Tính nội dung, tool definitions/schema và output reserve; digest gắn với request gửi gateway.
- [x] Giữ pinned evidence; context bắt buộc quá lớn dừng trước provider.
- [x] Dùng o200k/policy chung; hard limits model-specific được kiểm tra fail-closed.
- [x] Ghi provider usage thật/delta khi có; missing usage vẫn null, estimate+reserve được tính riêng cho budget safety.
- [x] Sau sanitizer, tool output được giới hạn với continuation an toàn dùng relative path/range.
- [x] Không sửa lịch sử persisted; allocations/transformations cho model-view được ghi và đọc lại.

### 3. Nối vào luồng model/tool thật

- [x] Mọi lượt `MultiTurnRunner` đi qua Context Engine sau khi ghép prompt, source, history và tools.
- [x] Runner gửi canonical prepared request, không sửa request sau khi digest/persist.
- [x] Request vượt giới hạn/pinned evidence không vừa dừng trước gateway với lý do persisted.
- [x] Tool result theo thứ tự sanitizer → shaping → history → prepare lượt kế.
- [x] Resume khôi phục policy/usage accounting; allocations được dựng lại với tool registry hiện tại và kiểm tra digest fail-closed. Không hỗ trợ tiếp tục qua thay đổi tool schema/registry vì schema lịch sử chưa được persist.
- [x] Các lựa chọn result-affecting nằm trong context policy/run snapshot hoặc allocation telemetry.

### 4. Lưu đủ thông tin để giải thích và xem lại

- [x] Lưu policy/tokenizer, estimate, reserve, profile hard limits và provider usage thật nếu có.
- [x] Transformations ghi loại, bounds/counts và token savings.
- [x] Digest gắn đúng request gửi gateway mà không nhân bản raw context nhạy cảm.
- [x] Human/JSON view hiển thị bounded telemetry; bỏ raw prompt, events/attempt payload và raw tool result.
- [x] Readback hỗ trợ run cũ thiếu context telemetry.

### 5. Kiểm thử và xác nhận

- [x] Kiểm tra tokenizer vectors, tool schema/request accounting, output reserve và boundary cases.
- [x] Kiểm tra pinned evidence và atomic tool request/result.
- [x] Kiểm tra secret/ground-truth đã được lọc trước khi shaping và không xuất hiện trong request/event/telemetry (secret synthetic, local temp fixture).
- [x] Kiểm tra context mandatory quá lớn dừng `budget_exhausted` với `terminalReason=context_budget`, không phát sinh provider call.
- [x] Chạy integration test offline từ disk snapshot qua tool đến gateway giả; xác nhận mỗi request digest khớp request gateway đã nhận và readback giữ cùng telemetry.
- [x] Chạy các test liên quan và protocol typecheck (pass). Workspace typecheck **không pass**: bị chặn bởi lỗi `packages/core/src/tool/handlers/grep.ts` Worker `.once` (TS2339 ×3, TS7006 ×1). Không chạy destructive DB test suites.
- Offline evidence (2026-10-20, final): core 824 pass; protocol 146 pass; CLI 50 pass; focused context/runner/query 153 pass; protocol typecheck pass. `bun turbo typecheck` chỉ báo lỗi grep Worker nêu trên.
- [x] Sau offline checks, chạy live snapshot run với operational bounds (4 steps, 4 tools, 12k tokens, 120s) và mở lại từ process mới. Run completed 2 steps/1 tool. Model unpriced nên `$0.05` cost ceiling không được enforce; không khẳng định có guaranteed spend cap. Chi tiết ở [Task 6 report](../../.superpowers/sdd/sprint-06-for-agent/task-6-report.md).
- [x] Ghi run ID, provider/model, bounds, usage, pricing status và readback evidence trong Task 6 report. Model unpriced nên CLI cảnh báo cost ceiling không được enforce; không coi live run có guaranteed cost cap.

## Những gì chưa làm trong Sprint 6

- [ ] Chưa bật các cách ẩn kết quả cũ, thay read cũ bằng read mới hoặc bỏ kết quả rỗng nếu nhóm chưa duyệt chính sách tương ứng.
- [ ] Chưa nhờ LLM viết tóm tắt context trong sprint này. Nếu context không vừa, dừng rõ ràng; có thể chuẩn bị contract cho giai đoạn sau.
- [ ] Chưa làm session notes hoặc memory giữa các run; việc memory dùng dữ liệu train/test cần quyết định và ranh giới riêng.
- [ ] Chưa làm tìm kiếm/chọn source theo ngữ nghĩa, thay đổi Judge verdict hoặc chính sách retry của agent loop.

## Khi nào có thể đánh dấu hoàn tất?

- [x] Nghiên cứu OpenCode và các quyết định dùng cho sprint đã được ghi lại, gồm giới hạn reference attribution.
- [x] Luồng multi-turn thật dùng Context Engine trước mỗi provider call.
- [x] Request vượt giới hạn bị chặn trước provider; request hợp lệ chính là prepared request.
- [x] Tool output được lọc secret rồi mới giới hạn; source evidence và lịch sử truy vết được.
- [x] Estimate, usage thật nếu có, transformations, digest và stop reason có thể đọc lại.
- [x] Offline tests đạt và có live run được lưu/xem lại. Caveats còn lại: router unpriced nên cost ceiling không enforce được; DB suites không chạy; workspace typecheck không pass do Worker baseline; resume fail-closed nếu tool registry/schema đã đổi.

## Tài liệu liên quan

- [Kế hoạch triển khai chi tiết](sprint-06-for-agent.md)
- [Nghiên cứu Context & Memory của TV2](../tv2-context-research-and-plan.md)
- [Contract Context Engine của TV2](../tv2-context-engine-contract.md)
- [Lộ trình core](../core-team-timeline.md)
