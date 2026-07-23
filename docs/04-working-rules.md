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
- [ ] Đã ghi vào project journal

---

## Project journal

File [`journal.md`](journal.md), cập nhật hàng tuần, cả nhóm cùng đóng góp.

```
## Tuần 7 (18-24/08/2026)

**Hoàn thành:** TV3 xong grep tool kèm số dòng. TV5 gán nhãn 40/50 case của eval set v0.
**Vướng mắc:** TV4 — Foundry build thất bại trên 6/20 repo, đang xác định nguyên nhân.
**Quyết định:** Dùng LiteLLM thay vì tự viết provider adapter. Lý do: 4 provider, tự viết ước tính 2 tuần.
**Số liệu mới:** baseline 61%, harness 74% trên eval set v0 (n=50).
**Kế hoạch tuần sau:** TV1 chốt core interface. TV5 chạy thử provider thứ hai.
```

**Lý do bắt buộc:** đến giai đoạn viết báo cáo (04/2027), việc tái dựng bối cảnh của các quyết định đã đưa ra
từ 08/2026 gần như không khả thi nếu không có ghi chép. Journal chuyển hoá trực tiếp thành nội dung Chương 3
và phần thuyết minh thiết kế.

Chi phí khoảng 10 phút mỗi tuần, tiết kiệm ước tính hai tuần ở giai đoạn viết báo cáo.

---

## Ba chỉ số theo dõi liên tục

Ba con số dưới đây phải trả lời được ở bất kỳ thời điểm nào trong năm, cập nhật vào journal mỗi khi có số mới.

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
project/
├─ idel.md              Mô tả ý tưởng
├─ docs/
│  ├─ timeline.csv      Kế hoạch cả năm
│  ├─ journal.md        Nhật ký tuần
│  ├─ notes/            Note đọc OpenCode
│  ├─ decisions/        Mỗi quyết định lớn một file
│  └─ templates/        Biểu mẫu
├─ opencode/            THAM KHẢO — không sửa, không copy
└─ (source của nhóm)    Khởi tạo từ P0
```

`opencode/` là thư mục chỉ đọc. Không chỉnh sửa và không sao chép file sang source của nhóm. Khi cần áp dụng
một ý tưởng thiết kế, đọc hiểu rồi tự triển khai lại — sao chép trực tiếp làm suy yếu luận điểm về tính
nguyên bản của công trình.

---

## Decision record

Mỗi quyết định có ảnh hưởng dài hạn được ghi thành một file trong `docs/decisions/`, đặt tên
`YYYY-MM-DD-slug.md`, độ dài khoảng nửa trang. Mẫu: [`templates/decision.md`](templates/decision.md).

**Lý do:** hội đồng sẽ chất vấn cơ sở của các lựa chọn kỹ thuật. Có decision record thì trả lời được ngay, và
phần thuyết minh thiết kế trong báo cáo có sẵn nội dung.

---

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

Mỗi lần descope, ghi vào journal kèm lý do. Trong báo cáo, trình bày dưới dạng giới hạn phạm vi đã xác định
chứ không phải hạng mục chưa hoàn thành. Một đồ án nêu rõ phạm vi và cơ sở giới hạn phạm vi có chất lượng
trình bày cao hơn một đồ án triển khai dở dang nhiều hạng mục.
