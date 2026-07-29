# Working Rules

Quy tắc làm việc chung. Số lượng quy tắc được giữ ở mức tối thiểu; phần lý do quan trọng hơn phần quy định.

---

## Ba quy tắc bắt buộc

### R1 — Mọi thành phần ảnh hưởng kết quả phải có config flag

Khi triển khai một tính năng có khả năng làm thay đổi số liệu đánh giá, bổ sung flag bật/tắt trong
`config/flags.yaml` **ngay tại thời điểm viết**.

**Lý do:** ablation study là đóng góp khoa học chính của đồ án và là câu trả lời cho chất vấn về đóng góp khi
không huấn luyện model. Không có flag thì không ablate được. Chi phí thêm flag lúc viết khoảng 10 phút; chi
phí bổ sung sau khi code đã gắn kết chặt có thể lên tới vài ngày, và trong một số trường hợp là không khả thi.

### R2 — Agent không được tiếp cận ground truth

Chặn ở tầng tool, không dựa vào chỉ dẫn trong system prompt.

**Lý do:** dữ liệu contest chứa cả source lẫn báo cáo chấm. Nếu agent có quyền truy cập thư mục chứa báo cáo,
nó sẽ đọc và sao chép kết luận, cho ra độ chính xác gần tuyệt đối nhưng hoàn toàn không có giá trị khoa học.
Chỉ dẫn trong prompt không phải một cơ chế kiểm soát.

### R3 — Split theo contest, cố định sau khi chốt

Không chia theo finding trong bất kỳ trường hợp nào. Kết quả chia ghi vào manifest và không thay đổi về sau.

**Lý do:** chia theo finding khiến các finding của cùng một contest xuất hiện ở cả train và test, model đã
tiếp xúc với trường hợp tương tự. Đây là lỗi phổ biến trong đánh giá và hội đồng nắm rõ nó.

---

## Definition of Done

Một hạng mục được xem là hoàn thành khi thoả cả bốn điều kiện:

- [ ] Chạy được trên máy của thành viên khác, không chỉ máy người phát triển
- [ ] Có bằng chứng kiểm chứng: ảnh chụp, log, hoặc một lệnh người khác thực hiện lại được
- [ ] Nếu có ảnh hưởng tới số liệu đánh giá thì đã có config flag
- [ ] Đã cập nhật trạng thái trong `timeline.csv`

---

## Theo dõi tiến độ

Cuối mỗi chu kỳ, cả nhóm cập nhật cột `Trạng thái` trong [`timeline.csv`](timeline.csv). Hạng mục chưa hoàn
thành phải ghi rõ vướng mắc, người xử lý và bước tiếp theo trong công cụ quản lý công việc chung của nhóm.

---

## Ba chỉ số theo dõi liên tục

Ba con số dưới đây phải trả lời được ở bất kỳ thời điểm nào trong năm và được cập nhật tại buổi đồng bộ khi
có số mới.

| Chỉ số                            | Vì sao cần theo dõi                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cost / run**                | Nhân với tổng số run dự kiến để kiểm tra ngân sách. Phát hiện vượt ngân sách ở P1 còn xoay xở được, phát hiện ở P8 thì không |
| **Tỷ lệ compile**           | Verification layer chỉ áp dụng được cho phần dữ liệu build thành công. Tỷ lệ thấp buộc phải điều chỉnh thiết kế đánh giá         |
| **Delta baseline vs harness** | Đây là kết quả trung tâm của đồ án                                                                                                             |

---

## Lịch họp

| Loại        | Tần suất           | Thời lượng | Nội dung                                                                      |
| ------------ | -------------------- | ------------- | ------------------------------------------------------------------------------ |
| Standup      | Thứ 2 hàng tuần   | 20 phút      | Mỗi người ba mục: đã làm, sẽ làm, đang vướng                       |
| Phase review | Cuối mỗi phase     | 60 phút      | Đối chiếu cột Deliverables trong timeline, quyết định descope nếu cần |
| Bắt buộc   | Tuần 9 và tuần 11 | 60 phút      | Xem chi tiết bên dưới                                                      |

### Hai cuộc họp bắt buộc

**Tuần 9 — TV5, TV6, TV1: chốt schema `tool_call`**
Thiếu một trường dữ liệu dẫn tới không chấm được trajectory ở P7 và buộc phải chạy lại toàn bộ benchmark, chi
phí tính bằng hàng trăm giờ máy cùng ngân sách API tương ứng.

**Tuần 11 — TV5, TV1, TV3: chốt `config/flags.yaml`**
Mọi thành phần dự kiến đưa vào ablation study phải có flag kể từ thời điểm này.

---

## Cấu trúc thư mục

```
harness/
├─ docs/                Tài liệu định hướng ban đầu của nhóm
└─ (source của nhóm)    Được tổ chức khi nhóm chốt kiến trúc
```

## Nguyên tắc descope

Chậm tiến độ là tình huống gần như chắc chắn xảy ra. Vấn đề nằm ở chỗ cắt giảm đúng hạng mục.

Thứ tự cắt giảm, ưu tiên từ trên xuống:

1. **Quy mô** — 10 contest thay vì 100, một skill thay vì ba
2. **Tính năng phụ** — MCP client, CLI runtime, các cải thiện giao diện
3. **Số lượng provider** — từ 4 xuống 3, **không xuống dưới 3** vì kết luận RQ3 sẽ không đủ mạnh
4. **Audit mode** — hạ từ tính năng chính xuống bản thử nghiệm

Không cắt giảm trong mọi trường hợp:

- Lớp chặn ground truth
- Split theo contest
- Ablation study
- Trace view
- Offline demo

Mỗi lần descope, ghi rõ lý do khi cập nhật kế hoạch. Trong báo cáo, trình bày dưới dạng giới hạn phạm vi đã xác định
chứ không phải hạng mục chưa hoàn thành. Một đồ án nêu rõ phạm vi và cơ sở giới hạn phạm vi có chất lượng
trình bày cao hơn một đồ án triển khai dở dang nhiều hạng mục.
