# Timeline Guide

Tài liệu đi kèm [`timeline.csv`](timeline.csv). Mở file bằng Excel hoặc Google Sheets.

---

## Nguyên tắc thiết kế

Timeline được tổ chức theo **kết quả cần đạt**, không theo **các bước phải thực hiện**.

Lý do: nhóm vừa triển khai vừa tìm hiểu công nghệ, nên tại thời điểm lập kế hoạch chưa thể xác định chính xác
các bước kỹ thuật. Một kế hoạch mô tả chi tiết từng bước sẽ khó đọc với người chưa nắm thuật ngữ, và mỗi lần
điều chỉnh cách làm lại kéo theo việc sửa toàn bộ chuỗi công việc phía sau.

Mỗi phase kéo dài 4 tuần và được định nghĩa bằng **một câu hỏi cần trả lời xong**. Cách đạt tới câu trả lời
do nhóm tự quyết định trong quá trình triển khai.

Hệ quả:

- Thay đổi phương án kỹ thuật không đòi hỏi sửa timeline, miễn là vẫn trả lời được câu hỏi của phase
- Mỗi phase có sẵn phương án descope, tránh việc phải xử lý bị động khi chậm tiến độ

---

## Ý nghĩa các cột

| Cột | Nội dung | Mức độ ổn định |
|---|---|---|
| `Phase`, `Weeks`, `Month` | Mốc thời gian | Không thay đổi — cả nhóm tham chiếu theo mã phase |
| `Key Question` | Định nghĩa mục tiêu của phase | Thay đổi cần cả nhóm thống nhất |
| Bốn cột track | Công việc của từng track, mô tả ở mức hạng mục | Điều chỉnh tự do |
| `Deliverables` | Sản phẩm cụ thể xác nhận phase hoàn thành | Thay đổi cần cả nhóm thống nhất |
| `Descope First` | Hạng mục cắt giảm trước khi chậm tiến độ | Điều chỉnh tự do |
| `Milestone` | Điểm quyết định lớn | Không thay đổi |

---

## Quy trình điều chỉnh

**Điều chỉnh tự do** — bốn cột track, cột `Descope First`.
Thực hiện trực tiếp, ghi một dòng vào journal.

**Cần thống nhất cả nhóm** — cột `Key Question`, cột `Deliverables`.
Hai cột này định nghĩa mục tiêu. Thay đổi cần họp, thống nhất, và ghi decision record.

**Không thay đổi** — số phase, mốc thời gian, năm milestone.
Đây là khung xương của kế hoạch, thay đổi sẽ kéo theo toàn bộ.

**Nguyên tắc chung:** khi phát hiện phương án kỹ thuật tốt hơn ở giữa chừng, thay đổi phương án và giữ nguyên
câu hỏi của phase. Timeline mô tả đích đến, không mô tả lộ trình.

---

## Milestone

| Milestone | Thời điểm | Điều kiện đạt | Hệ quả nếu không đạt |
|---|---|---|---|
| **M1** | Cuối tuần 8 (08/2026) | Có số liệu chứng minh harness cải thiện kết quả so với baseline | Toàn bộ phần còn lại của năm mất cơ sở — cần họp đánh giá lại hướng đi |
| **M2** | Cuối tuần 16 (10/2026) | Judge mode chạy end-to-end, mọi thành phần bật/tắt được qua config | Không thực hiện được ablation study |
| **M3** | Cuối tuần 24 (12/2026) | Ablation study và cross-provider matrix lần một | Chưa có đóng góp khoa học định lượng |
| **M4** | Cuối tuần 36 (03/2027) | Kết luận cho cả ba câu hỏi nghiên cứu, freeze harness v1.0 | Không đủ dữ liệu cho chương đánh giá |
| **M5** | Tuần 52 (07/2027) | Bảo vệ | — |

Giữa M3 và M4 là **P6 (01/2027)**, phase triển khai verification layer. Đây là thành phần có giá trị đóng góp
cao nhất; khi phải cân đối nguồn lực, ưu tiên bảo vệ phase này.

---

## Phase review

Cuối mỗi phase, họp 60 phút và đối chiếu cột `Deliverables`:

- **Đạt đầy đủ** — chuyển sang phase kế tiếp
- **Đạt một phần** — áp dụng cột `Descope First`, ghi journal, chuyển sang phase kế tiếp
- **Thiếu phần lớn** — dừng lại đánh giá. Trường hợp này thường không phải vấn đề tiến độ mà là mục tiêu đặt
  chưa phù hợp với năng lực thực tế. Điều chỉnh lại cột `Key Question`.

Không chuyển công việc tồn đọng sang phase sau. Mỗi phase đã có khối lượng công việc riêng; dồn hai lần liên
tiếp dẫn tới trượt tiến độ toàn bộ kế hoạch.

---

## Hai điểm có chi phí sửa sai cao nhất

**Họp tuần 9 — chốt schema `tool_call`**
Thiếu một trường dữ liệu, ví dụ không lưu danh sách file agent đã mở, dẫn tới không chấm được trajectory ở P7
và buộc chạy lại toàn bộ benchmark. Chi phí ước tính hàng trăm giờ máy cùng ngân sách API tương ứng. Một giờ
họp ở thời điểm hiện tại đổi lại khoảng hai tuần công sức.

**Freeze harness cuối P8 (03/2027)**
Sau mốc này chỉ sửa lỗi, không bổ sung tính năng. Nếu core tiếp tục thay đổi thì số liệu đo trước và sau mốc
không so sánh được với nhau, kéo theo toàn bộ bảng kết quả mất giá trị. Đây là ràng buộc cứng.
