## 1. Preparation — Tạo cấu trúc mới và content inventory

- [x] 1.1 Tạo cây thư mục mới: `blueprint/{decisions,architecture,contracts,contracts/schemas,contracts/examples,security,evaluation}` với các file placeholder.
- [x] 1.2 Tạo content inventory: bảng mapping mỗi file cũ → file mới + ghi chú section nào giữ/bỏ/gộp. Lưu vào scratch file để dùng làm checklist đối chiếu.

## 2. Core Architecture Files — Gộp architecture/

- [x] 2.1 Tạo `architecture/system-overview.md`: gộp nội dung từ `system-context.md` + `components-and-ownership.md` + `desktop-runtime-topology.md` + `containers-and-trust-boundaries.md`. Giữ Mermaid diagrams, capability ownership table, process composition table.
- [x] 2.2 Tạo `architecture/module-layout.md`: gộp nội dung từ `physical-repository-layout.md` + `agent-runtime-boundaries.md` + `scorer-isolation-boundary.md`. Giữ target implementation tree, import matrix, deny matrix.
- [x] 2.3 Tạo `architecture/sequences.md`: gộp nội dung từ `end-to-end-sequences.md` + `judge-lifecycle.md`. Giữ sequence diagrams, transition table, error/recovery flows.
- [x] 2.4 Gộp nội dung persistence (`erd.md`, `field-dictionary.md`, `consistency-and-idempotency.md`) vào `architecture/system-overview.md` (section "Persistence Model") hoặc giữ riêng nếu quá dài.

## 3. Decisions — Gộp ADR files

- [x] 3.1 Tạo `decisions/architecture-decisions.md`: gộp ADR-001 đến ADR-007. Mỗi ADR thành H2 section giữ nguyên: Status, Context, Decision, Consequences, Alternatives Considered. Thêm note "Consolidated from ADR-00X" ở đầu mỗi section.
- [x] 3.2 Xóa `decisions/ADR-000-template.md` và `decisions/README.md` (nội dung hướng dẫn tích hợp vào README chính).

## 4. Contracts — (Đã loại bỏ)

(Task gộp contracts đã được loại bỏ, toàn bộ thư mục `contracts/` sẽ bị xóa hoàn toàn ở bước Cleanup).

## 5. Security — (Đã loại bỏ)

(Task gộp security đã được loại bỏ, toàn bộ thư mục `security/` sẽ bị xóa hoàn toàn ở bước Cleanup. Nội dung Ground-Truth Isolation sẽ được cập nhật thủ công vào architecture/module-layout.md và evaluation/methodology.md ở các task 2.2 và 6.1).

## 6. Evaluation — Gộp evaluation/

- [x] 6.1 Tạo `evaluation/methodology.md`: gộp nội dung từ `baseline-protocol.md` + `scoring-and-reporting.md` + `validity-gates.md` + `flags-and-ablation.yaml` (chuyển thành section mô tả) + `paired-logical-token-examples.md` + `source-bundle-v1.md`.
- [x] 6.2 Tạo `evaluation/experiment-profile.md`: gộp nội dung từ `contest-manifest.md` + `rq1-confirmatory-v1.profile.yaml` (chuyển thành section mô tả) + tóm tắt nội dung prompts.
- [x] 6.3 Xóa thư mục `evaluation/examples/` (14 files) và `evaluation/prompts/` (3 files). Tích hợp 1-2 examples quan trọng nhất inline trong methodology.md.
- [x] 6.4 Xóa hoàn toàn 2 file JSON schema cũ (`contest-manifest.schema.json`, `experiment-profile.schema.json`) trong `evaluation/` để đảm bảo thư mục `evaluation/` chỉ còn 2 file markdown normative.

## 7. Cleanup — Xóa files cũ và thư mục dư thừa

- [x] 7.1 Xóa hoàn toàn thư mục `delivery/` (8 files): requirement-traceability, normative-backreferences, validation-report, scope-audit, implementation-work-packages, dependency-and-ownership, extension-roadmap, tv1-tv6-timeline. Nội dung work-packages cần thiết đã nằm trong openspec tasks.
- [x] 7.2 Xóa `manifest.yaml` và `manifest-format.md`.
- [x] 7.3 Xóa thư mục `providers/` (4 files) — nội dung đã gộp vào contracts/domain-model.md.
- [x] 7.4 Xóa thư mục `desktop/` (6 files) — nội dung đã gộp vào architecture/system-overview.md.
- [x] 7.5 Xóa thư mục `persistence/` — nội dung đã gộp vào architecture/.
- [x] 7.6 Xóa các file architecture/ cũ đã được gộp.
- [x] 7.7 Xóa hoàn toàn thư mục `contracts/` (10 files) — nội dung sẽ được định nghĩa lại sau khi thực tế implement.
- [x] 7.8 Xóa hoàn toàn thư mục `security/` (6 files) — boilerplate không còn cần thiết.

## 8. README & Cross-references — Cập nhật navigation

- [x] 8.1 Viết lại `blueprint/README.md`: mục lục đầy đủ mới, reading order, non-negotiable invariants (giữ từ README cũ), và old-to-new path mapping table.
- [x] 8.2 Cập nhật `vocabulary.md`: review và xóa references đến file paths cũ nếu có.
- [x] 8.3 Cập nhật cross-references trong `docs/` pointing vào blueprint paths cũ.
- [x] 8.4 Cập nhật `openspec/config.yaml` context nếu cần.

## 9. Verification — Kiểm tra tính đầy đủ

- [x] 9.1 Đếm file normative trong `blueprint/` mới: verify ≤ 10 files.
- [x] 9.2 Verify không có thư mục sâu quá 2 cấp (`blueprint/<section>/<file>`).
- [x] 9.3 Verify mọi file trong blueprint/ được liệt kê trong README.md.
- [x] 9.4 Grep kiểm tra: không còn đường dẫn cũ (ví dụ: `delivery/requirement-traceability.md`) trong bất kỳ file nào trong repo.
- [x] 9.5 Verify nội dung ADR-001 đến ADR-007 còn nguyên vẹn (decision status, rationale, alternatives).
- [x] 9.6 Verify ground-truth isolation boundary rules vẫn có mặt rõ ràng.
