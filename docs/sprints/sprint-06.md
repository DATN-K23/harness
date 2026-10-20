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

- Đã ghi adaptation decision record tại [Task 1 report](../../.superpowers/sdd/sprint-06-for-agent/task-1-report.md); chưa thực hiện code adaptation.
- Reference checkout quan sát được: `/Users/nguyenbaoan/codeLab/OpenCode`, HEAD `5542415b6424aa9bad8827dc72e8cd0630b2c0ab`. Attribution object `3f393d78bf` không có trong checkout (`git cat-file` không resolve); không khẳng định source hiện tại trùng revision attribution.
- Kết luận sơ bộ: reuse `ContextEnginePort`; phải bind phép đo với request sanitized đầy đủ gồm tool schema/output cap; `needs_compaction` không gọi model nội bộ; L3 default-off. Đây là quyết định thiết kế có điều kiện, không phải approval thay mặt nhóm.
- Bạn đã chọn default Sprint 6: `W_exp=16,384`, output reserve `4,096`, trigger 80%, safety factor 1.2; bật L2 sau sanitizer; L3 và compaction tắt; pin evidence và giữ tool call/result thành cặp; usage thiếu ghi unavailable, không giả thành 0. Các lựa chọn này là quyết định Sprint 6 của bạn, không phải phê duyệt hồi tố của các track.
- Tokenizer ứng viên đã kiểm tra metadata: `js-tiktoken@1.0.21`, MIT, có subpath `o200k_base`, pure JS và chỉ phụ thuộc `base64-js`. Bạn đã cho phép pin package này để kiểm tra trong Bun, parity và benchmark; kết luận tích hợp chờ các test đó. Chi tiết evidence/research OpenCode trong report.

### 1. Đọc, nghiên cứu và thống nhất trước khi code

- [ ] Đọc hai tài liệu TV2: [bản nghiên cứu](../tv2-context-research-and-plan.md) và [contract Context Engine](../tv2-context-engine-contract.md).
- [ ] Nghiên cứu phần xử lý context trong OpenCode; ghi lại chính xác commit, file và thuật toán tham khảo.
- [ ] So sánh thiết kế TV2 và OpenCode với Context Engine, runner và event hiện có của Harness.
- [ ] Ghi rõ phần nào sẽ tái sử dụng/adapt, phần nào không phù hợp với kiến trúc Harness.
- [ ] Nhóm xác nhận các lựa chọn ảnh hưởng kết quả: cách đếm o200k, cửa sổ chung giữa các provider, phần chừa cho câu trả lời, ngưỡng bắt đầu giảm context và giới hạn an toàn.
- [ ] Chốt với các track liên quan: ai gọi Context Engine, thứ tự lọc secret/cắt tool output, cách đọc tiếp file và các số liệu Trace View cần lưu.
- [ ] Chưa port hoặc adapt code cho tới khi nghiên cứu và các lựa chọn cần thiết được ghi lại.

### 2. Context Engine biết kiểm tra và chuẩn bị context

- [ ] Dùng chung một engine cho Judge và Audit; workflow cung cấp nội dung cần giữ, engine không cần biết đang chạy mode nào.
- [ ] Trước mỗi lần gọi model, engine nhận danh sách context item, chính sách, giới hạn model và ngân sách run.
- [ ] Tính cả nội dung, tool definitions/schema và phần chừa cho output; không chỉ đếm ký tự trong history.
- [ ] Giữ nguyên các nội dung được ghim, như finding/evidence bắt buộc. Nếu nội dung bắt buộc không vừa, dừng rõ ràng thay vì âm thầm bỏ evidence.
- [ ] Dùng cùng một thước đo và chính sách giữa các provider; giới hạn thật của từng model chỉ dùng để chặn request không an toàn.
- [ ] Sau mỗi response, ghi token provider báo và so sánh với estimate của Context Engine.
- [ ] Sau khi lọc secret, giới hạn kết quả tool quá dài và báo rõ nếu nội dung bị cắt; giữ đường dẫn tương đối và line/range để truy nguồn.
- [ ] Không thay đổi lịch sử gốc. Ghi lại các thay đổi trong model-view để có thể giải thích model đã thấy gì.

### 3. Nối vào luồng model/tool thật

- [ ] Mọi lượt của `MultiTurnRunner` đi qua Context Engine sau khi runner gom prompt, source, history và tools.
- [ ] Runner gửi chính xác nội dung Context Engine đã chuẩn bị; không tự sửa request sau bước kiểm tra.
- [ ] Nếu context vượt giới hạn hoặc không thể giữ evidence bắt buộc, run dừng trước khi gọi provider và lưu lý do.
- [ ] Kết quả tool đi theo đúng thứ tự: lọc secret → giới hạn/shaping → ghi history → chuẩn bị lượt model tiếp theo.
- [ ] Khi resume run, dùng cùng policy và không áp dụng biến đổi hai lần.
- [ ] Mọi lựa chọn làm thay đổi nội dung model thấy phải được cấu hình, ghi vào run và có thể kiểm tra lại.

### 4. Lưu đủ thông tin để giải thích và xem lại

- [ ] Lưu phiên bản policy/tokenizer, estimate, phần chừa cho output, giới hạn áp dụng và usage thật của provider.
- [ ] Với mỗi lần cắt/biến đổi, lưu loại thao tác, phần bị tác động, số token trước/sau và lượng tiết kiệm.
- [ ] Lưu digest của đúng context đã gửi để kiểm tra tính nhất quán mà không lưu lặp lại toàn bộ nội dung nhạy cảm.
- [ ] `view` và JSON readback cho biết context đã được chuẩn bị ra sao; không in raw secret hoặc ground-truth.
- [ ] Các run/event cũ không có telemetry context mới vẫn xem lại được.

### 5. Kiểm thử và xác nhận

- [ ] Kiểm tra cách đếm token, kích thước tool schema, output reserve và các trường hợp sát ngưỡng.
- [ ] Kiểm tra evidence được ghim không mất và cặp tool request/result không bị tách.
- [x] Kiểm tra secret/ground-truth đã được lọc trước khi shaping và không xuất hiện trong request/event/telemetry (secret synthetic, local temp fixture).
- [x] Kiểm tra context mandatory quá lớn dừng `budget_exhausted` với `terminalReason=context_budget`, không phát sinh provider call.
- [x] Chạy integration test offline từ disk snapshot qua tool đến gateway giả; xác nhận mỗi request digest khớp request gateway đã nhận và readback giữ cùng telemetry.
- [x] Chạy typecheck và các test liên quan. Protocol typecheck pass; core/CLI/workspace còn lỗi baseline `packages/core/src/tool/handlers/grep.ts` Worker `.once` (TS2339 ×3, TS7006 ×1). Không chạy test PostgreSQL.
- Offline evidence (2026-10-20): disk-chain e2e 3 pass / 27 assertions; focused core context/multi-turn set 51 pass; protocol 146 pass; CLI view 5 pass. `bun turbo typecheck` gặp đúng lỗi grep Worker đã biết; Task 6 test không còn type errors.
- [ ] Sau khi offline checks đạt, chạy một live snapshot run có giới hạn thời gian, token và chi phí; mở lại run từ process mới để xác nhận dữ liệu. Chưa chạy; cần quyết định/ủy quyền chi phí live riêng.
- [ ] Ghi run ID, model/provider, giới hạn, usage/cost và kết quả kiểm tra vào tài liệu sprint. Chưa có run live.

## Những gì chưa làm trong Sprint 6

- [ ] Chưa bật các cách ẩn kết quả cũ, thay read cũ bằng read mới hoặc bỏ kết quả rỗng nếu nhóm chưa duyệt chính sách tương ứng.
- [ ] Chưa nhờ LLM viết tóm tắt context trong sprint này. Nếu context không vừa, dừng rõ ràng; có thể chuẩn bị contract cho giai đoạn sau.
- [ ] Chưa làm session notes hoặc memory giữa các run; việc memory dùng dữ liệu train/test cần quyết định và ranh giới riêng.
- [ ] Chưa làm tìm kiếm/chọn source theo ngữ nghĩa, thay đổi Judge verdict hoặc chính sách retry của agent loop.

## Khi nào có thể đánh dấu hoàn tất?

- [ ] Nghiên cứu OpenCode và các quyết định dùng cho sprint đã được ghi lại, kể cả câu hỏi còn bỏ ngỏ.
- [ ] Luồng multi-turn thật dùng Context Engine trước mỗi provider call.
- [ ] Request quá giới hạn bị chặn trước khi gọi model; request hợp lệ là đúng prepared context.
- [ ] Tool output được lọc secret rồi mới giới hạn; source evidence và lịch sử gốc vẫn truy vết được.
- [ ] Có thể xem lại estimate, usage thật, các biến đổi, digest và lý do dừng.
- [ ] Offline tests đạt và có ít nhất một live run được lưu/xem lại; offline checks đạt, live run chưa được ủy quyền/thực hiện.

## Tài liệu liên quan

- [Kế hoạch triển khai chi tiết](sprint-06-for-agent.md)
- [Nghiên cứu Context & Memory của TV2](../tv2-context-research-and-plan.md)
- [Contract Context Engine của TV2](../tv2-context-engine-contract.md)
- [Lộ trình core](../core-team-timeline.md)
