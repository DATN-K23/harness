# Blueprint Structure Delta

## MODIFIED Requirements

### Requirement: Blueprint SHALL have flat-first directory structure
Blueprint MUST tổ chức theo cấu trúc phẳng ưu tiên, tối đa 2 cấp thư mục (gốc + 1 cấp con). Không được có nested subdirectories sâu hơn 1 cấp. Thư mục mã nguồn `packages/core/src/` MUST tổ chức theo các capability: `source/` (snapshot), `tool/` (công cụ đọc), `context/` (ngữ cảnh), `execution/` (permission, quản lý tiến trình và môi trường thực thi trên host), `verification/` (chuẩn bị PoC và diễn giải kết quả), `judge/`, `audit/`, và `eval/`. Capability `sandbox/` cũ SHALL được loại bỏ. Việc thay execution backend SHALL giữ quyền chỉ đọc của Judge production và ranh giới scorer, không mở quyền shell cho agent.

#### Scenario: No deeply nested directories
- **WHEN** duyệt cây thư mục `blueprint/`
- **THEN** không có file nào nằm sâu quá `blueprint/<section>/<file>` (tức là KHÔNG có `blueprint/a/b/c.md`)

#### Scenario: Core source modules align with capability layout
- **WHEN** kiểm tra cấu trúc thư mục `packages/core/src/`
- **THEN** các module `source/`, `tool/`, `context/`, `execution/`, `verification/`, `judge/`, `audit/`, và `eval/` được tổ chức theo ranh giới capability; `sandbox/` không còn là capability thực thi

#### Scenario: Backend replacement preserves authority
- **GIVEN** local execution được thêm vào core
- **WHEN** kiểm tra composition và public imports
- **THEN** server/CLI chỉ compose public operations, Judge production không nhận generic shell executor, và scorer credentials không đi vào tiến trình kiểm chứng
