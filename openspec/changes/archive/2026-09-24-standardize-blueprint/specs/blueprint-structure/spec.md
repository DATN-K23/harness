## ADDED Requirements

### Requirement: Blueprint SHALL maintain consistent core identity across all documents
Tất cả các tài liệu trong `blueprint/` MUST nhất quán định nghĩa hệ thống là khung tác tử AI (AI Agent framework) cho bảo mật Smart Contract hoạt động ở 2 chế độ chính: Audit Mode và Judge Mode. Blueprint MUST KHÔNG chứa các tham chiếu lỗi thời đến nghiên cứu so sánh RQ1 hay các cơ chế lập lịch so khớp direct/harness arm trong tài liệu sản phẩm.

#### Scenario: No legacy RQ1 references found
- **WHEN** tìm kiếm các thuật ngữ "RQ1", "primary RQ1 profile", hoặc "matched direct and harness calls" trong thư mục `blueprint/`
- **THEN** không có kết quả nào xuất hiện trong các tài liệu kiến trúc chuẩn mực

#### Scenario: Dual mode definition consistent
- **WHEN** kiểm tra phần tổng quan của `blueprint/README.md`, `blueprint/architecture/system-overview.md`, và `blueprint/architecture/module-layout.md`
- **THEN** tất cả đều thống nhất định nghĩa hai chế độ vận hành: Audit Mode và Judge Mode

### Requirement: Blueprint SHALL maintain uniform desktop and datastore technical stack
Blueprint MUST thống nhất chọn Tauri 2 (theo ADR-007) làm desktop application wrapper và PostgreSQL (thông qua Drizzle ORM trong `packages/schema`) làm authoritative datastore duy nhất trên toàn bộ các tài liệu.

#### Scenario: Uniform desktop wrapper reference
- **WHEN** kiểm tra các đề cập đến desktop wrapper trong `blueprint/README.md`, `blueprint/architecture/module-layout.md`, `blueprint/architecture/sequences.md`, và `blueprint/decisions/architecture-decisions.md`
- **THEN** tất cả đều thống nhất là Tauri 2, không còn tham chiếu Electron mâu thuẫn

#### Scenario: Authoritative datastore via Drizzle ORM
- **WHEN** kiểm tra định nghĩa lưu trữ và cơ sở dữ liệu trong `blueprint/decisions/architecture-decisions.md` (ADR-008) và `blueprint/architecture/system-overview.md`
- **THEN** PostgreSQL được xác nhận là authoritative datastore duy nhất và được quản lý schema thông qua Drizzle ORM

### Requirement: Blueprint SHALL present architectural flows at high level
Sơ đồ tuần tự và tương tác kiến trúc trong `blueprint/architecture/sequences.md` MUST giữ ở mức tổng quan (high-level), thể hiện rõ luồng dữ liệu cho cả Audit Mode và Judge Mode, đồng thời loại bỏ các chi tiết triển khai mức quá thấp (như cơ chế cập nhật nhị phân hệ điều hành có chữ ký số hoặc logic PoC runner chi tiết).

#### Scenario: Audit mode high-level sequence exists
- **WHEN** kiểm tra `blueprint/architecture/sequences.md`
- **THEN** tồn tại sơ đồ tuần tự mức cao mô tả luồng Audit Mode từ khi nạp repository smart contract đến khi xuất báo cáo findings

#### Scenario: Premature OS update coordination removed
- **WHEN** kiểm tra `blueprint/architecture/sequences.md`
- **THEN** sơ đồ `Coordinated signed update` mức hệ điều hành được loại bỏ để tập trung vào kiến trúc runtime của Agent
