# Blueprint Structure

## Purpose

Định nghĩa cấu trúc tổ chức mới cho thư mục `blueprint/`, giảm thiểu số lượng file và loại bỏ nội dung dư thừa, giúp developer dễ navigate và maintain.

## Requirements

### Requirement: Blueprint SHALL contain no more than 10 normative files
Thư mục `blueprint/` MUST chứa tối đa 10 file normative (markdown, schema, YAML). Các file example/fixture có thể tồn tại thêm nhưng không được tính vào giới hạn này.

#### Scenario: File count within limit
- **WHEN** thư mục `blueprint/` được liệt kê đệ quy và đếm các file normative (loại trừ examples)
- **THEN** tổng số file bản mẫu MUST nhỏ hơn hoặc bằng 10

### Requirement: Blueprint SHALL have flat-first directory structure
Blueprint MUST tổ chức theo cấu trúc phẳng ưu tiên, tối đa 2 cấp thư mục (gốc + 1 cấp con). Không được có nested subdirectories sâu hơn 1 cấp.

#### Scenario: No deeply nested directories
- **WHEN** duyệt cây thư mục `blueprint/`
- **THEN** không có file nào nằm sâu quá `blueprint/<section>/<file>` (tức là KHÔNG có `blueprint/a/b/c.md`)

### Requirement: Blueprint SHALL preserve ADR decisions
Tất cả Architecture Decision Records (ADR-001 đến ADR-007) hiện tại MUST được giữ nguyên nội dung quyết định cốt lõi. Có thể gộp vào ít file hơn nhưng nội dung decision status (Accepted/Proposed) và rationale MUST không bị mất.

#### Scenario: ADR content preserved after consolidation
- **WHEN** so sánh nội dung các ADR trước và sau consolidation
- **THEN** mỗi ADR (001-007) MUST có decision status, chosen option, rationale, và rejected alternatives được giữ nguyên trong cấu trúc mới

### Requirement: Blueprint SHALL not duplicate content across files
Mỗi khái niệm, quy tắc, hoặc quyết định kiến trúc MUST được định nghĩa tại đúng một vị trí. Các file khác muốn tham chiếu MUST sử dụng cross-reference link thay vì sao chép nội dung.

#### Scenario: No content duplication found
- **WHEN** tìm kiếm một requirement ID (ví dụ: ORCH-01) hoặc thuật ngữ kỹ thuật cốt lõi (ví dụ: GroundTruthLabel boundary) trong toàn bộ blueprint
- **THEN** định nghĩa chi tiết MUST chỉ xuất hiện tại đúng một file, các file khác chỉ chứa cross-reference link

### Requirement: Blueprint README SHALL serve as navigation index
File `blueprint/README.md` MUST chứa mục lục đầy đủ với mô tả ngắn và đường dẫn đến mọi file trong blueprint. README thay thế vai trò của manifest cũ làm "source of truth" cho danh sách artifacts.

#### Scenario: README covers all blueprint files
- **WHEN** liệt kê tất cả file trong `blueprint/` (trừ README.md)
- **THEN** mỗi file MUST được liệt kê trong README.md kèm mô tả ngắn gọn

### Requirement: Blueprint SHALL eliminate pure-meta files
Các file chỉ chứa meta-information mà không có nội dung kỹ thuật độc lập (manifest.yaml, manifest-format.md, validation-report.md, scope-audit.md, normative-backreferences.md) MUST bị loại bỏ hoặc gộp vào các file có nội dung cốt lõi.

#### Scenario: No standalone meta-only files exist
- **WHEN** kiểm tra danh sách file trong `blueprint/`
- **THEN** MUST không tồn tại file nào mà nội dung chỉ là cross-referencing, traceability matrix, hoặc digest tracking mà không kèm nội dung kỹ thuật cốt lõi

### Requirement: Blueprint SHALL maintain ground-truth isolation documentation
Tài liệu về ground-truth isolation boundary (GroundTruthLabel chỉ đến scorer, không bao giờ vào agent/provider/tool/desktop paths) MUST được giữ nguyên ở dạng rõ ràng trong cấu trúc mới, vì đây là invariant an toàn không thể bỏ qua.

#### Scenario: Ground-truth isolation rules findable
- **WHEN** developer tìm kiếm quy tắc về ground-truth isolation trong blueprint mới
- **THEN** MUST tìm thấy section rõ ràng mô tả boundary rules trong tối đa 1 file, với nội dung tương đương phần hiện tại trong `security/ground-truth-flow-audit.md` và `security/data-classification.md`

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

