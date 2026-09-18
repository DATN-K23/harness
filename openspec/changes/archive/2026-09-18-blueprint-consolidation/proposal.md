## Why

Blueprint hiện tại (`blueprint/`) chứa 97 file (~7000 dòng) được sinh ra bởi AI trong một lần bootstrap duy nhất. Kết quả là một khối tài liệu thiết kế khổng lồ, trong đó nhiều file lặp lại nội dung lẫn nhau (ví dụ: `requirement-traceability.md`, `normative-backreferences.md`, `validation-report.md`, `scope-audit.md` đều cross-reference cùng một tập yêu cầu), nhiều file mô tả chi tiết implementation chưa tồn tại (desktop/Tauri 2 wireframes, OpenAPI 523 dòng cho API chưa có backend), và manifest 598 dòng theo dõi SHA-256 digest cho từng file — tạo overhead bảo trì cực lớn mỗi khi sửa bất kỳ file nào.

Vấn đề cốt lõi:
- **Cognitive overload**: Developer mới mất hàng giờ chỉ để tìm được tài liệu liên quan trong 97 file.
- **Chi phí bảo trì cao**: Mỗi thay đổi nhỏ cần cập nhật manifest digest + multiple cross-reference files.
- **Nội dung dư thừa**: Nhiều file chứa nội dung trùng lặp hoặc quá chi tiết cho giai đoạn hiện tại (chưa có implementation).
- **Rào cản tiến triển**: Thay vì giúp implement, blueprint trở thành gánh nặng phải maintain.

## What Changes

- **Gộp và giảm số lượng file**: Từ 97 file → mục tiêu ~8-12 file cốt lõi, tổ chức lại thành cấu trúc phẳng hơn.
- **Loại bỏ nội dung dư thừa và chưa cần thiết**: Xóa các file cross-reference/traceability thuần meta. Xóa bỏ hoàn toàn phần `contracts/` và các boilerplate `security/` (chỉ giữ lại nguyên tắc Ground-truth Isolation) vì chưa thực sự cần thiết trong giai đoạn này.
- **Đơn giản hóa manifest**: Từ manifest 598 dòng với SHA-256 digest → đơn giản hóa hoặc loại bỏ hoàn toàn, thay bằng README index.
- **Giữ nguyên các quyết định kiến trúc cốt lõi (ADR)**: ADR-001 đến ADR-007 vẫn giữ nguyên nhưng gộp vào ít file hơn nếu có thể.
- **Tái cấu trúc theo nguyên tắc blueprint skill**: Tổ chức theo frontstage/backstage/support layers, tập trung vào service blueprint, dependency map, và process architecture.
- **BREAKING**: File paths trong `blueprint/` sẽ thay đổi hoàn toàn. Bất kỳ reference nào đến file paths cũ trong codebase sẽ cần cập nhật. Cấu trúc cũ của `contracts/` sẽ bị xóa bỏ hoàn toàn.

## Capabilities

### New Capabilities
- `blueprint-structure`: Định nghĩa cấu trúc mới cho thư mục `blueprint/` với số lượng file tối thiểu, tổ chức rõ ràng, và dễ navigate.

### Modified Capabilities
_(Không có spec hiện tại nào bị thay đổi ở mức requirement — đây là thay đổi tổ chức tài liệu, không phải thay đổi hành vi hệ thống.)_

## Impact

- **`blueprint/`**: Toàn bộ thư mục sẽ được tái cấu trúc. Tất cả 97 file hiện tại sẽ được gộp/loại bỏ/viết lại.
- **`openspec/config.yaml`**: Context có thể cần cập nhật để phản ánh cấu trúc blueprint mới.
- **`docs/`**: Các file trong docs tham chiếu đến blueprint paths sẽ cần cập nhật links.
- **Không ảnh hưởng implementation code**: Vì chưa có implementation code nào phụ thuộc vào blueprint file paths.
