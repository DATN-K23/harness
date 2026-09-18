# Hướng Dẫn Đọc Blueprint Mới (Phiên bản tinh gọn)

> **Lưu ý:** File này được tạo tạm thời để bạn có cái nhìn tổng quan bằng tiếng Việt về cấu trúc Blueprint mới nhất (< 10 file). Bạn có thể xóa file này sau khi đọc xong.

---

Sau quá trình tái cấu trúc, Blueprint hiện tại đã được loại bỏ hoàn toàn các siêu dữ liệu dư thừa (metadata) và các thư mục không chứa thông tin cốt lõi (như `delivery/`, `contracts/`, `security/`, `desktop/`...). 

Hệ thống Blueprint mới được chia thành **3 nhóm cốt lõi**:

## 1. Quyết định Kiến trúc (Decisions)

📁 **`decisions/architecture-decisions.md`**
- **Nội dung:** Gộp toàn bộ 7 bản ghi quyết định kiến trúc (ADR-001 đến ADR-007) thành một file duy nhất.
- **Tác dụng:** Giúp người đọc hiểu ngay các quyết định thiết kế lớn trong quá khứ mà không phải lật qua lại hàng chục file nhỏ. Nó giải thích *tại sao* chúng ta lại chọn Python, Postgres, Tauri, v.v.

## 2. Kiến trúc Hệ thống (Architecture)

Thư mục này trả lời câu hỏi: *"Hệ thống chạy như thế nào? Cấu trúc ra sao?"*

📁 **`architecture/system-overview.md`**
- **Nội dung:** Gộp Topology (cấu trúc mạng), Components (các thành phần), Desktop (giao diện) và Persistence (Database ERD, model lưu trữ).
- **Tác dụng:** Là bản đồ toàn cảnh của dự án. Nhìn vào đây bạn sẽ thấy các process giao tiếp với nhau như thế nào và dữ liệu được lưu xuống Postgres ra sao.

📁 **`architecture/module-layout.md`**
- **Nội dung:** Gộp cấu trúc thư mục vật lý (physical layout) và các quy tắc cách ly (boundaries). Đặc biệt, **Ground-Truth Isolation** (Cách ly dữ liệu đáp án gốc) đã được tích hợp thẳng vào đây như một quy tắc sống còn không thể bị phá vỡ.
- **Tác dụng:** Hướng dẫn Dev biết phải viết code ở thư mục nào, module nào được phép import module nào, và khu vực nào bị cấm truy cập (để đảm bảo tính công bằng khi chấm điểm AI).

📁 **`architecture/sequences.md`**
- **Nội dung:** Sơ đồ luồng (Flows) và vòng đời (Lifecycle) của Judge.
- **Tác dụng:** Hiểu được từng bước từ lúc user gửi 1 request chấm điểm cho đến lúc nhận kết quả, bao gồm cả các luồng xử lý lỗi và phục hồi.

## 3. Khung Đánh giá (Evaluation)

Thư mục này là **linh hồn của dự án Harness**. Nó trả lời câu hỏi: *"Dự án này sinh ra để chấm điểm AI như thế nào?"*

📁 **`evaluation/methodology.md`**
- **Nội dung:** Bộ luật chấm điểm bất di bất dịch. Gồm Protocol (giao thức baseline), Scoring (công thức tính điểm, Precision/Recall), Validity gates (các cổng kiểm duyệt hợp lệ), và luồng di chuyển của dữ liệu Ground-Truth.
- **Tác dụng:** Giúp bất cứ ai (dù là dev hay researcher) đều hiểu cách Harness kết luận AI đúng hay sai.

📁 **`evaluation/experiment-profile.md`**
- **Nội dung:** Các cấu hình thí nghiệm cụ thể (Ví dụ: Chạy bộ dữ liệu nào, dùng prompt gì, giới hạn chi phí ra sao).
- **Tác dụng:** Khác với methodology (bộ luật chung), profile này là cấu hình thay đổi theo từng đợt chạy thí nghiệm.

---

### Các thay đổi lớn so với bản cũ
1. **Xóa các file schema (`contracts/*`, `*.schema.json`)**: Các schema JSON cũ đã bị xóa bỏ. Toàn bộ API/data schema sẽ được định nghĩa trực tiếp bằng code (Pydantic / OpenAPI / TypeScript interfaces) trong giai đoạn implement thay vì viết bằng file schema JSON rời.
2. **Xóa `security/`**: Boilerplate về bảo mật bị loại bỏ, những luật sống còn (như cách ly Ground-Truth) đã được nhúng thẳng vào file kiến trúc và đánh giá.
3. **Xóa `delivery/`**: Việc theo dõi task, timeline, scope đã được nhường lại cho công cụ quản lý dự án (như OpenSpec tasks). Blueprint giờ chỉ tập trung 100% vào thiết kế kỹ thuật.

### Lộ trình đọc gợi ý:
1. Đọc **README** ở cấp root.
2. Đọc **system-overview.md** để nắm toàn cảnh.
3. Đọc **methodology.md** để hiểu cách Harness chấm điểm.
4. (Tùy chọn) Xem qua **architecture-decisions.md** nếu thắc mắc tại sao lại chọn công nghệ nào đó.
