## Why

Blueprint hiện tại thiếu 3 thứ quan trọng:

1. **Thiếu System Overview** — Không có phần mô tả high-level để người đọc (human hoặc AI agent) hiểu ngay Harness là gì, làm gì, và ý tưởng chính của hệ thống.
2. **Module layout chưa đồng bộ** — Module layout đã được cập nhật sang 10-package TypeScript/Bun monorepo, nhưng phần còn lại của blueprint (README, system-overview, vocabulary, ADRs) vẫn tham chiếu Python/FastAPI/Tauri stack cũ và chưa phản ánh kiến trúc mới.
3. **Ownership metadata rải khắp nơi** — Các tham chiếu TV1–TV6 xuất hiện trong hầu hết mọi file blueprint (README, system-overview, vocabulary, ADRs), không chỉ module-layout. Blueprint phải là tài liệu overview kiến trúc, không phải nơi chia task.

## What Changes

### Blueprint Files

- **`README.md`**: Thêm phần System Overview mô tả Harness ở mức high-level. Cập nhật "What is decided" sang TypeScript/Bun. Xóa `Owners: TV1–TV6`. Xóa bảng Old-to-New Path Mapping (không còn relevant).

- **`architecture/module-layout.md`**: Thêm paragraph System Overview ở đầu file. Tinh chỉnh mô tả package cho phù hợp domain Judge evaluation.

- **`decisions/architecture-decisions.md`**: Xóa tất cả `Owner: TVx` và `collaborators: TVx` trong mọi ADR header. Thêm ADR-008 supersede ADR-001 (migration từ Python → TypeScript/Bun). Cập nhật status ADR-004 thành `Superseded by ADR-008`. Cập nhật ADR-005 cho package-based structure.

- **`architecture/system-overview.md`**: Xóa tất cả ownership metadata (`Owner: TVx`, `collaborators: TVx`). Giữ nguyên diagrams và invariants (chúng vẫn đúng về mặt domain). Trim các tham chiếu tech-specific (FastAPI → HTTP server, SQLAlchemy → Drizzle) khi cần.

- **`vocabulary.md`**: Xóa ownership. Cập nhật terminology stack-specific (capability-first Python monolith → package-based TypeScript monorepo).

- **`evaluation/`**: Xóa toàn bộ thư mục evaluation (`methodology.md` và `experiment-profile.md`) vì framework đánh giá này quá phức tạp và không cần thiết cho phạm vi của đồ án hiện tại.

### ADR Impact

ADR-001 (Python stack) và ADR-004 (opencode as reference-only) sẽ bị supersede bởi ADR-008 mới. ADR-005 (capability-first modular monolith) sẽ được cập nhật thành package-based monorepo. ADR-002, ADR-003, ADR-006, ADR-007 giữ nguyên nội dung core, chỉ xóa ownership metadata.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- None. (This is a pure architectural documentation update. `skip_specs: true` in `.openspec.yaml`.)

## Impact

- Toàn bộ blueprint directory sẽ được cập nhật cho consistent.
- Mọi TV1-TV6 reference sẽ bị xóa.
- ADRs sẽ được align với kiến trúc TypeScript/Bun monorepo mới.
- Developers và AI agents sẽ có một blueprint overview rõ ràng và nhất quán.
