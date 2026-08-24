---
id: audit-tv6-001
type: research
status: completed
created: 2026-08-25
---

# Báo cáo Phân tích & Phản biện (Audit) - Hạng mục TV6

**Thực hiện:** Khảo sát Codebase Tự động
**Phạm vi:** Phân tích mức độ tuân thủ kiến trúc của hạng mục TV6 (API, Persistence, Desktop, Demo UI).
**Căn cứ:** Quyết định kiến trúc hệ thống (`docs/06-blueprint-guide-vi.md`, `ADR-006`, `ADR-007`).

## 1. Vai trò và Yêu cầu thiết kế đối với TV6
Theo `docs/06-blueprint-guide-vi.md` và các ADR đã được phê duyệt, TV6 chịu trách nhiệm về phần việc:
- **Runtime API:** Kiến trúc "a local headless runtime bundle... from one Python modular-monolith source".
- **Cơ sở dữ liệu (Persistence):** "PostgreSQL as the durable run/job/event/evaluation authority" (Nghiêm cấm thay thế lén lút bằng embedded SQLite).
- **Desktop Client:** Sử dụng **Tauri 2** (Rust) làm OS adapter, frontend Web (React/Vite) làm renderer, hoạt động dựa trên mô hình Desktop Client giao tiếp Local API. Giao diện frontend không có quyền truy cập trực tiếp file system.

## 2. Kết quả đối chiếu với Thực trạng Codebase (Implementation)

Hiện tại, quá trình audit phát hiện **các vi phạm kiến trúc (Architecture Violations) cực kỳ nghiêm trọng** đang tồn tại trong code do TV6 phụ trách:

### ⚠️ Vi phạm 1: Sai lệch Tech Stack Backend (Python vs Node.js)
- **Thiết kế (ADR-006):** Yêu cầu local API/backend phải chạy trong một "Python modular-monolith".
- **Thực trạng:** Ứng dụng API hiện tại nằm ở thư mục `apps/api/` lại đang được viết bằng **Node.js, NestJS** (TypeScript). Sự thay đổi framework lõi này chưa có bất kỳ Architecture Decision Record (superseding ADR) nào phê duyệt.

### ⚠️ Vi phạm 2: Hạ tầng Cơ sở dữ liệu bị thay đổi (PostgreSQL vs SQLite)
- **Thiết kế (ADR-006):** Quy định hệ thống phải chạy trên **PostgreSQL**, nghiêm cấm việc dùng SQLite nhúng để đơn giản hóa quá trình đóng gói MVP ("PostgreSQL is not silently replaced by embedded SQLite to simplify packaging").
- **Thực trạng:** File cấu hình `apps/api/prisma/schema.prisma` đang sử dụng `provider = "sqlite"` cùng biến môi trường `DATABASE_URL="file:./dev.db"`. Đây là vi phạm cam kết bảo vệ dữ liệu runtime độc lập.

### ⚠️ Vi phạm 3: Trái với kiến trúc Desktop App Tauri 2
- **Thiết kế (ADR-007):** Ứng dụng Desktop phải được đóng gói bằng Tauri 2 và nằm gọn dưới thư mục cấu hình kiểu `apps/desktop/src-tauri` và `apps/desktop/ui`.
- **Thực trạng:** Toàn bộ thư mục `apps/` chỉ chứa `api` (NestJS) và `web` (React/Vite). Frontend `apps/web/` đang được cài đặt như một ứng dụng Web thông thường (có thể chạy trên trình duyệt web server) chứ không hề có Tauri Native Shell bọc bên ngoài.
- **Điểm mỉa mai:** Tại file `apps/web/src/App.tsx`, component Header tự tin hiển thị nhãn UI `"TV6 Spec Compliant"` - trong khi toàn bộ nền tảng bên dưới hoàn toàn sai lệch so với Spec.

## 3. Kết luận và Khuyến nghị

Codebase hiện tại của TV6 đang triển khai theo hướng "Làm cho nhanh - Dùng Web Stack Node.js/SQLite quen thuộc", đi ngược lại hoàn toàn với chiến lược kiến trúc an toàn, bảo mật và phân chia tiến trình độc lập bằng Python/Tauri 2 của hệ sinh thái.

**Action Items bắt buộc:**
TV6 cần ngay lập tức dừng các phát triển tính năng mới và thực hiện tái cấu trúc để đưa dự án về đúng thiết kế gốc (hoặc phải viết ADR trình bày lí do và xin phép đổi stack):
1. **Backend / API:** Đập bỏ `apps/api` (NestJS) và khởi tạo lại Local API bằng Python (vd: FastAPI/Litestar) để tích hợp nguyên khối với các logic Agent worker do TV1-TV5 phụ trách.
2. **Database:** Cấu hình lại cơ sở dữ liệu về `PostgreSQL` đúng như cam kết, loại bỏ SQLite.
3. **Desktop:** Khởi tạo `apps/desktop` theo chuẩn Tauri 2, dịch chuyển toàn bộ giao diện từ `apps/web` sang làm Renderer nội bộ cho Tauri.
