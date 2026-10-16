# Sprint 3 — Source thật, tools và tool calling

[Lộ trình core](../core-team-timeline.md) · [Sprint 2](sprint-02.md)

**Mục tiêu chung:** đăng ký repository → tạo snapshot → model thật yêu cầu đọc/tìm source → runtime chạy tool → model nhận kết quả và trả lời. Lưu được cả luồng vào PostgreSQL và xem lại sau khi khởi động lại chương trình.

**Phạm vi:** gộp công việc sprint 3, 4 và 5 trong lộ trình cũ, đồng thời bổ sung phần còn thiếu của sprint 2. Làm chuỗi model–tool ngắn có giới hạn, tạo nền cho context và agent loop ở các chặng tiếp theo. Workflow Judge/Audit hoàn chỉnh, memory/compaction và Verification tiếp tục ở các chặng sau.

A–D là bốn người code, leader sẽ gán thành viên cho sprint này. Research tiếp tục nghiên cứu pipeline Judge và Audit đến chặng agent loop. Cả nhóm đọc và dùng lại phần code phù hợp đã có, kiểm tra phần nào đã nối vào source, model và DB thật.

## A — Repository và snapshot

- [ ] Tìm hiểu cách chuyển repository thành snapshot: một bản source cố định mà run dùng để phân tích, có mã riêng và danh sách file để tra cứu.
- [ ] Làm thao tác đăng ký repository và tạo snapshot. Chốt file nào được nhập; giữ secret, nhãn đáp án và dữ liệu chấm điểm ngoài vùng agent được đọc.
- [ ] Cung cấp cách liệt kê và đọc file theo snapshot ID. Kiểm tra quyền trước khi đọc; chặn đường dẫn đi ra ngoài snapshot và symlink vượt phạm vi.
- [ ] Bảo đảm sửa repository gốc không làm đổi snapshot đã tạo. Lưu thông tin để sau khi mở lại chương trình vẫn đọc đúng snapshot; xử lý tạo dở dang, snapshot không tồn tại và việc dọn dữ liệu còn được run sử dụng.

**Đầu ra:** repository thật được nhập thành snapshot cố định; run và tools truy cập source bằng snapshot ID cùng đường dẫn tương đối.

**Phối hợp:** B dùng thao tác đọc/liệt kê của A; C nối đăng ký và chọn snapshot vào CLI. A cùng D thống nhất cách lưu thông tin và liên kết snapshot với run. Đường dẫn gốc trên máy chỉ dùng lúc đăng ký, không đi vào request model hoặc trace.

## B — Bộ tool đọc source

- [ ] Tìm hiểu cách mô tả tool cho model, kiểm tra tham số và chọn đúng hàm thực thi. Đối chiếu registry/handler hiện có với thao tác đọc snapshot của A.
- [ ] Hoàn thiện bốn tool trên snapshot thật: `read_file` đọc file, `list_dir` liệt kê thư mục, `glob` tìm đường dẫn theo mẫu và `grep` tìm nội dung.
- [ ] Kiểm tra tham số và quyền trước khi chạy; trả lỗi rõ ràng khi tool không tồn tại, file thiếu, đường dẫn bị chặn hoặc hết thời gian.
- [ ] Giới hạn dung lượng đọc, số kết quả và thời gian tìm kiếm; đánh dấu khi kết quả bị cắt. Kết quả giữ snapshot, đường dẫn và dòng nguồn để truy ngược; nội dung source được xử lý như dữ liệu không đáng tin và không làm lộ secret.

**Đầu ra:** bốn tool đọc/tìm kiếm source thật, có giới hạn và cấu trúc kết quả/lỗi thống nhất. Bộ tool của sprint này chỉ có quyền đọc.

**Phối hợp:** A cung cấp source; B cung cấp mô tả tool và cách gọi cho C/D. C quyết định lúc chạy tool; D chuyển mô tả tool sang định dạng API model.

## C — Runner và CLI tích hợp

- [ ] Tìm hiểu luồng runner hiện tại và cách đưa kết quả tool vào lịch sử cho lần gọi model tiếp theo. Giữ luồng gọi model một lượt để dùng làm baseline.
- [ ] Nối CLI đăng ký repository, chọn snapshot và chạy prompt. Chuẩn bị thông tin source ban đầu có giới hạn để model biết phạm vi được đọc.
- [ ] Mở rộng runner: gọi model → ghi yêu cầu tool → chạy tool của B → ghi kết quả/lỗi → gửi lại model → nhận phản hồi. Mỗi kết quả phải gắn đúng với lời gọi tool tương ứng.
- [ ] Đặt giới hạn số lượt model, số tool call và tổng thời gian; kiểm tra trước thao tác tiếp theo, dừng với lý do rõ ràng khi hết mức.
- [ ] Nối thao tác lưu attempt của D vào trước/sau mỗi lần gọi model; truyền giới hạn output từ cấu hình tới gateway. Xử lý lỗi lưu dữ liệu hoặc mất quyền cập nhật run, tránh tiếp tục chạy hay báo hoàn thành khi dữ liệu chưa được ghi thành công.
- [ ] Mở rộng lệnh xem run để đọc lại snapshot, từng lần gọi model, tool request/result và lý do dừng từ DB sau khi mở lại chương trình.

**Đầu ra:** chạy được cả chuỗi source → model → tool → model, có giới hạn và lịch sử xem lại được.

**Phối hợp:** C ghép các phần A/B/D tại CLI và runner, chủ trì chạy tích hợp. Mỗi người cùng xử lý lỗi thuộc phần mình khi ghép.

## D — Giao tiếp model và lưu từng attempt

- [ ] Tìm hiểu tool calling của provider đã chọn: gửi danh sách tool, nhận yêu cầu gọi tool và gửi kết quả về model ở lượt tiếp theo.
- [ ] Mở rộng gateway để nhận mô tả tool, lịch sử và giới hạn output. Trả rõ model đang trả lời, yêu cầu tool, bị cắt do giới hạn hay gặp lỗi; gateway chuyển đổi dữ liệu, runner của C điều phối việc thực thi.
- [ ] Hoàn thiện việc lưu/đọc từng attempt — mỗi lần gọi API model. Ghi dấu vết trước khi gọi, bổ sung kết quả hoặc lỗi sau khi gọi; thể hiện được lần gọi chưa rõ kết quả nếu chương trình gián đoạn.
- [ ] Dùng lại bảng `model_attempts` và phần lưu trữ đã có; bổ sung dữ liệu/migration cần thiết. Lưu request/response đã loại secret, model, usage, thời gian và chi phí; thiếu usage/chi phí thì ghi rõ chưa xác định.
- [ ] Truyền giới hạn output vào tham số SDK/API thật ở mọi lượt. Giữ timeout, phân loại lỗi và tắt retry ngầm của SDK; đối chiếu dấu kiểm tra dữ liệu với đúng nội dung cuối cùng được lưu.

**Đầu ra:** model thật nhận được danh sách tool và giới hạn output; từng lần gọi có bản ghi để tra cứu, kể cả khi lỗi hoặc gián đoạn.

**Phối hợp:** D cùng C chốt request/response và thời điểm lưu attempt. D phụ trách gateway và lưu attempt, C chịu trách nhiệm gọi các thao tác này trong runner; A phối hợp phần lưu snapshot.

## Bổ sung phần còn thiếu của Sprint 2

- [ ] **Lưu attempt từ runner — D chủ trì, C phối hợp:** nối thao tác lưu vào luồng thật để mỗi lần gọi API có bản ghi tương ứng trong `model_attempts`, đọc lại được theo run.
- [ ] **Truyền giới hạn output — D chủ trì, C phối hợp:** nối đủ đường cấu hình → CLI → runner → gateway → API provider; kiểm tra giá trị thực sự có trong request gửi đi.
- [ ] **Usage/chi phí — D cùng C:** sửa cách lưu và hiển thị để phân biệt chưa xác định với chi phí bằng 0.
- [ ] **Các điểm cần xác minh thêm — C cùng D:** kiểm tra ghi trạng thái/event nhất quán, xử lý cập nhật bị từ chối, lọc secret và dấu kiểm tra dữ liệu. Sửa các lỗi xác nhận được trong luồng tích hợp.
- [ ] **Bằng chứng chạy thật — cả nhóm:** bổ sung lượt gọi model thành công và đọc lại dữ liệu từ tiến trình mới. Kết quả test cần ghi rõ phần DB nào đã chạy, phần nào bị bỏ qua.

## Cả nhóm thống nhất trước khi code riêng

- [ ] Chọn provider/model có quota và hỗ trợ tool calling; chốt ngân sách, giới hạn output, số lượt, số tool call và thời gian chạy. Nếu chọn Gemini, tính rõ phần adapter cần bổ sung cho D.
- [ ] Chọn repository Solidity nhỏ để ghép thử; giữ đáp án và dữ liệu đánh giá ngoài snapshot agent đọc được.
- [ ] Chốt bốn chỗ giao tiếp bằng ví dụ thành công và lỗi: source của A → B/C; tool của B → C; runner của C → gateway của D; runner của C → lưu trữ của D. Thống nhất tên hàm, dữ liệu và mã liên kết run/snapshot/attempt/tool call.
- [ ] Chốt vị trí đặt code và người sửa contracts/migration chung. Đối chiếu khác biệt giữa blueprint mới và code hiện có; việc chuyển toàn bộ package cần được tính thành phạm vi riêng nếu nhóm chọn thực hiện.

**Cách làm song song:** sau khi chốt giao tiếp, A làm snapshot, B làm tools, C làm điều phối và CLI, D làm gateway/lưu attempt. Mỗi người kiểm thử phần mình; dùng dữ liệu kiểm thử để làm độc lập và ghép bằng source, provider, DB thật trong sprint.

**Ghép sớm:** A/B/C nối đăng ký repository và đọc file qua tool; C/D nối một lượt model thật có giới hạn output và lưu attempt để khép hai thiếu sót Sprint 2. Tiếp đó ghép model tự yêu cầu `read_file`, nhận kết quả và trả lời; mở rộng sang các tool còn lại cùng ca lỗi.

**Review chéo:** A/B kiểm tra snapshot và quyền đọc; C/D kiểm tra luồng model và lưu trữ. Khi snapshot ổn định, A hỗ trợ phần lưu/đọc lại dữ liệu, B hỗ trợ ca tool calling để chia tải tích hợp cho C/D.

**Kết quả cần đạt:** chuỗi thật chạy được và xem lại sau restart; sửa source gốc không đổi snapshot; giới hạn có hiệu lực; lỗi tool/provider/DB giải thích được qua lịch sử. Các ca vượt quyền, file thiếu/lớn và dữ liệu nhạy cảm được kiểm tra trước khi coi sprint hoàn thành.

## Research

- [ ] Nghiên cứu source và bằng chứng mà pipeline Judge/Audit cần đọc.
- [ ] Nghiên cứu cách dùng bốn tool, xử lý lỗi và trường hợp chưa đủ bằng chứng.
- [ ] Nghiên cứu context và điều kiện dừng qua trace của luồng model–tool thật.
