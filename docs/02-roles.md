# Roles

Phân công theo track. Đọc kỹ phần của mình, đọc lướt phần còn lại để nắm quan hệ phụ thuộc.

---

## Tổng quan

| | Track | Phạm vi | Sản phẩm cuối |
|---|---|---|---|
| **TV1** | Agent loop | Chu trình điều khiển trung tâm của harness | Core loop ổn định, 100 run liên tiếp không crash |
| **TV2** | Context & Memory | Quản lý context budget, compaction, memory | Compaction và memory có flag bật/tắt |
| **TV3** | Tools & Skills | Tool layer và skill catalog | Tool registry đầy đủ, ba skill mẫu |
| **TV4** | Security & Verification | Sandbox, guardrail, môi trường thực thi test | Adversarial test suite, verification layer |
| **TV5** | Data & Evaluation | Corpus, eval runner, phân tích số liệu | Ablation study, cross-provider matrix |
| **TV6** | Application & Demo | FE/BE, trace view, kịch bản demo | Ứng dụng hai mode, offline demo |

---

## TV1 — Agent loop

### Phạm vi kỹ thuật

Chu trình điều khiển trung tâm: gửi request tới model, nhận tool call, thực thi, đưa kết quả trở lại, lặp
cho tới stop condition.

- Xử lý lỗi: tool thất bại phải được chuyển thành message để model tự sửa, tuyệt đối không làm sập agent loop
- Bốn stop condition: max step, token budget, wall-clock timeout, no-progress detection
- Provider layer cho phép đổi model qua config. Dùng thư viện có sẵn, **không tự viết adapter cho từng
  provider** — chi phí phát triển và bảo trì không tương xứng với giá trị mang lại
- Structured output cho verdict, không parse văn xuôi tự do
- Retry policy với backoff, đếm riêng lỗi hạ tầng và lỗi logic của agent

### Rủi ro cần lưu ý

Cả ba track còn lại phụ thuộc vào interface của core. Interface cần được chốt sớm và **freeze đúng hạn ở
P8**. Nếu core còn thay đổi sau mốc freeze thì số liệu đo trước và sau không so sánh được với nhau, kéo theo
toàn bộ bảng kết quả mất giá trị.

---

## TV2 — Context & Memory

### Phạm vi kỹ thuật

Model có giới hạn context cứng. Track này đảm bảo hệ thống hoạt động trong giới hạn đó và giữ lại đúng
thông tin cần thiết.

- Context budget: phân bổ cho system prompt, tool output, và **phần dự trữ cho output của model**
- Compaction khi context chạm ngưỡng khoảng 80%
- Truncation tool output; thay thế nội dung đã đọc bằng tham chiếu tóm tắt
- Long-term memory kèm **reset policy**: chỉ nạp memory từ contest thuộc train/validation, contest thuộc
  test set luôn chạy trên trạng thái sạch
- Session note cho phép agent ghi chú trong phạm vi một run
- Mọi thành phần đều phải có flag bật/tắt để TV5 thực hiện ablation

### Rủi ro cần lưu ý

Kết quả của track này không quan sát được trực tiếp qua giao diện, nhưng nó quyết định chi phí vận hành.
Cần đo và ghi lại lượng token tiết kiệm được sau mỗi cải tiến — đây là số liệu định lượng cho báo cáo.

Sai sót ở reset policy làm hỏng toàn bộ số liệu đánh giá mà không tạo ra dấu hiệu cảnh báo nào.

---

## TV3 — Tools & Skills

### Phạm vi kỹ thuật

Model không tự thực thi được hành động nào, nó chỉ phát ra tool call. Track này xây dựng tập năng lực đó.

- Tool nền tảng: `read_file` (có tham số dòng), `glob`, `grep` (kèm số dòng), `list_dir`
- Tool cho Judge mode: xem diff, tìm định nghĩa hàm xuyên repository, truy vết call graph
- Tool registry: thêm tool mới không cần sửa core
- **Tách tool description ra file `.txt` riêng**. Lợi ích: version hoá độc lập,
  chỉnh mô tả không đụng code, và TV5 có thể ablate riêng phần mô tả
- Error message phải đọc được bởi model: nêu rõ chuyện gì xảy ra, dữ kiện xung quanh, và gợi ý hành động
  tiếp theo. Thông báo dạng `Error: ENOENT` không giúp model tự sửa
- Ba skill mẫu: reentrancy, access control, oracle manipulation. **Mỗi skill bắt buộc có mục điều kiện loại
  trừ** — hướng dẫn agent khi nào không báo cáo là cơ chế nâng precision

### Rủi ro cần lưu ý

Xu hướng phổ biến là làm nhiều tool. Số lượng không tương quan với chất lượng. TV5 sẽ đo được tool nào không
bao giờ được gọi và tool nào thường xuyên bị gọi sai tham số; kết quả đó nên dẫn tới việc loại bỏ hoặc thiết
kế lại, không phải bổ sung thêm.

---

## TV4 — Security & Verification

### Phạm vi kỹ thuật, phần 1: Guardrails

- Chỉ mount thư mục `source/`, **không mount toàn bộ thư mục contest** vì nó chứa báo cáo ground truth
- Allowlist cho shell command, không dùng blocklist
- Secret filter trên tool output
- Chặn mọi đường dẫn tới ground truth (`report`, `finding`, metadata) kèm log cảnh báo khi có truy cập
- Adversarial test suite tự động chứng minh các lớp trên có hiệu lực thật

### Phạm vi kỹ thuật, phần 2: Verification layer

Trọng tâm của đồ án, triển khai từ P6 (tháng 01/2027).

- Môi trường thực thi test cô lập: container không mạng, giới hạn CPU/RAM, tự huỷ sau khi chạy
- Luồng xử lý: agent nêu nghi vấn → sinh PoC test → chạy `forge test` → PASS thì báo cáo kèm bằng chứng,
  FAIL thì loại (tối đa hai lần retry), không sinh được test thì đánh dấu `unverified` và **tách riêng khỏi
  nhóm FAIL**
- **Ghi lại cả ba nhánh kết quả, bao gồm FAIL.** Số lượng nghi vấn bị loại là bằng chứng định lượng cho giá
  trị của lớp này

### Việc cần ưu tiên ngay P0

Đo tỷ lệ compile trên khoảng 20 repository contest. Verification layer chỉ áp dụng được cho phần dữ liệu
build thành công. Nếu tỷ lệ chỉ đạt 30% thì thiết kế đánh giá phải điều chỉnh, và cả nhóm cần biết điều đó
ở P0 chứ không phải P6.

---

## TV5 — Data & Evaluation

### Phạm vi kỹ thuật

Chuyển các quan sát định tính thành số liệu có thể bảo vệ trước hội đồng. Track này chịu trách nhiệm trả lời
cả ba câu hỏi nghiên cứu.

- Thu thập corpus từ Code4rena, Sherlock, CodeHawks; chuẩn hoá thang severity giữa ba nền tảng
- **Ưu tiên contest có finding invalid.** Corpus chỉ chứa finding valid thì không đo được precision
- Split theo contest trọn gói, ghi vào manifest, cố định vĩnh viễn
- Eval runner: một lệnh chạy hết bộ đề, lưu đầy đủ trajectory
- **Ablation study** — đóng góp khoa học chính
- **Cross-provider matrix**: 4 model × (harness on/off). Chỉ dòng delta là kết quả nghiên cứu; xếp hạng model
  không thuộc phạm vi câu hỏi của đồ án
- Baseline đo trên **đúng test set của nhóm**. Không trích số liệu từ paper vì khác benchmark và khác quy tắc
  so khớp, không so sánh được
- Trajectory eval: phân biệt kết luận đúng do suy luận với kết luận đúng do ngẫu nhiên

### Rủi ro cần lưu ý

Track này phụ thuộc vào việc TV1/TV3 cung cấp đủ config flag và TV6 lưu đủ trường dữ liệu trajectory. Nếu
đến lúc chạy ablation mới phát hiện thiếu một trường thì phải chạy lại toàn bộ, chi phí tính bằng hàng trăm
giờ máy và ngân sách API.

Cần chủ động rà soát yêu cầu dữ liệu ngay từ P2, không chờ tới khi cần dùng.

---

## TV6 — Application & Demo

### Phạm vi kỹ thuật

Phần hệ thống mà hội đồng quan sát trực tiếp.

- Chốt stack FE/BE ngay P0, ưu tiên công nghệ cả nhóm thành thạo
- API bất đồng bộ: `POST /judge` trả `run_id` ngay, `GET /run/{id}` truy vấn kết quả. Một run mất 2-10 phút
  nên không giữ kết nối HTTP mở
- **Trace view** — màn hình quan trọng nhất của ứng dụng. Hiển thị từng step agent đã thực hiện kèm thời gian
  và token. Nếu chỉ hoàn thiện được một màn hình thì chọn màn hình này
- Bảng `tool_call` trong DB: `run_id, step, tool_name, arguments, result, duration, tokens, is_error`
- Màn hình so sánh nhiều run, phục vụ phân tích của TV5
- Export CSV/JSON để TV5 dựng biểu đồ
- **Offline demo** (P10): ghi sẵn kết quả vào DB, có chế độ replay, chạy không cần mạng nhưng vẫn hiển thị
  đầy đủ trajectory. Kiểm tra trên đúng thiết bị sẽ dùng khi bảo vệ

### Rủi ro cần lưu ý

Thứ tự ưu tiên: trace view, luồng end-to-end hoạt động, sau đó mới tới các cải thiện về giao diện.

Chi phí xây offline demo khoảng nửa ngày và nó loại bỏ rủi ro lớn nhất của buổi bảo vệ.

---

## Quan hệ phụ thuộc

```
TV1  ── interface của core ──►  TV2, TV3, TV4
TV1, TV3  ── config flag ─────►  TV5
TV6  ── schema trajectory ────►  TV5
TV4  ── tỷ lệ compile ────────►  toàn nhóm
```

### Hai cuộc họp bắt buộc

**Tuần 9 — TV5, TV6, TV1: chốt schema `tool_call`**
Thiếu một trường dẫn tới việc không chấm được trajectory ở P7 và phải chạy lại toàn bộ benchmark. Một giờ
họp ở thời điểm này đổi lại khoảng hai tuần công sức.

**Tuần 11 — TV5, TV1, TV3: chốt `config/flags.yaml`**
Mọi thành phần TV5 dự định ablate phải có flag kể từ thời điểm này.
