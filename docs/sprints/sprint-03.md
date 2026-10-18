# Sprint 3 — Source thật, tools và tool calling

[Lộ trình core](../core-team-timeline.md) · [Sprint 2](sprint-02.md)

**Mục tiêu chung:** đăng ký repository → tạo snapshot → model thật yêu cầu đọc/tìm source → runtime chạy tool → model nhận kết quả và trả lời. Lưu được cả luồng vào PostgreSQL và xem lại sau khi khởi động lại chương trình.

**Phạm vi:** gộp công việc sprint 3, 4 và 5 trong lộ trình cũ, đồng thời bổ sung phần còn thiếu của sprint 2. Làm chuỗi model–tool ngắn có giới hạn, tạo nền cho context và agent loop ở các chặng tiếp theo. Workflow Judge/Audit hoàn chỉnh, memory/compaction và Verification tiếp tục ở các chặng sau.

A–D là bốn người code, leader sẽ gán thành viên cho sprint này. Research tiếp tục nghiên cứu pipeline Judge và Audit đến chặng agent loop. Cả nhóm đọc và dùng lại phần code phù hợp đã có, kiểm tra phần nào đã nối vào source, model và DB thật.

## A — Repository và snapshot

- [x] Tìm hiểu cách chuyển repository thành snapshot: một bản source cố định mà run dùng để phân tích, có mã riêng và danh sách file để tra cứu.
- [x] Làm thao tác đăng ký repository và tạo snapshot. Chốt file nào được nhập; giữ secret, nhãn đáp án và dữ liệu chấm điểm ngoài vùng agent được đọc.
- [x] Cung cấp cách liệt kê và đọc file theo snapshot ID. Kiểm tra quyền trước khi đọc; chặn đường dẫn đi ra ngoài snapshot và symlink vượt phạm vi.
- [x] Bảo đảm sửa repository gốc không làm đổi snapshot đã tạo. Lưu thông tin để sau khi mở lại chương trình vẫn đọc đúng snapshot; xử lý tạo dở dang, snapshot không tồn tại và việc dọn dữ liệu còn được run sử dụng.

**Đầu ra:** repository thật được nhập thành snapshot cố định; run và tools truy cập source bằng snapshot ID cùng đường dẫn tương đối.

**Phối hợp:** B dùng thao tác đọc/liệt kê của A; D nối đăng ký và chọn snapshot vào CLI. A phụ trách lưu metadata snapshot, cùng C thống nhất liên kết snapshot với run. Đường dẫn gốc trên máy chỉ dùng lúc đăng ký, không đi vào request model hoặc trace.

**Sau review 18/10 (change `harden-snapshot-tools-runner`):** snapshot ID được kiểm tra và giữ trong thư mục lưu; ID theo nội dung, ghi-một-lần, kiểm tra digest khi đọc; chặn `.git`/`node_modules`/ground truth ở mọi cấp, không phân biệt hoa thường; bỏ qua symlink; giới hạn kích thước; chỉ xoá snapshot khi không còn run dùng. Còn mở: khảo sát ~10 repo contest (task 2.3).

## B — Bộ tool đọc source

- [x] Định nghĩa mỗi tool bằng tên, mô tả, tham số được nhận và hàm thực thi; cung cấp qua registry để C lấy danh sách tool được phép dùng. Đối chiếu registry/handler hiện có với thao tác đọc snapshot của A.
- [x] Hoàn thiện bốn tool trên snapshot thật: `read_file` đọc file, `list_dir` liệt kê thư mục, `glob` tìm đường dẫn theo mẫu và `grep` tìm nội dung.
- [x] Kiểm tra tham số và quyền trước khi chạy; trả lỗi rõ ràng khi tool không tồn tại, file thiếu, đường dẫn bị chặn hoặc hết thời gian.
- [x] Giới hạn dung lượng đọc, số kết quả và thời gian tìm kiếm; đánh dấu khi kết quả bị cắt. Kết quả giữ snapshot, đường dẫn và dòng nguồn để truy ngược; nội dung source được xử lý như dữ liệu không đáng tin và không làm lộ secret.

**Đầu ra:** bốn tool đọc/tìm kiếm source thật, có giới hạn và cấu trúc kết quả/lỗi thống nhất. Bộ tool của sprint này chỉ có quyền đọc.

**Phối hợp:** A cung cấp source; B cung cấp mô tả tool và cách gọi cho C/D. C quyết định lúc chạy tool; D chuyển mô tả tool sang định dạng API model.

**Sau review 18/10 (change `harden-snapshot-tools-runner`):** registry luôn áp chính sách chặn mặc định; lỗi không lộ đường dẫn máy chủ; `read_file` luôn đánh dấu khi bị cắt và báo đúng khoảng dòng; `grep` chạy trong worker có timeout và giới hạn quét; giới hạn `glob`/`grep` tách riêng. Còn mở: đo `grep` trên 3 repo Solidity để chốt mặc định (task 3.5).

## C — Runner và lịch sử thực thi

- [x] Tìm hiểu luồng runner hiện tại và cách đưa kết quả tool vào lịch sử cho lần gọi model tiếp theo. Giữ luồng gọi model một lượt để dùng làm baseline.
- [x] Cung cấp thao tác chạy với prompt, snapshot ID và giới hạn để D nối CLI. Chuẩn bị thông tin source ban đầu có giới hạn để model biết phạm vi được đọc.
- [x] Chuẩn bị request tối thiểu cho từng lượt: instruction, prompt, thông tin source, lịch sử model/tool và danh sách tool được phép dùng lấy từ B. Ghép theo cấu trúc chung của Harness để gửi qua gateway của D; phần này làm cơ sở tách context ở chặng sau.
- [x] Mở rộng runner: gọi model → ghi yêu cầu tool → chạy tool của B → ghi kết quả/lỗi → gửi lại model → nhận phản hồi. Mỗi kết quả phải gắn đúng với lời gọi tool tương ứng.
- [x] Đặt giới hạn số lượt model, số tool call và tổng thời gian; kiểm tra trước thao tác tiếp theo, dừng với lý do rõ ràng khi hết mức.
- [x] Dùng lại phần lưu attempts thành viên đã bổ sung, nối vào chuỗi nhiều lượt và kiểm tra mỗi lần gọi có bản ghi đúng, không ghi trùng. Đã bổ sung maxOutputTokens vào ModelAttemptRequest; xử lý lỗi lưu dữ liệu và mất quyền cập nhật run trước khi thực hiện thao tác tiếp theo (phần mapping output limit sang tham số SDK thuộc Track D).
- [x] Hoàn thiện lưu/đọc lịch sử nhiều lượt qua context.item_added và getMultiTurnExecutionSummary: liên kết run, snapshot, attempt, tool request/result và lý do dừng hợp lệ theo đúng thứ tự (phần hiển thị qua CLI thuộc Track D).

**Đầu ra:** chạy được cả chuỗi source → model → tool → model, có giới hạn và lịch sử xem lại được.

**Phối hợp:** C sở hữu runner, trạng thái và lịch sử thực thi; D sở hữu CLI và gateway. C chốt thao tác chạy/xem cùng ví dụ dữ liệu sớm để D làm song song. C/D cùng ghép luồng thật, mỗi người xử lý lỗi thuộc phần mình.

**Sau review 18/10 (change `harden-snapshot-tools-runner`):** bộ lọc hai mức (không sửa nội dung source, chỉ che credential); runner bị ràng buộc đúng snapshot của registry và kiểm tra khi resume; kiểm tra ngân sách sau mỗi phản hồi và trước mỗi lần gọi; khôi phục thời gian/số tool call khi resume; thứ tự ghi kết quả tool và attempt an toàn khi crash; phân loại lỗi provider tạm thời/vĩnh viễn; `execute` không bao giờ reject; có test đầu-cuối snapshot đĩa → registry → runner.

## D — Chuyển đổi request/response của provider và CLI

- [ ] Tìm hiểu định dạng API tool calling của provider: cách biểu diễn message, định nghĩa tool, yêu cầu gọi tool và kết quả tool.
- [ ] Nhận request đã được C chuẩn bị theo cấu trúc chung của Harness, chuyển messages, tool definitions và giới hạn output sang đúng trường SDK/API rồi gửi đi. Giữ đúng nội dung, thứ tự lịch sử và mã liên kết lời gọi/kết quả tool.
- [ ] Chuyển response của provider về cấu trúc chung cho C: text trả lời, tool call ID, tên tool, arguments, usage và lý do kết thúc. Phân biệt yêu cầu tool, trả lời hoàn tất, bị cắt do giới hạn và lỗi; báo dữ liệu không hợp lệ để C xử lý.
- [ ] Hoàn thiện cấu hình provider, key và model; kiểm tra tool calling thực tế. Trả thông tin model, usage và lỗi theo cấu trúc chung để C lưu vào lịch sử.
- [ ] Nối CLI đăng ký repository qua A, chọn snapshot và chạy prompt qua C. Kiểm tra cấu hình thiếu/sai, cung cấp lệnh và cấu hình mẫu để các máy dùng cùng một luồng.
- [ ] Mở rộng lệnh xem run từ dữ liệu C cung cấp: snapshot, từng lượt model, tool đã gọi, kết quả/lỗi và lý do dừng. Hiển thị usage/chi phí chưa xác định rõ ràng; đọc lại được từ tiến trình mới.
- [ ] Truyền giới hạn output vào tham số SDK/API thật ở mọi lượt. Giữ timeout, phân loại lỗi và tắt retry ngầm của SDK; đối chiếu dấu kiểm tra dữ liệu với đúng nội dung cuối cùng được lưu.
- [ ] Chuẩn bị hướng dẫn chạy và ca tích hợp cho gateway/CLI: model gọi tool rồi trả lời, cấu hình sai, lỗi provider và hết thời gian. Cùng C đối chiếu phản hồi gateway với attempts và lịch sử đã lưu.

**Đầu ra:** gateway hỗ trợ tool calling thật và bộ lệnh đăng ký source → chạy → xem lại dùng được; cấu hình, giới hạn và lỗi có thể kiểm tra xuyên suốt từ CLI tới provider.

**Phối hợp:** D dùng thao tác đăng ký source của A, mô tả tool của B và thao tác chạy/xem của C. D sở hữu CLI/composition và gateway; C sở hữu điều phối và lưu lịch sử. D trả usage/model/error đã chuẩn hóa để C lưu đúng.

## Phân biệt tools, chuẩn bị context và gateway

| Phần | Trách nhiệm | Ví dụ với `read_file` |
|---|---|---|
| **B — Tools** | Định nghĩa tool làm được gì, nhận tham số gì và thực thi ra sao | Viết mô tả/schema của `read_file` và hàm đọc file qua snapshot của A |
| **C — Chuẩn bị request trong Sprint 3** | Ghép nội dung model được thấy ở lượt hiện tại theo cấu hình và quyền đã chốt | Đưa định nghĩa `read_file` vào request; ở lượt sau ghép lời gọi tool cùng nội dung/lỗi trả về vào lịch sử |
| **D — Gateway** | Chuyển request chung sang định dạng provider và chuyển response về định dạng chung | Ánh xạ định nghĩa sang trường tools của API, giữ call ID khi gửi kết quả; giải mã tool call trả về cho C |
| **Context ở chặng sau** | Tách việc chuẩn bị request thành thành phần riêng, quản lý ngân sách context, lựa chọn lịch sử và xử lý vượt giới hạn | Quyết định phần source/history nào được đưa vào lượt tiếp theo và dành chỗ cho output theo chính sách đã chốt |

**Ví dụ cả luồng:** B cung cấp định nghĩa `read_file` → C ghép request → D chuyển định dạng và gọi API → model yêu cầu đọc một file → D trả tool call về C → C kiểm tra và gọi tool của B → C ghi kết quả, ghép request tiếp theo → D gửi request đó tới provider.

Việc chọn source, lịch sử và tool được đưa vào request thuộc bước chuẩn bị request/context. Việc quyết định chạy tool hay dừng thuộc runner. D phụ trách biểu diễn đúng những dữ liệu đó theo API của provider; B thực thi tool và kiểm tra quyền trước khi đọc.

## Cập nhật phần chuyển tiếp từ Sprint 2

**Attempts:** theo cập nhật của leader, thành viên đã bổ sung phần này. Sprint 3 dùng lại implementation đó; cần xác định commit/nhánh chứa thay đổi khi ghép, không phân công làm mới chức năng lưu attempt. Việc kiểm tra dưới đây tập trung vào chuỗi model–tool nhiều lượt.

- [ ] **Tích hợp attempts đã có — C chủ trì, D phối hợp:** ghép bản bổ sung, kiểm tra mỗi lần gọi trong chuỗi nhiều lượt có bản ghi tương ứng, đọc lại được và không ghi trùng; kiểm tra cả lỗi và gián đoạn.
- [ ] **Truyền giới hạn output — D chủ trì, C phối hợp:** nối đủ đường cấu hình → CLI → runner → gateway → API provider; kiểm tra giá trị thực sự có trong request gửi đi.
- [ ] **Usage/chi phí — D cùng C:** sửa cách lưu và hiển thị để phân biệt chưa xác định với chi phí bằng 0.
- [ ] **Các điểm cần xác minh thêm — C cùng D:** kiểm tra ghi trạng thái/event nhất quán, xử lý cập nhật bị từ chối, lọc secret và dấu kiểm tra dữ liệu. Sửa các lỗi xác nhận được trong luồng tích hợp.
- [ ] **Bằng chứng chạy thật — cả nhóm:** bổ sung lượt gọi model thành công và đọc lại dữ liệu từ tiến trình mới. Kết quả test cần ghi rõ phần DB nào đã chạy, phần nào bị bỏ qua.

## Cả nhóm thống nhất trước khi code riêng

- [ ] Chọn provider/model có quota và hỗ trợ tool calling; chốt ngân sách, giới hạn output, số lượt, số tool call và thời gian chạy. D phụ trách tích hợp provider đã chọn.
- [ ] Chọn repository Solidity nhỏ để ghép thử; giữ đáp án và dữ liệu đánh giá ngoài snapshot agent đọc được.
- [ ] Chốt giao tiếp bằng ví dụ thành công và lỗi: source của A → tools/runner/CLI; tool của B → runner của C; runner của C → gateway của D; CLI của D → thao tác chạy/xem của C. C đối chiếu contract lưu trữ và attempts đã có; cả nhóm thống nhất mã liên kết run/snapshot/attempt/tool call.
- [ ] Chốt vị trí đặt code và người sửa contracts/migration chung. Đối chiếu khác biệt giữa blueprint mới và code hiện có; việc chuyển toàn bộ package cần được tính thành phạm vi riêng nếu nhóm chọn thực hiện.

**Cách làm song song:** sau khi chốt giao tiếp, A làm snapshot, B làm tools, C làm runner/lịch sử, D làm gateway/CLI. C đưa ví dụ dữ liệu chạy/xem sớm; D có thể dựng CLI và kiểm tra gateway độc lập trong lúc C làm runner. Mỗi người kiểm thử phần mình và ghép bằng source, provider, DB thật trong sprint.

**Ưu tiên có sớm:** A có snapshot thật đọc được; B có mô tả tool và `read_file`; C có thao tác chạy/xem cùng ví dụ dữ liệu; D có gateway nhận tool definitions và CLI gọi được các thao tác đã chốt. Mỗi người hoàn thành bản tối thiểu trước khi mở rộng phần mình.

**Ghép sớm:** A/D nối đăng ký repository trên CLI, A/B nối đọc file qua tool; C/D nối một lượt model thật có giới hạn output và dùng lại attempts đã bổ sung. Tiếp đó ghép model tự yêu cầu `read_file`, nhận kết quả, trả lời và xem lịch sử; mở rộng sang các tool còn lại cùng ca lỗi.

**Review chéo:** A/B kiểm tra snapshot và quyền đọc; C/D kiểm tra luồng model, lịch sử và CLI. Khi snapshot ổn định, A hỗ trợ C phần lưu/đọc lại dữ liệu, B hỗ trợ D ca tool calling.

**Kết quả cần đạt:** chuỗi thật chạy được và xem lại sau restart; sửa source gốc không đổi snapshot; giới hạn có hiệu lực; lỗi tool/provider/DB giải thích được qua lịch sử. Các ca vượt quyền, file thiếu/lớn và dữ liệu nhạy cảm được kiểm tra trước khi coi sprint hoàn thành.

## Research

- [ ] Nghiên cứu source và bằng chứng mà pipeline Judge/Audit cần đọc.
- [ ] Nghiên cứu cách dùng bốn tool, xử lý lỗi và trường hợp chưa đủ bằng chứng.
- [ ] Nghiên cứu context và điều kiện dừng qua trace của luồng model–tool thật.
