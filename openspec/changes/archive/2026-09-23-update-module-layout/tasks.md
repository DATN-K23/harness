## 1. System Overview & README

- [x] 1.1 Thêm phần "System Overview" vào `blueprint/README.md` — mô tả high-level Harness là gì, RQ1, và system boundary.
- [x] 1.2 Cập nhật "What is decided" trong README sang TypeScript/Bun monorepo.
- [x] 1.3 Xóa `Owners: TV1–TV6` và bảng "Old-to-New Path Mapping" trong README.
- [x] 1.4 Cập nhật "Package map" trong README cho khớp với monorepo mới.

## 2. Module Layout

- [x] 2.1 Thêm paragraph System Overview ở đầu `architecture/module-layout.md`.
- [x] 2.2 Tinh chỉnh mô tả package cho phù hợp domain Judge evaluation.

## 3. Architecture Decisions

- [x] 3.1 Xóa tất cả `Owner: TVx` / `collaborators: TVx` trong mọi ADR header (ADR-001 → ADR-007).
- [x] 3.2 Thêm ADR-008: Technology Stack Migration (supersede ADR-001, ADR-004).
- [x] 3.3 Cập nhật ADR-004 status → `Superseded by ADR-008`.
- [x] 3.4 Cập nhật ADR-005 từ Python capability-first → package-based TypeScript monorepo.

## 4. System Overview File

- [x] 4.1 Xóa tất cả ownership metadata trong `architecture/system-overview.md`.
- [x] 4.2 Cập nhật tech-specific references (FastAPI → HTTP server, SQLAlchemy → Drizzle, v.v.).

## 5. Supporting Files

- [x] 5.1 Xóa ownership trong `vocabulary.md`, cập nhật stack terminology.
- [x] 5.2 Xóa ownership headers trong `evaluation/methodology.md`.
- [x] 5.3 Xóa ownership headers trong `evaluation/experiment-profile.md`.

## 6. Verification

- [x] 6.1 Grep toàn bộ `blueprint/` cho "TV1", "TV2", "Owner:" để đảm bảo không còn sót.

## 7. Evaluation Deletion

- [x] 7.1 Xóa toàn bộ thư mục `blueprint/evaluation/`.
- [x] 7.2 Xóa references tới `evaluation` và `scoring` capability trong `blueprint/architecture/system-overview.md` và `blueprint/README.md`.
