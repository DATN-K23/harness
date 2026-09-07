## 1. Project Initialization — @TV1

- [ ] 1.1 **@TV1**: Tạo `runtime/pyproject.toml` với cấu hình `uv`, khai báo project name `harness`, Python >=3.12, và các dev dependencies cơ bản (pytest, ruff, mypy). Chạy `uv sync` thành công.
- [ ] 1.2 **@TV1**: Tạo cấu trúc `runtime/src/harness/__init__.py` và `runtime/src/harness/shared_kernel/` chứa các file: `__init__.py`, `types.py` (RunId, SnapshotId, ExperimentId...), `errors.py` (base error hierarchy), `enums.py` (RunStatus, VerdictClassification...).
- [ ] 1.3 **@TV1**: Tạo thư mục `contracts/` với `README.md`, `registry.yaml` (copy từ blueprint), và `openapi/local-runtime.v1.openapi.yaml` (copy từ blueprint). Tạo cấu trúc `contracts/schemas/` với thư mục con cho mỗi capability (`shared/v1/`, `run-control/v1/`, `model-gateway/v1/`, `source-access/v1/`, `agent-runtime/v1/`, `judge/v1/`, `evaluation/v1/`, `scorer-only/v1/`).
- [ ] 1.4 **@TV1**: Tạo `contracts/examples/valid/` và `contracts/examples/invalid/` với ít nhất một file JSON mẫu mỗi thư mục (ví dụ: valid verdict payload, invalid verdict thiếu required field) để downstream validation tests có thể dùng.
- [ ] 1.5 **@TV1**: Scaffold các thư mục ancillary theo `physical-repository-layout.md`: `config/{runtime,flags}/` (với `.gitkeep`), `datasets/{README.md,manifests/,synthetic/}`, `packaging/local-runtime/{env.example,healthcheck/}`. Các thư mục này ban đầu rỗng hoặc chứa placeholder, sẽ được WP-03/05/08 populate.

## 2. Capability Module Scaffold — @TV1

- [ ] 2.1 **@TV1**: Tạo 7 thư mục module dưới `runtime/src/harness/modules/`: `run_control`, `model_gateway`, `source_access`, `agent_runtime`, `judge`, `evaluation`, `scoring`. Mỗi module chứa: `__init__.py`, `public/__init__.py`, `ports/__init__.py`.
- [ ] 2.2 **@TV1**: Viết public interface stubs cho `run_control.public`: Protocol classes cho `SubmitRun`, `ClaimWork`, `CancelRun`, `GetRun`, `ListRunEvents` và các lifecycle event types.
- [ ] 2.3 **@TV1**: Viết public interface stubs cho `model_gateway.public`: Protocol class cho `InvokeModelOnce`, provider/profile/attempt types.
- [ ] 2.4 **@TV1**: Viết public interface stubs cho `source_access.public`: Protocol classes cho `RegisterSource`, `ResolveSnapshot`, `DispatchSourceTool`, snapshot/evidence types.
- [ ] 2.5 **@TV1**: Viết public interface stubs cho `agent_runtime.public`: Protocol classes cho `ExecuteAgentTurn`, `ContinueRun`, allocation/stop types.
- [ ] 2.6 **@TV1**: Viết public interface stubs cho `judge.public`: Protocol classes cho `StartJudge`, `ValidateVerdict`, candidate/verdict types.
- [ ] 2.7 **@TV1**: Viết public interface stubs cho `evaluation.public`: Protocol classes cho `ScheduleExperiment`, `AcceptApprovedScore`, experiment/result types.
- [ ] 2.8 **@TV1**: Viết public interface stubs cho `scoring.public`: Scorer-only input types (không có consumer chung, chỉ scorer-root inputs).

## 3. Composition Roots & Platform — @TV1

- [ ] 3.1 **@TV1**: Tạo `runtime/src/harness/platform/` với các stub: `configuration/`, `database/`, `observability/`, `secrets/`, `process_runtime/` — mỗi thư mục chứa `__init__.py`.
- [ ] 3.2 **@TV1**: Tạo 4 entrypoint stubs trong `runtime/src/harness/entrypoints/`: `daemon/__init__.py`, `worker/__init__.py`, `evaluator/__init__.py`, `scorer/__init__.py`. Mỗi entrypoint chỉ import các module được phép theo deny matrix trong `physical-repository-layout.md`.
- [ ] 3.3 **@TV1**: Tạo `runtime/src/harness/generated/contracts/__init__.py` (placeholder cho output của contract generation pipeline).

## 4. Architecture Boundary Tests — @TV1

- [ ] 4.1 **@TV1**: Tạo `runtime/tests/architecture/test_import_boundaries.py` — quét AST của mỗi module và xác nhận rằng chỉ các import trong allowed capability graph mới được phép. Test PHẢI fail khi có illegal cross-capability import.
- [ ] 4.2 **@TV1**: Tạo `runtime/tests/architecture/test_composition_deny_matrix.py` — xác nhận mỗi entrypoint không thể import transitive closure của các module bị cấm (ví dụ: scorer không thể import agent_runtime).
- [ ] 4.3 **@TV1**: Tạo `runtime/tests/architecture/test_public_purity.py` — quét các file trong `public/` của mọi module và xác nhận không có import FastAPI, SQLAlchemy, provider SDK, hoặc native shell.
- [ ] 4.4 **@TV1**: Tạo `runtime/tests/architecture/test_table_ownership.py` — quét migration registry và xác nhận mỗi bảng DB được sở hữu bởi đúng một capability module theo bảng "Table and migration ownership" trong `physical-repository-layout.md`. Trong WP-01 test chạy trên registry rỗng (pass trivially); WP-06 sẽ populate.

## 5. Context & Budget Ports — @TV2

- [ ] 5.1 **@TV2**: Trong `runtime/src/harness/modules/agent_runtime/ports/`, tạo `context_ports.py` định nghĩa abstract interface cho `ContextEstimator` (ước tính token từ nội dung) và `BudgetAllocator` (phân bổ ngân sách cho mỗi lần gọi model).
- [ ] 5.2 **@TV2**: Trong `runtime/src/harness/modules/agent_runtime/public/`, bổ sung các value types cho context allocation: `ContextAllocation`, `BudgetLimit`, `StopReason` vào public stubs.
- [ ] 5.3 **@TV2**: Tạo `runtime/tests/modules/agent_runtime/test_context_ports.py` — unit test xác nhận interface `ContextEstimator` và `BudgetAllocator` có thể được mock và gọi thành công.

## 6. Tool JSON Schemas — @TV3

- [ ] 6.1 **@TV3**: Tạo `contracts/schemas/source-access/v1/read_file.schema.json` — JSON Schema cho input/output của tool read_file (path, encoding, content, error).
- [ ] 6.2 **@TV3**: Tạo `contracts/schemas/source-access/v1/list_dir.schema.json` — JSON Schema cho input/output của tool list_dir (path, entries[], type, size).
- [ ] 6.3 **@TV3**: Tạo `contracts/schemas/source-access/v1/search.schema.json` — JSON Schema cho input/output của tool search (query, path, matches[]).
- [ ] 6.4 **@TV3**: Tạo `contracts/schemas/source-access/v1/glob.schema.json` — JSON Schema cho input/output của tool glob (pattern, path, matches[]).
- [ ] 6.5 **@TV3**: Tạo `runtime/tests/contract/test_tool_schemas.py` — validate mỗi schema file ở trên chống lại JSON Schema meta-schema, xác nhận 4 file đều hợp lệ.

## 7. Security Policy Fixtures — @TV4

- [ ] 7.1 **@TV4**: Tạo `runtime/src/harness/modules/source_access/resources/workspace_policy.yaml` — fixture định nghĩa ít nhất một quy tắc cho phép/chặn path (ví dụ: deny `.env`, deny `**/secrets/**`).
- [ ] 7.2 **@TV4**: Tạo `runtime/src/harness/modules/source_access/resources/redaction_rules.yaml` — fixture định nghĩa ít nhất một quy tắc redaction (ví dụ: redact API keys, credentials).
- [ ] 7.3 **@TV4**: Tạo `runtime/src/harness/modules/source_access/resources/native_denial_list.yaml` — fixture liệt kê các native commands bị cấm (ví dụ: shell, process, filesystem direct access).
- [ ] 7.4 **@TV4**: Tạo `runtime/tests/adversarial/test_policy_fixtures.py` — test load mỗi fixture file, xác nhận parse thành công và chứa ít nhất một rule.

## 8. Synthetic Evaluation Fixtures — @TV5

- [ ] 8.1 **@TV5**: Tạo `config/providers/synthetic-deterministic.profile.yaml` — synthetic provider profile hợp lệ theo `providers/provider-profile.schema.json` từ blueprint, với `network_ready: false`.
- [ ] 8.2 **@TV5**: Tạo `config/evaluation/synthetic-experiment.manifest.yaml` — synthetic experiment manifest fixture dùng cho testing interface WP-08.
- [ ] 8.3 **@TV5**: Tạo `runtime/tests/contract/test_evaluation_fixtures.py` — validate synthetic provider profile và experiment manifest chống lại blueprint schemas, xác nhận cả hai đều hợp lệ.

## 9. PostgreSQL & Migration Infrastructure — @TV6

- [ ] 9.1 **@TV6**: Tạo `runtime/migrations/env.py` — Alembic environment configuration kết nối PostgreSQL qua environment variable `DATABASE_URL`.
- [ ] 9.2 **@TV6**: Tạo `runtime/migrations/registry.py` — module-aware migration registry ánh xạ mỗi migration tới đúng một capability owner.
- [ ] 9.3 **@TV6**: Tạo empty initial migration (`runtime/migrations/versions/001_initial.py`) chứng minh pipeline hoạt động — chỉ tạo migration history table, không tạo business table.
- [ ] 9.4 **@TV6**: Tạo `compose.yaml` ở root repository — developer entrypoint khởi động PostgreSQL container cho local development.
- [ ] 9.5 **@TV6**: Tạo `runtime/tests/integration/test_migration_runs.py` — test chạy migration trên PostgreSQL container, xác nhận migration history table tồn tại.

## 10. OpenAPI & Contract Generation Pipeline — @TV6

- [ ] 10.1 **@TV6**: Tạo `scripts/generate-contracts.py` — script đọc JSON Schemas từ `contracts/schemas/`, sinh Pydantic models vào `runtime/src/harness/generated/contracts/`, và sinh TypeScript types vào `apps/desktop/ui/src/generated/runtime-client/`.
- [ ] 10.2 **@TV6**: Tạo `runtime/tests/contract/test_generated_drift.py` — drift detection test so sánh generated output với committed files, fail nếu source schema thay đổi mà chưa re-generate.

## 11. Tauri 2 Host Skeleton — @TV6

- [ ] 11.1 **@TV6**: Khởi tạo `apps/desktop/src-tauri/` với `Cargo.toml` (Tauri 2 dependencies), `tauri.conf.json`, `build.rs`.
- [ ] 11.2 **@TV6**: Tạo `apps/desktop/src-tauri/src/main.rs` (Tauri executable bootstrap) và `src/lib.rs` (command/plugin registration — rỗng, không có business command).
- [ ] 11.3 **@TV6**: Tạo `apps/desktop/src-tauri/capabilities/main-window.json` với allowlist tối thiểu — KHÔNG cấp quyền generic filesystem, shell, process, environment, URL opener, raw secret, hoặc direct updater.
- [ ] 11.4 **@TV6**: Tạo placeholder directories: `commands/`, `runtime_supervision/`, `credential_store/`, `repository_picker/`, `notifications/`, `update_coordinator/` với `mod.rs` rỗng.

## 12. Desktop UI Skeleton — @TV6

- [ ] 12.1 **@TV6**: Khởi tạo `apps/desktop/ui/` với `package.json` (React, Vite, TypeScript, pnpm), `tsconfig.json`, `vite.config.ts`.
- [ ] 12.2 **@TV6**: Tạo `apps/desktop/ui/src/app/` với minimal React entry point (`App.tsx`, `main.tsx`) render được trong Tauri webview.
- [ ] 12.3 **@TV6**: Tạo placeholder: `apps/desktop/ui/src/generated/runtime-client/` (output của contract generation).
- [ ] 12.4 **@TV6**: Xác nhận `pnpm install && pnpm build` thành công trong `apps/desktop/ui/`.

## 13. Three-OS Build Evidence — @TV6

- [ ] 13.1 **@TV6**: Build Tauri project trên **Linux** — lưu build log vào `packaging/desktop/linux/build-evidence.log`.
- [ ] 13.2 **@TV6**: Build Tauri project trên **macOS** — lưu build log vào `packaging/desktop/macos/build-evidence.log`.
- [ ] 13.3 **@TV6**: Build Tauri project trên **Windows** — lưu build log vào `packaging/desktop/windows/build-evidence.log`.

## 14. ADR-007 Readiness Plan — @TV6

- [ ] 14.1 **@TV6**: Tạo `docs/adr007-readiness-plan.md` — ánh xạ tất cả 10 readiness cases (R01–R10) từ bảng ADR-007 trong `implementation-work-packages.md` tới WP đích, owner, và timeline window chịu trách nhiệm sản xuất evidence. Đảm bảo không case nào bị bỏ sót.
- [ ] 14.2 **@TV6**: Review với TV1 và TV4 để xác nhận readiness plan phù hợp với phân công trong C02–C08 timeline.

## 15. Clean Bootstrap Verification — @TV1

- [ ] 15.1 **@TV1**: Viết `README.md` ở root repository hướng dẫn setup: cài toolchains (Python >=3.12 + uv, Rust + Tauri CLI, Node.js + pnpm), rồi chạy `uv sync`, `pnpm install`, `cargo build`.
- [ ] 15.2 **@TV1**: Xác nhận fresh clone trên một máy khác chạy thành công toàn bộ 3 lệnh setup mà không cần cấu hình thủ công ngoài tài liệu.
