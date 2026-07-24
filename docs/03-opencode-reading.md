# OpenCode Reading Assignment

**Hạn nộp:** cuối tuần 2.
**Nộp vào:** `docs/notes/opencode-TVx.md`, theo [`templates/opencode-note.md`](templates/opencode-note.md).
**Thời lượng ước tính:** 4-6 giờ mỗi thành viên.

---

## Phương pháp đọc

OpenCode viết bằng TypeScript kết hợp thư viện `effect` theo phong cách functional. Cú pháp `effect` khá xa
lạ nếu chưa từng tiếp xúc. **Không cần hiểu cú pháp này** — mục tiêu là trả lời năm câu hỏi kiến trúc, không
phải nắm chi tiết triển khai.

Quy trình đề xuất:

1. **Đọc file `.txt` trước file `.ts`.** Thư mục `tool/` chứa các file `.txt` là tool description viết bằng
   tiếng Anh thông thường, cho biết tool làm gì trước khi phải đọc code.
2. Lượt một: đọc tên hàm, chữ ký hàm và comment. Bỏ qua thân hàm.
3. Lượt hai: chỉ đọc kỹ thân hàm ở hai đến ba vị trí quan trọng nhất.
4. Nếu mắc quá 20 phút ở một chỗ, ghi lại là chưa hiểu và đi tiếp. Note ghi nhận đúng phần chưa hiểu có giá
   trị hơn note che giấu nó.

Hai file nên đọc chung trước khi vào phần riêng: `AGENTS.md` và `CONTEXT.md` ở thư mục gốc `opencode/`.
`CONTEXT.md` mở đầu bằng một bảng thuật ngữ — đây chính là loại tài liệu nhóm sẽ phải tự xây dựng.

Đường dẫn dưới đây tính từ `opencode/packages/opencode/src/`.

---

## TV1 — Agent loop

| File                     | Dòng | Nội dung                                                      |
| ------------------------ | ----- | -------------------------------------------------------------- |
| `session/processor.ts` | 718   | **Trọng tâm.** Agent loop được triển khai ở đây |
| `session/session.ts`   | 1018  | Vòng đời của một session                                  |
| `session/run-state.ts` | 151   | Trạng thái một run: đang chạy, hoàn tất, bị huỷ       |
| `session/llm.ts`       | 404   | Điểm gọi thực tế tới provider                            |
| `session/retry.ts`     | 201   | Chiến lược retry và backoff                                |

**Câu hỏi cần trả lời:**

1. Một vòng lặp bắt đầu và kết thúc ở đâu? Mô tả lại thành năm bước.
2. Khi model phát ra nhiều tool call trong một lượt, chúng được thực thi song song hay tuần tự?
3. Tool ném exception thì hệ thống xử lý ra sao? Loop dừng, hay lỗi được chuyển thành message để model tự sửa?
4. Có bao nhiêu stop condition và chúng được kiểm tra ở đâu?
5. Tín hiệu huỷ từ người dùng lan truyền qua những thành phần nào?

---

## TV2 — Context & Memory

| File                       | Dòng     | Nội dung                                                                |
| -------------------------- | --------- | ------------------------------------------------------------------------ |
| `session/compaction.ts`  | 562       | **Trọng tâm.** Cơ chế nén hội thoại                         |
| `session/prompt/*.txt`   | ~100/file | **Đọc trước.** System prompt thực tế cho từng provider      |
| `session/prompt.ts`      | 1631      | Lắp ráp prompt. File dài, đọc lướt, chỉ đọc kỹ phần assembly |
| `session/system.ts`      | 145       | Phần system context nền                                                |
| `session/instruction.ts` | 237       | Nạp instruction riêng của từng project                               |
| `session/reminders.ts`   | 92        | Nhắc lại chỉ dẫn giữa chừng khi agent đi lệch                    |
| `session/overflow.ts`    | 34        | Ngắn, đọc toàn bộ. Xử lý tràn context                            |
| `tool/truncate.ts`       | 156       | Cắt tool output                                                         |

**Câu hỏi cần trả lời:**

1. Hệ thống xác định thời điểm cần compaction bằng cách nào? Ngưỡng là bao nhiêu?
2. Compaction giữ lại phần nào và loại bỏ phần nào?
3. Có dành riêng phần context cho output của model không? Tỷ lệ bao nhiêu?
4. Vì sao mỗi provider có một file prompt riêng trong `prompt/`? Chúng khác nhau ở những điểm nào?
5. Tool output dài 5000 dòng được xử lý ra sao? Phần bị cắt có được lưu lại ở đâu không?

---

## TV3 — Tools & Skills

| File                            | Dòng    | Nội dung                                                                          |
| ------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `tool/tool.ts`                | 183      | **Trọng tâm, đọc trước tiên.** Định nghĩa interface của một tool |
| `tool/registry.ts`            | 450      | Tool được đăng ký và cung cấp cho model ra sao                             |
| `tool/read.ts` + `read.txt` | 386 + 14 | Tool đọc file. Đối chiếu`.txt` với `.ts`                                 |
| `tool/glob.ts` + `.txt`     | 76 + 6   | Tìm file theo pattern                                                             |
| `tool/grep.ts` + `.txt`     | 112 + 8  | Tìm nội dung trong source                                                        |
| `tool/skill.ts` + `.txt`    | 70 + 5   | **Nạp skill — cơ chế nhóm cần tham khảo trực tiếp**                 |
| `skill/discovery.ts`          | —       | Phát hiện skill khả dụng                                                       |
| `tool/json-schema.ts`         | 164      | Mô tả tham số tool cho model                                                    |

**Câu hỏi cần trả lời:**

1. Một tool tối thiểu cần khai báo những thành phần nào?
2. Tool description đặt ở file `.txt` riêng thay vì inline trong code mang lại lợi ích gì? Cân nhắc trường
   hợp TV5 muốn ablate riêng phần mô tả.
3. Model gọi tool với tham số sai schema thì xảy ra chuyện gì? Đọc `InvalidArgumentsError` trong `tool.ts`
   và phân tích vì sao thông điệp lỗi được viết theo cách đó.
4. Đọc `read.txt`. Nó chứa những chỉ dẫn nào mà một tài liệu API thông thường không có? Giải thích lý do.
5. `skill.ts` nạp một skill theo cơ chế nào? Cơ chế đó có áp dụng được cho đồ án không?

---

## TV4 — Security

| File                        | Dòng    | Nội dung                                                                   |
| --------------------------- | -------- | --------------------------------------------------------------------------- |
| `tool/shell.ts`           | 645      | **Trọng tâm.** Thực thi shell command, bề mặt rủi ro lớn nhất |
| `permission/index.ts`     | —       | Cơ chế xin phép trước hành động nhạy cảm                          |
| `permission/evaluate.ts`  | —       | Logic ra quyết định cho phép hay từ chối                              |
| `permission/arity.ts`     | —       | Khớp rule theo pattern đường dẫn                                       |
| `tool/shell/prompt.ts`    | 293      | Chỉ dẫn cho model về việc chạy lệnh                                   |
| `tool/shell/shell.txt`    | 21       | Ngắn, đọc toàn bộ                                                      |
| `tool/task.ts` + `.txt` | 360 + 19 | Uỷ nhiệm công việc cho sub-agent                                        |

**Câu hỏi cần trả lời:**

1. Trước khi thực thi một lệnh, hệ thống kiểm tra những điều kiện nào?
2. Cơ chế lọc dùng allowlist hay blocklist? Lựa chọn đó ảnh hưởng thế nào tới độ an toàn?
3. Có cơ chế nào ngăn agent đọc file ngoài phạm vi project không? Nó nằm ở tầng nào?
4. Có phương án nào vượt qua được các lớp kiểm soát này không? Ghi lại — đây là tư liệu đầu vào cho
   adversarial test suite ở P9.
5. Sub-agent trong `task.ts` phục vụ mục đích gì? Nó có budget riêng không? Mô hình này áp dụng được cho
   đồ án ở đâu?

---

## TV5 — Data model

| File                       | Dòng | Nội dung                                                              |
| -------------------------- | ----- | ---------------------------------------------------------------------- |
| `session/message-v2.ts`  | 734   | **Trọng tâm.** Cấu trúc dữ liệu của message và tool call |
| `session/tools.ts`       | 590   | Tool result được ghi nhận ra sao                                   |
| `provider/transform.ts`  | —    | Chuẩn hoá khác biệt định dạng giữa các provider               |
| `provider/provider.ts`   | —    | Quản lý provider                                                     |
| `session/llm/request.ts` | 226   | Thành phần của một request gửi đi                                |

**Câu hỏi cần trả lời:**

1. Một tool call được lưu lại với những trường nào? Liệt kê đầy đủ — đây là bản nháp đầu tiên cho schema
   `tool_call` của nhóm.
2. Có ghi nhận token và thời gian thực thi không? Nếu không thì nhóm phải bổ sung.
3. Cùng một cuộc hội thoại gửi tới bốn provider khác nhau — khác biệt được xử lý ở đâu?
4. Từ dữ liệu được lưu, có tái dựng đầy đủ trajectory của một run không? Còn thiếu thông tin gì?
5. **Câu hỏi trọng tâm:** để chấm được trajectory (agent có mở đúng file chứa lỗ hổng không, có bao nhiêu
   step lãng phí, có dùng verification không), nhóm cần bổ sung những trường nào so với OpenCode?

---

## TV6 — Backend & data flow

| File                 | Nội dung                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `server/server.ts` | **Trọng tâm.** Khởi tạo server                                                                |
| `server/routes/`   | Danh sách API và quy ước đặt tên                                                                 |
| `server/event.ts`  | Sự kiện đẩy tới client                                                                             |
| `bus/`             | Cơ chế giao tiếp giữa các thành phần                                                             |
| `packages/sdk/`    | Client gọi vào server                                                                                 |
| `packages/tui/`    | Giao diện dòng lệnh —**tham khảo cách hiển thị tiến trình agent theo thời gian thực** |

**Câu hỏi cần trả lời:**

1. Một run kéo dài vài phút — client theo dõi tiến độ bằng cơ chế nào (polling, server-sent events,
   streaming)?
2. Thông tin "agent đang gọi tool X" đi từ đâu tới đâu?
3. Client mất kết nối rồi kết nối lại có xem được phần đã bỏ lỡ không?
4. API tuân theo quy ước đặt tên nào? Phần nào áp dụng được cho đồ án?
5. Mô tả luồng dữ liệu từ thao tác của người dùng tới lúc kết quả hiển thị.

---

## Buổi chia sẻ cuối tuần 2

Mỗi thành viên trình bày 7 phút, không dùng slide, thao tác trực tiếp trên source.

Ba nội dung bắt buộc:

1. Thành phần này giải quyết vấn đề gì?
2. Có quyết định thiết kế nào nằm ngoài dự đoán ban đầu không? Phân tích lý do.
3. Phần nào nên tham khảo, phần nào nên làm khác, và vì sao?

Nội dung buổi này là tư liệu trực tiếp cho Chương 2 của báo cáo. Nên ghi âm.
