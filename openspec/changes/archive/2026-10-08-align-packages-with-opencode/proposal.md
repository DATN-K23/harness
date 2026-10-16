# Proposal

## Why

Blueprint Harness định nghĩa chưa chính xác một số trách nhiệm package: `schema` bị coi là nơi chứa bảng Drizzle, `protocol` bị cấm phụ thuộc schema, CLI bị giới hạn thành API client và sơ đồ import lẫn với HTTP transport. Cần thống nhất bản đồ package của Harness để các thành viên đặt đúng logic và leader review đúng ranh giới.

## What Changes

- Định nghĩa lại mười package trong `blueprint/architecture/module-layout.md` bằng bảng nhiệm vụ, nội dung, public surface, dependency và ví dụ đường đi dữ liệu, theo trách nhiệm và boundary đã chọn cho Harness.
- **BREAKING ở hợp đồng kiến trúc, chưa có runtime migration:** `schema` sở hữu schema dữ liệu chung, còn bảng/adapter DB và migration thuộc capability trong `core`; `protocol` dùng `schema` cho hợp đồng API; `client` runtime dùng `schema`/`protocol`, với generation dependency tách riêng.
- Cho phép CLI composition entrypoint ghép public runtime/server services, đồng thời giữ các lệnh người dùng qua API và giữ desktop/renderer ngoài quyền thực thi nghiệp vụ.
- Phân biệt `packages/protocol` (API ứng dụng) với `llm/src/protocols` (giao thức provider); giữ orchestrator sở hữu continuation, retry và budget thay vì giấu agent loop trong LLM adapter.
- Giữ stack Harness đã chọn trong ADR: React/Tauri/PostgreSQL với Drizzle; package map chỉ định nghĩa trách nhiệm và boundary.
- Cập nhật ADR về ownership package và phạm vi quyết định tái sử dụng đã được leader chấp thuận; giữ nguyên lịch sử và ghi rõ phần supersede.
- Đồng bộ mô tả package trong blueprint, phần OpenSpec còn buộc layout Python và context liên quan; duy trì một nguồn định nghĩa package có thẩm quyền.

## Capabilities

### New Capabilities

Không có. Dùng capability blueprint hiện hữu, không tạo một capability sản phẩm chỉ để đổi tài liệu.

### Modified Capabilities

- `blueprint-structure`: yêu cầu package map có định nghĩa thống nhất, phân biệt dependency runtime/generation và transport, bảo toàn lịch sử quyết định; sửa vị trí Drizzle từ `schema` sang capability-owned persistence trong `core` mà giữ lựa chọn datastore/desktop hiện có.
- `judge-run-orchestration`: thay yêu cầu layout Python bằng TypeScript/Bun mười package; định nghĩa public subpath, capability ownership trong package và CLI composition boundary.

## Impact

**Đích thay đổi khi apply:** sáu tài liệu hiện có trong `blueprint/`, `openspec/config.yaml` ở phần context bị lệch và các delta của hai capability nêu trên. Main specs được sync/archive theo workflow OpenSpec, không sửa archive lịch sử. `zinn/leader-guide.md` là tài liệu giải thích riêng, không phải nguồn contract bắt buộc để áp dụng change này.

**Nghiên cứu được phục vụ:** nền kiến trúc cho RQ1 và RQ3, đồng thời phân biệt cơ chế kế thừa với workflow chuyên ngành cần đánh giá. Change không sinh số liệu hay tuyên bố chất lượng audit đã tăng.

**Không nằm trong scope:** tạo source/manifests/tests/migrations ứng dụng, copy/fork OpenCode, đổi database/renderer/desktop/framework, gọi provider trả phí, chọn dataset/budget, triển khai SmartPoC hoặc luật single-shot/fast-reject trong `zinn/proposal.md`.

Bảo toàn các ranh giới `CandidateFinding`/`SourceSnapshot` agent-visible và `GroundTruthLabel` scorer-only; Judge chỉ đọc và unverified; exact sanitized trace, immutable config, budget/failure/recovery, contest split và kiểm soát drift vẫn giữ nguyên. Verification riêng, ablation, trace view, offline demo và so sánh provider thật vẫn là nghĩa vụ full project; đổi package không hoàn thành hay loại bỏ chúng.
