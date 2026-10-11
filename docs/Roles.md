# Phân công nhóm Harness

Giai đoạn đầu, năm người tập trung xây nền core và một người phụ trách ứng dụng, tích hợp và demo. TV1 và TV5 cùng làm Agent Runtime; chia đầu việc theo từng sprint, cùng thống nhất thiết kế và review chéo.

Tài liệu này xác định trách nhiệm của từng nhóm. [Sprint 1](sprints/sprint-01.md) là nơi ghi đầu việc, quyết định và tình trạng thực tế; [roadmap nhóm](team-roadmap.md) mô tả các mốc sản phẩm. Ranh giới package theo [module layout](../blueprint/architecture/module-layout.md).

## Tổng quan

| Thành viên | Mảng phụ trách | Trách nhiệm chính |
|---|---|---|
| **TV1 + TV5** | Agent Runtime | Agent loop, kết nối model, vòng đời run, lưu trạng thái và sự kiện thực thi |
| **TV2** | Context | Chuẩn bị nội dung cho mỗi lượt model, quản lý giới hạn context và lịch sử |
| **TV3** | Tools & Skills | Source snapshot, bộ tool đọc, registry và hướng dẫn sử dụng tool/skill |
| **TV4** | Security & Verification | Kiểm soát quyền, bảo vệ dữ liệu, kiểm thử đối kháng và verification riêng về sau |
| **TV6** | Application & Demo | API, client, giao diện, desktop/CLI, tích hợp và kịch bản demo |

## TV1 + TV5 — Agent Runtime

Hai người cùng chịu trách nhiệm cho đường chạy từ khi core nhận yêu cầu Judge đến khi run có kết quả hoặc lý do dừng rõ ràng.

### Phạm vi

- Agent loop: yêu cầu TV2 chuẩn bị context, gọi model, nhận tool call, điều phối tool của TV3, nhận kết quả rồi tiếp tục hoặc dừng.
- Kết nối model qua package `llm`: request/response thống nhất, cấu hình provider, stream, lỗi và usage; tận dụng SDK và source tham chiếu phù hợp với quyết định kiến trúc hiện hành.
- Vòng đời run: tiếp nhận, lưu yêu cầu, giao việc cho worker, cập nhật trạng thái, xử lý hủy và ngăn xử lý trùng.
- Giới hạn thực thi: số bước, token, thời gian và chính sách retry; thống nhất với TV2 cách kiểm tra trước mỗi lượt gọi model.
- Kết quả Judge: giải mã và kiểm tra verdict cùng evidence, lưu kết quả với trạng thái `unverified` theo hợp đồng Judge.
- Lưu trạng thái và sự kiện runtime, cung cấp thao tác truy vấn cho TV6. Thiết kế rõ cách xử lý run bị gián đoạn, không tự gọi lại model nếu chưa xác định được kết quả lần gọi trước.
- Phân biệt lỗi tool có thể trả về model, lỗi provider, người dùng từ chối và yêu cầu hủy; không biến mọi lỗi thành lý do để model thử tiếp.

### Cách phối hợp

TV1 và TV5 không bị chia cố định thành người làm loop, database hay model. Đầu sprint, hai người chia các đầu việc có đầu ra cụ thể. Mỗi đầu việc ghi một người chịu trách nhiệm chính và người còn lại review.

Hai người cùng chốt contract trước khi triển khai: input/output của model, context, tool, trạng thái run và event. Các thành viên khác dùng contract đó để làm song song. Mỗi capability vẫn sở hữu dữ liệu và migration của mình; TV1 + TV5 không viết thay mọi phần persistence cho cả nhóm.

### Ưu tiên giai đoạn đầu

Phác một Judge run xuyên suốt, đề xuất trạng thái/điểm dừng và các hợp đồng cần ghép. Sau khi nhóm thống nhất, triển khai loop với model giả lập để thử được cả đường thành công, gọi tool, lỗi và hủy trước khi ghép provider thật.

## TV2 — Context

TV2 quyết định nội dung nào được đưa vào mỗi lượt gọi model và cách giữ request trong giới hạn cho phép.

### Phạm vi

- Ghép system instruction, finding, lịch sử hội thoại, tool result và mô tả tool thành context cho lượt tiếp theo.
- Phân bổ dung lượng cho từng phần và dự trữ chỗ cho output của model trước khi gửi request.
- Xác định cách xử lý khi context quá dài; cung cấp kết quả kiểm tra để runtime quyết định tiếp tục hoặc dừng.
- Phối hợp với TV3 về giới hạn tool output và cách giữ đường dẫn, số dòng, bằng chứng khi rút gọn nội dung.
- Cung cấp dữ liệu về lượng context, phần bị cắt và các phép biến đổi để runtime ghi trace.
- Nghiên cứu session notes, memory và compaction ở giai đoạn sau; mỗi cải tiến cần có cấu hình và cách quan sát tác động.

### Ưu tiên giai đoạn đầu

Liệt kê chính xác model thấy gì ở một lượt Judge; đưa ra một ví dụ đủ context và một ví dụ vượt giới hạn. Thống nhất đầu vào/đầu ra của bước chuẩn bị context với TV1 + TV5.

## TV3 — Tools & Skills

TV3 xây cách agent tiếp cận mã nguồn thông qua các thao tác có giới hạn và kết quả dễ hiểu.

### Phạm vi

- Đường đi từ repository người dùng chọn tới `SourceSnapshot` bất biến mà Judge được phép đọc; quản lý danh sách file, định danh phiên bản và cách truy cập file trong snapshot.
- Đề xuất bộ tool đọc tối thiểu, chẳng hạn `read_file`, `list_dir`, `glob` và tìm kiếm nội dung có số dòng.
- Định nghĩa tên, mô tả, input/output schema, giới hạn và lỗi của từng tool.
- Registry và dispatch: đăng ký tool, tìm đúng implementation và trả kết quả theo hợp đồng runtime.
- Giới hạn kích thước kết quả, thứ tự trả về và dấu hiệu nội dung bị cắt; phối hợp với TV2 để giữ đủ bằng chứng cho model.
- Tích hợp kiểm quyền do TV4 thiết kế tại đường thực thi và truy cập source, trước khi đọc nội dung.
- Phát triển skill khi bộ tool cơ bản đã dùng được: hướng dẫn cách khảo sát, bằng chứng cần tìm và điều kiện loại trừ một nghi vấn.

### Ưu tiên giai đoạn đầu

Phác repository → snapshot → tool đọc; phân biệt đường dẫn máy người dùng với đường dẫn trong snapshot. Chọn bộ tool đầu tiên, mô tả mỗi tool nhận gì, trả gì và khi nào phải từ chối. Skill chuyên sâu được đưa vào sprint khi nhóm có đủ nền tảng để dùng và kiểm tra nó.

## TV4 — Security & Verification

TV4 thiết kế và kiểm chứng các ràng buộc an toàn trên đường chạy của Harness, phối hợp với người sở hữu từng thành phần để thực thi chúng.

### Phạm vi giai đoạn đầu

- Phân biệt dữ liệu agent được thấy với ground truth, báo cáo chấm điểm và secret phải giữ riêng.
- Kiểm soát truy cập source: snapshot được cấp quyền, đường dẫn chuẩn hóa, traversal, symlink và truy cập ngoài phạm vi.
- Cùng TV3 đặt kiểm quyền ở đường truy cập thực tế; cùng TV1 + TV5 bảo vệ dữ liệu đi vào model, log và trace.
- Judge chỉ có tool đọc được cấp phép; không có quyền chạy shell, sửa source hoặc thực thi PoC.
- Đề xuất và xây các ca đối kháng chứng minh cơ chế bảo vệ hoạt động, gồm source chứa chỉ dẫn đánh lừa agent.
- Khảo sát sớm điều kiện build repository để nhận diện khó khăn của verification về sau.

### Verification về sau

Thiết kế `VerificationRunner` riêng với môi trường cô lập, giới hạn tài nguyên và vòng đời rõ ràng. Lưu cả bằng chứng thành công, thất bại và trường hợp chưa thể xác minh. Lỗi build hoặc lỗi hạ tầng không tự động chứng minh finding sai. Kết quả và chính sách retry cần được nhóm thống nhất trước khi triển khai.

### Ưu tiên giai đoạn đầu

Vẽ đường đi của finding, source, ground truth và secret; chỉ ra điểm kiểm soát trước khi agent nhìn thấy dữ liệu. Mang tới buổi chốt các tình huống được phép, bị từ chối và danh sách kiểm thử ưu tiên.

## TV6 — Application & Demo

TV6 xây cách người dùng gửi yêu cầu, theo dõi quá trình và xem kết quả; phụ trách ghép các thành phần thành luồng sử dụng được.

### Phạm vi

- API và client theo contract chung: nhận yêu cầu, kiểm tra dữ liệu ở biên, gọi public operation của core và trả trạng thái/kết quả an toàn.
- Giao diện gửi finding, chọn source, theo dõi run và xem verdict/evidence.
- Trace view hiển thị các lượt model/tool, thời gian, usage, lỗi và lý do dừng từ dữ liệu runtime cung cấp.
- Desktop, CLI và cơ chế kết nối runtime theo package boundary đã chốt.
- Tích hợp luồng xuyên hệ thống cùng TV1 + TV5; thao tác đóng/mở giao diện phải phù hợp với vòng đời runtime độc lập.
- Kịch bản demo và khả năng xem lại dữ liệu đã lưu khi không có mạng.

Core sở hữu trạng thái run và quyết định nghiệp vụ. TV6 không tạo agent loop trong API/giao diện hay truy vấn trực tiếp bảng riêng của capability để bỏ qua public operation.

### Ưu tiên giai đoạn đầu

Phác luồng desktop → API → worker → persistence → trace cùng TV1 + TV5. Đối chiếu package boundary, đề xuất API cần thiết và phác màn hình Judge đầu tiên.

## Phối hợp và bàn giao

| Bên phối hợp | Hợp đồng cần thống nhất |
|---|---|
| TV1 + TV5 ↔ TV2 | Dữ liệu chuẩn bị context, giới hạn, kết quả kiểm tra trước khi gọi model và telemetry |
| TV1 + TV5 ↔ TV3 | Tool definition, tool call/result, lỗi, hủy và định danh liên kết với run/step |
| TV3 ↔ TV4 | Quyền truy cập snapshot, kiểm tra trước I/O và ca kiểm thử vượt phạm vi |
| TV1 + TV5 ↔ TV4 | Ranh giới dữ liệu, quyền thực thi và ghi nhận các lần bị chặn |
| TV1 + TV5 ↔ TV6 | API tiếp nhận run, trạng thái, kết quả, hủy và event phục vụ trace |
| TV2 ↔ TV3 | Giới hạn output, nội dung model nhận và bảo toàn bằng chứng |

Khi ghi task trong sprint, mỗi task cần một người chịu trách nhiệm chính, đầu ra kiểm tra được và những người cần phối hợp. Với phần dùng lại từ OpenCode, ghi rõ source đã đọc, phần định tái sử dụng và điều cần điều chỉnh cho Harness trước khi ghép.

## Evaluation trong giai đoạn đầu

Chưa phân công một người chuyên trách Data & Evaluation; TV5 cùng TV1 xây Agent Runtime. Benchmark và phân tích thực nghiệm được phân công theo sprint khi nhóm bắt đầu làm các mốc đánh giá trong roadmap.

Ngay từ nền tảng, các phần runtime cần cung cấp dữ liệu để xem lại model request đã làm sạch, tool call/result, phiên bản cấu hình, usage, thời gian và lỗi. Việc lưu dữ liệu thuộc capability tương ứng, TV6 hiển thị qua API. Giữ ground truth ngoài agent và giữ cơ chế ghi nhận cấu hình để có thể thực hiện so sánh, ablation và tái lập thí nghiệm về sau.
