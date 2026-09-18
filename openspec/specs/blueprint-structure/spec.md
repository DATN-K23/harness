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
