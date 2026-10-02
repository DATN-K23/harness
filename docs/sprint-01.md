# Sprint 1 — Chốt nền móng

[Kế hoạch toàn dự án](team-roadmap.md)

**Mục tiêu chung:** cả nhóm mô tả được một Judge run từ lúc nhận finding đến verdict, biết dữ liệu nào đi qua từng ranh giới và thống nhất phần việc có thể bắt đầu ở sprint sau.

**Phạm vi tuần này:** đọc, đối chiếu, đưa ra phương án và chốt quyết định. Mỗi người ghi ngắn những gì đã rõ, điều còn chưa rõ và đề xuất của mình ngay dưới phần việc tương ứng.

## TV1 — Luồng Judge và model

- [ ] Phác luồng một Judge run: nhận yêu cầu → worker → các lượt model/tool → verdict hoặc lý do dừng.
- [ ] Đề xuất những hợp đồng TV2, TV3, TV6 cần từ agent loop và provider; chỉ ra phần ADR-002 còn theo Python.

**Mang tới buổi chốt:** một sơ đồ luồng và danh sách đầu vào/đầu ra, lỗi, điểm dừng cần thống nhất.

## TV2 — Ngữ cảnh và giới hạn

- [ ] Liệt kê nội dung model thấy ở mỗi lượt và cách dành chỗ cho câu trả lời trước khi gọi model.
- [ ] Đề xuất các giới hạn cần có ngay cho Judge; đánh dấu memory và compaction để nghiên cứu sau.

**Mang tới buổi chốt:** ví dụ một lượt đủ context, một lượt vượt giới hạn và dữ liệu cần ghi vào trace.

## TV3 — Nguồn và công cụ

- [ ] Phác đường đi từ người dùng chọn repository tới `SourceSnapshot` mà Judge được phép đọc.
- [ ] Chọn bộ tool đọc tối thiểu cho Judge; mô tả ngắn tool nhận gì, trả gì và khi nào phải từ chối.

**Mang tới buổi chốt:** danh sách tool đầu tiên và ranh giới giữa đường dẫn máy người dùng với đường dẫn trong snapshot.

## TV4 — Ranh giới an toàn

- [ ] Vẽ đường đi của `CandidateFinding`, `SourceSnapshot`, ground truth và secret; chỉ ra nơi phải chặn trước khi agent nhìn thấy.
- [ ] Đề xuất các tình huống kiểm thử đối kháng đầu tiên; cùng TV5 chọn cách khảo sát sớm khả năng build repo cho PoC về sau.

**Mang tới buổi chốt:** các đường đi được phép/bị cấm và danh sách kiểm thử ưu tiên. Judge không nhận quyền chạy PoC.

## TV5 — Dữ liệu và phép so

- [ ] Phác cách so trực tiếp với Harness trên cùng model, cùng finding và cùng mã nguồn; nêu dữ liệu cần lưu để tính precision, recall, chi phí.
- [ ] Đề xuất tiêu chí chọn contest có finding đúng/sai, cách chia theo contest và nơi giữ nhãn chỉ dành cho scorer.

**Mang tới buổi chốt:** ví dụ một cặp ca so sánh và danh sách trường dữ liệu cần TV1/TV6 ghi từ run đầu tiên.

## TV6 — Ghép hệ thống và trải nghiệm

- [ ] Vẽ đường đi desktop → API → worker → PostgreSQL → trace; nêu việc gì vẫn chạy khi desktop đóng.
- [ ] Đối chiếu package, đường dẫn desktop, quyền sở hữu schema và trạng thái chọn stack giữa blueprint với OpenSpec.

**Mang tới buổi chốt:** sơ đồ các phần cần ghép, những quyết định tài liệu phải sửa và phác màn hình Judge đầu tiên.

## Cả nhóm chốt vào cuối sprint

- [ ] Chốt đầu vào/đầu ra của Judge run, provider, context, source tool và event; xác nhận TV1–TV6 đều dùng cùng tên và cùng nghĩa.
- [ ] Chốt đường đi an toàn của source và ground truth; ghi rõ các quyền Judge tuyệt đối không có.
- [ ] Chốt một luồng Judge giả lập sẽ làm ở sprint sau và cách cả nhóm kiểm tra nó chạy xuyên suốt.
- [ ] Ghi quyết định đã đạt, câu hỏi còn mở, người phụ trách tìm câu trả lời và bằng chứng đọc/kiểm tra được.

**Kết quả sprint:** một bản thống nhất đủ rõ để chia việc triển khai Judge giả lập. Các quyết định và câu hỏi còn mở được ghi ngay trong file này; chưa coi một lựa chọn chưa được nhóm duyệt là đã chốt.

**Đã chốt:** …

**Còn mở (ai tìm câu trả lời):** …

**Bằng chứng chung:** …
