# Spec Delta: blueprint-structure

## MODIFIED Requirements

### Requirement: Blueprint SHALL have flat-first directory structure
Blueprint MUST tổ chức theo cấu trúc phẳng ưu tiên, tối đa 2 cấp thư mục (gốc + 1 cấp con). Không được có nested subdirectories sâu hơn 1 cấp. Thư mục mã nguồn `packages/core/src/` MUST tổ chức theo các khối capability được định nghĩa trong kiến trúc tổng quan: `source/` (quản lý snapshot), `tool/` (công cụ đọc mã nguồn), `context/` (rút gọn ngữ cảnh và token), `sandbox/` (môi trường thực thi an toàn), `judge/` (chế độ Judge), `audit/` (chế độ Audit), và `eval/` (bộ đánh giá thực nghiệm).

#### Scenario: No deeply nested directories
- **WHEN** duyệt cây thư mục `blueprint/`
- **THEN** không có file nào nằm sâu quá `blueprint/<section>/<file>` (tức là KHÔNG có `blueprint/a/b/c.md`)

#### Scenario: Core source modules align with capability layout
- **WHEN** kiểm tra cấu trúc thư mục `packages/core/src/`
- **THEN** các module `source/`, `tool/`, `context/`, `sandbox/`, `judge/`, `audit/`, và `eval/` được tổ chức độc lập theo đúng ranh giới capability của blueprint
