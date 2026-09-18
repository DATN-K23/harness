## Context

Blueprint hiện tại gồm 97 file (~7000 dòng) phân bố trong 9 thư mục con, với manifest 598 dòng theo dõi SHA-256 digest. Xem proposal.md cho động lực chi tiết.

Cấu trúc hiện tại:
```
blueprint/                     # 97 files, ~7000 lines
├── README.md, vocabulary.md, manifest-format.md, manifest.yaml
├── decisions/       (9 files)  ADR-000..007 + README
├── architecture/    (9 files)  system views, layouts, boundaries
├── contracts/       (10 files) OpenAPI, schemas, domain model, examples/
├── providers/       (4 files)  profiles, conformance
├── persistence/     (3 files)  ERD, field dictionary, consistency
├── security/        (6 files)  threat model, data classification, audit
├── evaluation/      (12 files) protocol, flags, prompts, examples/
├── desktop/         (6 files)  wireframes, connection, states
└── delivery/        (8 files)  traceability, work packages, validation
```

Vấn đề: Nhiều file chỉ chứa cross-reference metadata (normative-backreferences, scope-audit, validation-report), nội dung lặp lại giữa các section, và mức chi tiết quá sâu cho giai đoạn chưa có implementation.

## Goals / Non-Goals

**Goals:**
- Giảm blueprint xuống ~10-15 file cốt lõi mà vẫn giữ tất cả quyết định kiến trúc quan trọng
- Tổ chức theo dạng dễ navigate: developer mới tìm được tài liệu cần trong dưới 2 phút
- Loại bỏ overhead maintain digest/manifest
- Áp dụng nguyên tắc service blueprint: phân tầng frontstage (user-facing) / backstage (internal) / support (infrastructure)

**Non-Goals:**
- Viết lại nội dung kỹ thuật từ đầu — chỉ gộp, cắt giảm, tái tổ chức
- Thay đổi các quyết định kiến trúc đã Accepted (ADR-001 đến ADR-007)
- Tạo implementation code hoặc scaffolding
- Loại bỏ thông tin về desktop/Tauri 2 — chỉ gộp vào ít file hơn

## Decisions

### D1: Cấu trúc thư mục mới — phẳng 2 cấp, 3 section

**Chọn:** Tổ chức `blueprint/` thành 3 section chính + README:

```
blueprint/
├── README.md                      # Index + reading order + non-negotiable invariants
├── vocabulary.md                  # Giữ nguyên (canonical vocabulary)
├── decisions/                     # Gộp từ 9 → 1 file
│   └── architecture-decisions.md  # ADR-001..007 gộp vào, giữ nguyên nội dung quyết định
├── architecture/                  # Gộp từ 9 → 3 files
│   ├── system-overview.md         # Gộp: system-context + components + desktop-runtime-topology
│   ├── module-layout.md           # Gộp: physical-repository-layout + capability boundaries (+ ground-truth isolation)
│   └── sequences.md               # Gộp: end-to-end-sequences + judge-lifecycle
└── evaluation/                    # Gộp từ 12 → 2 files
    ├── methodology.md             # Gộp: baseline-protocol + scoring + validity-gates + flags (+ ground-truth data flow)
    └── experiment-profile.md      # Gộp: contest-manifest + rq1-profile + prompts summary
```

**Tổng: ~9 files**

**Lý do:**
- Mỗi section tương ứng một "concern" rõ ràng
- Developer chỉ cần đọc README → section liên quan → file cụ thể
- Loại bỏ hoàn toàn thư mục `contracts/` vì chi tiết hợp đồng, API, schema có thể được định nghĩa lại sau trong quá trình implement.
- Loại bỏ hoàn toàn thư mục `security/` vì hầu hết là boilerplate không thiết yếu ở giai đoạn này (Threat Model, Workspace Policy). Nguyên tắc Ground-Truth Isolation được chuyển sang `architecture` và `evaluation`.
- Loại bỏ hoàn toàn thư mục `delivery/` (meta-only), `persistence/` (gộp vào architecture), `providers/` (gộp vào architecture hoặc loại bỏ), `desktop/` (gộp vào architecture)

**Alternatives considered:**
- *Single mega-file*: Quá dài, khó navigate. Rejected.
- *Giữ nguyên cấu trúc, chỉ xóa file dư*: Vẫn quá nhiều thư mục, không giải quyết vấn đề duplication. Rejected.
- *Tổ chức theo C4 model (context/container/component/code)*: Quá formal cho DATN project. Rejected.

### D2: Loại bỏ manifest.yaml và digest tracking

**Chọn:** Xóa hoàn toàn `manifest.yaml` và `manifest-format.md`. README.md đóng vai trò index.

**Lý do:** Manifest SHA-256 digest tạo overhead lớn (phải regenerate mỗi khi edit bất kỳ file nào). Git đã cung cấp integrity tracking tự nhiên. README index đủ cho navigation.

**Alternatives considered:**
- *Giữ manifest đơn giản (chỉ danh sách paths)*: Vẫn tạo overhead sync. Rejected.
- *Tự động generate manifest trong CI*: Quá phức tạp cho lợi ích mang lại. Rejected.

### D3: Gộp ADR thành 1 file

**Chọn:** Gộp ADR-001 đến ADR-007 vào `decisions/architecture-decisions.md`, mỗi ADR là một H2 section.

**Lý do:** 
- 8 file ADR (gồm template) cho 7 quyết định là quá nhiều overhead.
- Developer thường muốn đọc toàn bộ quyết định liên quan cùng lúc.
- ADR template (ADR-000) không cần thiết nếu format được document trong file chính.

**Alternatives considered:**
- *Giữ riêng từng file ADR*: Chuẩn ADR best practice nhưng quá nhiều file cho 7 quyết định. Acceptable nếu user muốn — có thể điều chỉnh.

### D4: Loại bỏ Security section, chỉ giữ Ground-Truth Isolation

**Chọn:** Xóa hoàn toàn thư mục `security/` (và bỏ qua các nội dung như Threat Model, Data Classification, Workspace Policy). Chuyển nội dung "Ground-Truth Isolation" vào `architecture/module-layout.md` (như một kiến trúc phân tách ranh giới) và `evaluation/methodology.md` (như một luồng đánh giá chấm điểm).

**Lý do:** Các boilerplate bảo mật không thực sự thiết yếu trong giai đoạn hiện tại. Đặc tính cốt lõi duy nhất không được phép vi phạm là Ground-truth Isolation, nên nó cần được chuyển vào phần kiến trúc và cách thức đánh giá.

### D5: Persistence gộp vào Architecture

**Chọn:** 3 file persistence (ERD, field dictionary, consistency) gộp vào `architecture/system-overview.md`.

**Lý do:** ERD và field dictionary là phần mở rộng của architecture. Consistency rules là phần mở rộng của architecture sequences. Không cần thư mục riêng.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Mất nội dung quan trọng khi gộp file | Tạo checklist đối chiếu nội dung trước/sau. Review thủ công mỗi file bị xóa. |
| File gộp quá dài, không dễ đọc | Giới hạn mỗi file tối đa ~200 dòng. Nếu quá dài, tách thành 2 file. |
| ADR gộp mất khả năng track decision history | Git blame vẫn cho phép trace. Thêm note "Consolidated from ADR-00X" cho mỗi section. |
| Đường dẫn cũ trong docs/ và openspec/ bị broken | Task cập nhật references là bắt buộc, thực hiện ngay sau restructure. |
| Team member quen với cấu trúc cũ bị confused | README.md chứa mapping table old → new paths. |

## Migration Plan

1. Tạo cấu trúc thư mục mới song song (trong branch riêng)
2. Gộp nội dung từ file cũ → file mới (copy + edit, không viết lại)
3. Cập nhật README.md với index mới + migration mapping table
4. Cập nhật cross-references trong `docs/` và `openspec/`
5. Xóa file cũ sau khi verify nội dung đã được chuyển
6. Git commit atomic: toàn bộ thay đổi trong 1 commit để dễ revert
