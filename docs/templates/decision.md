# [Tiêu đề quyết định]

*Sao chép thành `docs/decisions/YYYY-MM-DD-slug.md`. Giới hạn nửa trang.*

---

**Ngày:** YYYY-MM-DD
**Người quyết định:** TV_ (+ những ai tham gia thảo luận)
**Trạng thái:** Đang áp dụng / Đã thay thế bởi [decision khác]

## Bối cảnh

*Vấn đề cần giải quyết và ràng buộc tại thời điểm quyết định.*

>

## Các phương án đã cân nhắc

| Phương án | Ưu điểm | Nhược điểm |
|---|---|---|
| | | |
| | | |

## Quyết định

>

## Cơ sở

*Vì sao phương án này phù hợp hơn trong bối cảnh của đồ án.*

>

## Đánh đổi đã chấp nhận

*Rủi ro đã biết và biện pháp giảm thiểu.*

>

---

### Ví dụ tham khảo

> **Dùng LiteLLM thay vì tự triển khai provider adapter**
>
> **Bối cảnh:** RQ3 yêu cầu chạy trên tối thiểu 4 provider.
>
> **Phương án:** (a) Tự viết 4 adapter — kiểm soát tốt nhưng ước tính 2 tuần phát triển cộng chi phí bảo trì
> cả năm. (b) LiteLLM — khoảng 2 ngày tích hợp, đổi lại phụ thuộc thư viện bên ngoài.
>
> **Quyết định:** LiteLLM.
>
> **Cơ sở:** Đóng góp của đồ án nằm ở harness, không nằm ở lớp tích hợp provider. Hai tuần tiết kiệm được
> phân bổ cho verification layer, là thành phần có giá trị đóng góp cao hơn.
>
> **Đánh đổi:** Phụ thuộc vào tính ổn định của LiteLLM. Giảm thiểu bằng cách bọc sau một interface nội bộ để
> có thể thay thế khi cần.
