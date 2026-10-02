# Roadmap nhóm Harness

> Bản đồ từ lúc khởi động đến khi bàn giao. Đi theo **kết quả có thể demo**, không gắn ngày hay số sprint.
> Mỗi sprint kéo dài một tuần. Đầu tuần nhóm chọn một mục tiêu chung rồi chia task trong file sprint riêng.
> Các mốc thể hiện phụ thuộc chính; việc chuẩn bị có thể chạy song song.

## Đích đến

- **Sản phẩm:** Judge chấm finding; Audit tự tìm finding. Cả hai đọc `SourceSnapshot` bất biến và có trace xem lại được.
- **Nghiên cứu:** RQ1 so cùng model khi gọi trực tiếp và qua Harness; RQ2 so với công cụ hiện có trên cùng bài toán; RQ3 kiểm tra trên ít nhất ba provider thật. Báo cáo precision, recall, chi phí và biến thiên giữa các lần chạy.
- **Bàn giao:** ứng dụng desktop chạy cục bộ, kết quả nghiên cứu có thể kiểm tra lại, demo offline và báo cáo bảo vệ.

## Cách dùng

- Mỗi mốc là một **kết quả cần chứng minh**, không phải một tuần làm việc hay danh sách việc của từng người.
- Đầu sprint, chọn việc giúp tiến gần mốc tiếp theo; ghi người phụ trách, kết quả cần thấy và cách kiểm tra trong file sprint.
- Cuối sprint, demo, lưu bằng chứng và quyết định việc tiếp theo. Mốc chỉ đạt khi điều kiện hoàn thành được chứng minh; task dở được xem lại trước khi đưa sang sprint mới.
- Khi phát hiện giả định sai, cập nhật roadmap và lý do. Không khóa thứ tự của những việc độc lập.

## Các mốc demo

### 0. Chốt nền móng

**Demo:** cả nhóm giải thích được một Judge run, dữ liệu đi qua từng ranh giới và cách ghép các phần.

**Đạt khi:** thống nhất hợp đồng đầu vào/đầu ra, ranh giới ground truth và source, dữ liệu trace cần lưu; ghi quyết định và câu hỏi còn mở. Đối chiếu tài liệu cũ với ADR-008 trước khi dùng để triển khai.

**Chuẩn bị song song:** thử khả năng build repo cho PoC; phác giao thức direct/Harness, corpus và ngân sách; thử đường đi desktop → runtime → PostgreSQL.

### 1. Judge giả lập chạy xuyên suốt

**Demo:** gửi một finding, agent đọc snapshot, trả verdict có cấu trúc và xem lại được trace.

**Đạt khi:** run giả lập đi qua API, worker, tool đọc, database và giao diện; lỗi hoặc hết budget tạo trạng thái rõ ràng; kiểm thử chứng minh agent không đọc được ground truth hay ngoài snapshot.

**Chuẩn bị song song:** chọn các ca đúng/sai đầu tiên, trường dữ liệu cần chấm điểm và cách lưu phiên bản prompt, tool, profile, flag.

### 2. Judge chạy với provider thật

**Demo:** cùng luồng Judge chạy với một provider thật; đóng giao diện hoặc khởi động lại vẫn xem được run.

**Đạt khi:** profile, giá và ngân sách được duyệt trước khi gọi; từng attempt, token, chi phí và lỗi được lưu; trạng thái run và trace khôi phục được sau gián đoạn.

**Chuẩn bị song song:** thử nhánh gọi trực tiếp trên cùng model và dữ liệu; khảo sát provider tiếp theo; thử đóng gói desktop với runtime độc lập.

### 3. Đo RQ1 trên cùng bài toán

**Demo:** chạy direct/Harness trên cùng tập finding, model và snapshot; xuất bảng precision, recall, chi phí liên kết về từng run.

**Đạt khi:** corpus và cách chia theo contest có manifest phiên bản; scorer giữ nhãn ngoài agent; chốt quy tắc ghép cặp, số lần lặp, cách tính precision, recall, chi phí và biến thiên. Người khác chạy lại được quy trình và kiểm tra dữ liệu gốc.

**Chuẩn bị song song:** ghi các lỗi chất lượng để chọn cải tiến; lên kế hoạch ablation; chuẩn bị thêm provider và đối chứng RQ2 mà chưa trộn loại bài toán.

### 4. Cải thiện và đo đóng góp

**Demo:** bật/tắt từng cải tiến rồi xem chất lượng, chi phí và trace thay đổi thế nào.

**Đạt khi:** mỗi hành vi ảnh hưởng kết quả có flag, telemetry và giá trị lưu trong run; thử nghiệm ablation có cùng giao thức đo; phân tích được ít nhất các nhóm false positive, false negative và chi phí.

**Chuẩn bị song song:** khảo sát tỷ lệ repo build được, cách chạy PoC cô lập và giới hạn của VerificationRunner; chuẩn bị luồng Audit tự tìm finding.

### 5. Xác minh finding bằng PoC

**Demo:** `VerificationRunner` riêng chạy PoC và hiển thị ba trạng thái: xác minh được, bị bác bỏ, chưa xác minh.

**Đạt khi:** Judge vẫn không có quyền thực thi; runner cô lập, giới hạn tài nguyên và không có mạng; lưu cả PoC pass/fail/unverified cùng bằng chứng; đo tác động lên kết quả đánh giá.

**Chuẩn bị song song:** kiểm tra runner trên nhiều repo để biết phạm vi áp dụng; chuẩn bị cách đưa finding của Audit qua bước xác minh mà không đổi ranh giới của Judge.

### 6. Audit tự tìm finding

**Demo:** chọn một snapshot, Audit tự khảo sát repository và xuất báo cáo finding có bằng chứng mã nguồn và trace.

**Đạt khi:** Audit dùng cùng nền runtime nhưng có workflow và cách chấm riêng; chỉ đọc trong snapshot; PoC, nếu có, đi qua `VerificationRunner`. Kết quả Judge và Audit được phân biệt rõ trong dữ liệu và giao diện.

**Chuẩn bị song song:** chốt bài toán chung và quy tắc so khớp finding cho RQ2; hoàn thiện đối chứng static analyzer và agent đa dụng trên tập đánh giá tương ứng.

### 7. Hoàn tất đánh giá mở rộng

**Demo:** xem kết quả Harness, đối chứng và các provider theo cùng giao thức; truy ngược mỗi con số về run gốc.

**Đạt khi:** RQ2 so trên cùng loại bài toán, cùng tập ca và quy tắc chấm đã chốt; RQ3 có ít nhất ba provider thật; báo cáo riêng kết quả theo contest, cutoff, lần lặp, chi phí và các trường hợp chạy lỗi. Không trộn kết quả Judge với Audit.

**Chuẩn bị song song:** khóa corpus, profile, prompt, tool và cấu hình dùng cho kết quả chính thức; diễn tập xuất dữ liệu, phục hồi run và demo offline.

### 8. Bàn giao và bảo vệ

**Demo:** người khác cài và kiểm tra hệ thống trên máy sạch; bài demo offline mở được run, trace và kết quả nghiên cứu đã lưu.

**Đạt khi:** kết quả RQ1–RQ3 có dữ liệu và giới hạn được ghi rõ; kiểm thử an toàn và hướng dẫn cài đặt đạt; desktop, runtime và PostgreSQL hoạt động theo ranh giới đã chốt; nhóm diễn tập được kịch bản bảo vệ.

## Điều giữ ở mọi mốc

- Agent chỉ thấy `CandidateFinding` và `SourceSnapshot`; ground truth và nhãn chỉ ở scorer. Chứng minh ranh giới bằng kiểm thử.
- Chia dữ liệu theo **toàn contest**, giữ manifest phiên bản và báo cáo khả năng model đã biết dữ liệu trước cutoff.
- Hành vi tùy chọn ảnh hưởng kết quả có flag, telemetry, giá trị lưu trong run và kiểm thử bật/tắt. Ranh giới an toàn không có nút tắt.
- Lưu đúng nội dung đã khử nhạy cảm mà model nhìn thấy cùng prompt/profile, tool call, token, thời gian và chi phí. Tái lập đầu vào và quy trình; không hứa LLM ngẫu nhiên trả cùng từng byte.
- Judge chỉ có tool đọc trong snapshot. PoC thuộc `VerificationRunner` riêng; verdict Judge trước bước đó là `unverified`.
- PostgreSQL giữ trạng thái có thẩm quyền; desktop điều khiển qua API cục bộ. Đóng desktop không làm mất run.
