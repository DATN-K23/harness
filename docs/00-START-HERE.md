# Start Here

Tài liệu vào cửa cho toàn nhóm. Đọc trước khi bắt đầu bất kỳ việc gì.

---

## Thứ tự đọc

| # | Tài liệu | Đối tượng | Thời lượng |
|---|---|---|---|
| 1 | [`idea.md`](idea.md) | Toàn nhóm | 10 phút |
| 2 | Tài liệu này | Toàn nhóm | 15 phút |
| 3 | [`01-glossary.md`](01-glossary.md) | Toàn nhóm, đọc lướt rồi tra lại khi cần | 10 phút |
| 4 | [`02-roles.md`](02-roles.md) | Toàn nhóm, đọc kỹ phần của mình | 10 phút |
| 5 | [`03-opencode-reading.md`](03-opencode-reading.md) | Toàn nhóm | 5 phút đọc, ~6 giờ thực hiện |
| 6 | [`04-working-rules.md`](04-working-rules.md) | Toàn nhóm | 10 phút |
| 7 | [`05-timeline-guide.md`](05-timeline-guide.md) | TV1 đọc kỹ, còn lại đọc lướt | 10 phút |
| 8 | [`06-blueprint.md`](06-blueprint.md) | Toàn nhóm, đọc trước khi scaffold | 60 phút |
| 9 | [`07-slice-1-implementation-plan.md`](07-slice-1-implementation-plan.md) | Toàn nhóm triển khai Slice 1 | 30 phút |

---

## Tóm tắt đề tài

LLM có khả năng đọc hiểu code tốt, nhưng khi chỉ được cung cấp một đoạn code trong prompt thì nó không thể
mở file khác, không thể tra cứu xuyên repository, và không thể thực thi code để kiểm chứng giả thuyết của
chính nó. Kết quả là phần lớn kết luận mang tính suy đoán.

Nhóm xây dựng một **harness** — lớp điều phối bọc quanh model — cung cấp cho nó bốn thứ:

- **Tool** để truy cập filesystem và tra cứu xuyên repository
- **Memory** để lưu lại những gì đã xem xét và những gì còn tồn đọng
- **Skill** mô tả quy trình kiểm tra cho từng lớp lỗ hổng
- **Verification layer** để agent tự sinh và chạy PoC test trước khi báo cáo

Luận điểm trung tâm: giữ nguyên model, không huấn luyện lại. Baseline đạt X%, qua harness đạt Y%.
**Phần chênh lệch Y − X là đóng góp của đồ án.** Chênh lệch này phải được chứng minh trên nhiều nhà cung
cấp model, không chỉ một.

---

## Ba câu hỏi nghiên cứu

Mọi công việc trong năm đều phục vụ một trong ba câu hỏi này.

**RQ1 — Harness có cải thiện chất lượng đầu ra so với baseline không?**
So sánh cùng một model ở hai điều kiện: gọi trực tiếp và gọi qua harness.

**RQ2 — Kết quả có vượt được các công cụ hiện có không?**
Đối chiếu với static analyzer (Slither, Mythril) và một agent đa dụng có sẵn.

**RQ3 — Giá trị đó có độc lập với nhà cung cấp model không?**
Nếu harness chỉ cải thiện kết quả với một provider thì đóng góp có thể chỉ là khai thác đặc tính riêng của
provider đó. Nếu cải thiện trên cả bốn thì kết luận vững: giá trị nằm ở harness.

> Đây là lý do hỗ trợ nhiều provider không phải một tính năng phụ mà là **điều kiện cần** để chứng minh
> luận điểm chính.

---

## Bốn chỉ số đánh giá

| Chỉ số | Định nghĩa | Vì sao cần |
|---|---|---|
| **Recall** | Tỷ lệ lỗ hổng thật được phát hiện | Bỏ sót nhiều thì công cụ không dùng được |
| **Precision** | Tỷ lệ báo cáo đưa ra là chính xác | Trọng tâm cạnh tranh của đồ án, xem bên dưới |
| **Cost** | Chi phí cho một lần chạy | Vượt chi phí thuê chuyên gia thì không có ai áp dụng |
| **Reproducibility** | Chạy lại cùng cấu hình có cùng kết quả | Điều kiện tối thiểu của một kết quả nghiên cứu |

### Vì sao precision là trọng tâm

Đây là điểm yếu chung của các công cụ audit dựa trên AI hiện nay: tỷ lệ false positive rất cao. Một hệ thống
báo 100 finding mà chỉ khoảng 15 cái là thật buộc người kiểm định phải đọc toàn bộ 100 để lọc, tốn thời gian
hơn tự làm. Đó là lý do ngành audit chưa áp dụng rộng rãi dù ai cũng thừa nhận LLM đọc code tốt.

Hướng tiếp cận của nhóm là bắt agent tự chứng minh: nghi ngờ có lỗ hổng thì phải sinh PoC test khai thác nó,
test chạy PASS mới được báo cáo, FAIL thì loại. Model gọi trực tiếp không làm được việc này vì không có khả
năng thực thi code — chỉ harness mới cung cấp được môi trường đó.

Nếu cả năm chỉ hoàn thiện được một thành phần, đó phải là verification layer.

---

## Vai trò của OpenCode trong đồ án

`opencode/` là một dự án mã nguồn mở đã giải quyết tốt lớp bài toán kỹ thuật nền mà nhóm sắp phải giải:
agent loop, tool registry, context management, permission model.

**Nhóm không fork và không copy code.** Fork một dự án có sẵn rồi chỉnh sửa sẽ làm phần lớn công trình không
còn thuộc về nhóm, và đây là điểm hội đồng sẽ chất vấn trực tiếp.

Mục đích đọc OpenCode:

- Nắm được một hệ thống loại này gồm những thành phần gì, thay vì thiết kế lại từ đầu
- Nhận diện các quyết định thiết kế đã được kiểm chứng qua thực tế sử dụng
- Thu thập tư liệu cho Chương 2 của báo cáo (khảo sát công trình liên quan)

Khác biệt cốt lõi cần giữ rõ trong đầu: OpenCode là công cụ **hỗ trợ viết code**. Đồ án là công cụ **kiểm
định code**, nghĩa là có thêm hai thành phần OpenCode không có — Judge mode (phân loại một finding là valid
hay invalid) và verification layer (bắt agent tự chứng minh bằng test thực thi được). Đó là phạm vi đóng
góp của nhóm.

---

## Bốn rủi ro phương pháp luận

Bốn rủi ro dưới đây nguy hiểm vì chúng không tạo ra bất kỳ dấu hiệu cảnh báo nào. Hệ thống vẫn chạy, số liệu
vẫn đẹp, và sai sót chỉ lộ ra khi bị chất vấn.

| Rủi ro | Cơ chế | Biện pháp |
|---|---|---|
| **Ground truth leakage** | Dữ liệu contest chứa cả source lẫn báo cáo chấm. Agent mở file báo cáo và sao chép kết luận. Độ chính xác gần 100% nhưng không có giá trị. | Chỉ mount thư mục `source/`. Chặn ở tầng tool, không dựa vào chỉ dẫn trong prompt. |
| **Split leakage** | Chia dữ liệu theo finding khiến finding của cùng một contest xuất hiện ở cả train và test. Model đã thấy trường hợp tương tự. | Chia theo contest, trọn gói. Ghi vào manifest và cố định vĩnh viễn. |
| **Không ablate được** | Các thành phần gắn chặt vào nhau nên không tắt riêng lẻ được, dẫn tới không định lượng được đóng góp của từng phần. | Mọi thành phần ảnh hưởng kết quả phải có flag bật/tắt ngay từ khi viết. |
| **Data contamination** | Contest cũ đã công khai từ lâu và có thể nằm trong dữ liệu huấn luyện của model. Kết quả đúng nhờ ghi nhớ, không nhờ harness. | Ưu tiên contest sau knowledge cutoff. Tách nhóm trước/sau cutoff và báo cáo minh bạch. |

Xử lý bốn rủi ro này một cách minh bạch, kể cả khi số liệu không thuận lợi, sẽ nâng đáng kể chất lượng phần
đánh giá của báo cáo.

---

## Phạm vi loại trừ

Ghi rõ ngay từ đầu để tránh hiểu nhầm về hướng đi:

| Không thực hiện | Lý do |
|---|---|
| Huấn luyện hoặc fine-tune model riêng | Vượt quá nguồn lực và sẽ lỗi thời trong vòng vài tháng |
| Xây dựng một chatbot chuyên ngành blockchain | Đó là sản phẩm ứng dụng, không phải một đóng góp nghiên cứu |
| Chỉ hỗ trợ một nhà cung cấp model | Không đủ để trả lời RQ3 |
| Fork dự án mã nguồn mở rồi chỉnh sửa | Phần lớn công trình sẽ không còn thuộc về nhóm |

---

## Các câu hỏi phản biện dự kiến

Toàn nhóm cần trả lời được. Nội dung câu trả lời cập nhật dần theo số liệu thực tế.

**1. Nhóm không huấn luyện model thì đóng góp nằm ở đâu?**
Đóng góp nằm ở harness. Bằng chứng định lượng là bảng ablation: tắt thành phần A làm kết quả giảm _%, tắt
thành phần B giảm _%.

**2. Đã có sẵn các agent đa dụng, đề tài này bổ sung được gì?**
Agent đa dụng không mang theo quy trình kiểm định chuyên ngành và không bắt buộc xác minh bằng test thực thi
được. Nhóm có đo đối chiếu với một agent đa dụng làm baseline.

**3. Làm sao đảm bảo agent không đọc được ground truth?**
Có lớp chặn ở tầng tool kèm bộ adversarial test tự động chứng minh mọi đường truy cập tới ground truth đều
bị từ chối và ghi log.

**4. Kết quả có tái lập được không?**
Có. Cùng cấu hình, cùng phiên bản prompt, cùng split thì cho cùng kết quả. Có reproducibility test riêng.

---

## Công việc hai tuần đầu

Một việc chung cho cả nhóm: đọc phần OpenCode được phân công, nộp note một trang theo
[`templates/opencode-note.md`](templates/opencode-note.md), lưu vào `docs/notes/opencode-TVx.md`, hạn cuối
tuần 2.

Song song, mỗi thành viên bắt đầu phần chuyên môn theo [`02-roles.md`](02-roles.md).

Sáu note này hợp thành bản khảo sát kiến trúc đầu tiên và sẽ được sử dụng trực tiếp trong báo cáo.
