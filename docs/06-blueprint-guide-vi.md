# Hướng dẫn toàn bộ Blueprint Judge Mode MVP

> Tài liệu này gom và giải thích bằng tiếng Việt toàn bộ ý tưởng quan trọng trong `blueprint/` để có thể đọc từ trên xuống dưới. Đây là tài liệu diễn giải, không phải nguồn chuẩn mới và không thay thế OpenSpec, JSON Schema, OpenAPI, ADR hay các hợp đồng gốc. Khi có khác biệt, luôn ưu tiên blueprint gốc theo thứ tự thẩm quyền được nêu ở phần 3.

## 1. Đọc xong tài liệu này bạn sẽ hiểu gì?

Sau khi đọc từ đầu đến cuối, bạn cần trả lời được các câu hỏi sau:

1. Nhóm đang xây sản phẩm gì và đóng góp nghiên cứu nằm ở đâu?
2. Judge mode nhận dữ liệu gì, chạy ra sao và trả kết quả gì?
3. Vì sao hệ thống là desktop app nhưng phần xử lý không nằm trong desktop?
4. Source code tương lai sẽ được chia thư mục và module như thế nào?
5. Capability là gì, khác layer và process ở đâu?
6. Agent loop, provider, tool, context, persistence và API phối hợp ra sao?
7. Làm sao ngăn agent đọc ground truth?
8. Vì sao PostgreSQL là thành phần trung tâm của khả năng phục hồi?
9. Làm sao so sánh direct model với harness một cách công bằng?
10. Những quyết định nào đã chốt, những gì vẫn bị khóa và nhóm nên code theo thứ tự nào?

## 2. Blueprint này thực chất là gì?

Blueprint là bản thiết kế triển khai cho MVP Judge mode. Nó mô tả hệ thống tương lai đủ rõ để sáu thành viên có thể chia việc và code mà không phải tự đoán lại kiến trúc, dữ liệu, ranh giới bảo mật hoặc cách đánh giá.

Blueprint hiện tại đã được validation về tính nhất quán tài liệu, nhưng chưa phải phần mềm chạy được. Nó không chứng minh rằng:

- runtime đã tồn tại;
- desktop đã build được;
- database đã được tạo;
- provider đã được gọi;
- contest đã được chạy;
- precision hoặc recall đã được đo;
- Judge mode đã hoạt động ngoài đời thực.

Câu phải luôn nhớ là:

> Blueprint hoàn thành nghĩa là bản thiết kế đã đủ và nhất quán. Nó không có nghĩa là sản phẩm đã được triển khai.

### 2.1 Mục tiêu của đồ án

Nhóm không huấn luyện model mới. Nhóm xây một Harness bao quanh model để model có thể:

- nhận một finding cần phán xét;
- đọc và tìm kiếm trong source code được phép;
- làm việc qua nhiều bước;
- kiểm soát context, token, thời gian và chi phí;
- trả verdict có cấu trúc và có bằng chứng;
- lưu toàn bộ trajectory để giải thích và đánh giá lại.

Luận điểm nghiên cứu là: giữ nguyên model, so sánh model gọi trực tiếp với cùng model chạy qua Harness. Phần chênh lệch chất lượng là giá trị mà Harness tạo ra.

### 2.2 MVP này làm gì?

MVP tập trung vào Judge mode:

- đầu vào là một `CandidateFinding` đã có sẵn;
- đầu vào source là một `SourceSnapshot` bất biến;
- agent đọc source bằng bốn tool an toàn;
- agent quyết định finding `valid` hay `invalid`;
- kết quả luôn là `unverified`, vì chưa chạy PoC;
- mọi bước được lưu thành trajectory;
- người dùng gửi và theo dõi run qua desktop app;
- hệ thống hỗ trợ đánh giá direct-versus-harness cho RQ1.

### 2.3 MVP này chưa làm gì?

Các nội dung sau không được âm thầm nhét vào Judge MVP:

- Audit mode tự tìm finding trên toàn repository;
- long-term memory giữa nhiều run;
- context compaction bằng model;
- PoC generation và execution hoàn chỉnh;
- shell, chạy command hoặc arbitrary code;
- provider-hosted web search, file search hoặc code execution;
- production multi-tenancy hoặc public SaaS;
- Kubernetes;
- MCP/plugin discovery;
- so sánh đầy đủ nhiều real provider cho RQ3;
- baseline static analyzer/general agent cho RQ2;
- offline replay hoàn chỉnh.

Blueprint chỉ giữ sẵn extension point cho những thứ này. Chúng cần OpenSpec change và threat model riêng trong tương lai.

## 3. Thứ tự thẩm quyền của tài liệu

Nếu hai file có vẻ mâu thuẫn, không chọn theo cảm tính. Dùng thứ tự sau:

1. OpenSpec requirements và Given/When/Then scenarios;
2. hợp đồng máy đọc được: OpenAPI, JSON Schema, YAML profile/catalog;
3. Markdown được ghi là normative;
4. ADR có trạng thái `Accepted`;
5. ADR/profile có trạng thái `Proposed`;
6. example, wireframe và tài liệu giải thích.

Tài liệu bạn đang đọc nằm ở tầng giải thích. Nó giúp hiểu nhanh, nhưng code tương lai phải bám vào hợp đồng gốc.

## 4. Những quyết định đã chốt và chưa chốt

### 4.1 ADR-001 — Tech stack: đã chốt

Stack family cho tương lai đã được `Accepted`:

| Phần                          | Công nghệ đã chọn                    |
| ------------------------------ | ----------------------------------------- |
| Runtime/backend                | Python 3.12                               |
| Local API và validation       | FastAPI, Pydantic v2                      |
| Persistence                    | PostgreSQL, SQLAlchemy 2.x, Alembic       |
| Desktop renderer               | React, TypeScript, Vite trên Node.js LTS |
| Python dependency workflow     | `uv` và lockfile                       |
| JavaScript dependency workflow | `pnpm` và lockfile                     |
| Local development/delivery     | Docker Compose                            |

Không được tự đổi sang NestJS, Redis/BullMQ, Celery, Bun/Effect/Solid, Kubernetes hoặc microservices chỉ vì một thành viên thích công nghệ đó. Nếu stack family thật sự không đáp ứng được, phải có ADR thay thế kèm bằng chứng.

Exact patch/minor version của package chưa được khóa trong blueprint. Chúng sẽ được pin trong lockfile ở implementation change đầu tiên.

### 4.2 ADR-002 — Cách tích hợp provider: đã chốt

Core hệ thống chỉ biết contract do Harness sở hữu: `model_gateway.public`. Provider SDK bị giấu sau adapter.

Real adapter đầu tiên sẽ dùng official asynchronous Python SDK của OpenAI Responses API. Nhưng ADR này chỉ chốt chiến lược tích hợp, không chốt model cụ thể, giá, credential hay ngân sách.

Các lựa chọn bị loại khỏi MVP:

- LiteLLM hoặc gateway in-process;
- external LLM proxy;
- OpenAI Agents SDK làm agent loop;
- hosted tools;
- provider-owned conversation/thread làm nguồn lịch sử chính;
- SDK tự retry hoặc tự gọi tool ngầm.

### 4.3 ADR-003 — Phương pháp đánh giá RQ1: đã chốt

Phương pháp matched-pair direct-versus-harness đã được chấp nhận. Tuy nhiên experiment cụ thể vẫn chưa được phép chạy.

ADR này chốt cách làm khoa học, còn những giá trị hay thay đổi như model, case list, repeats, token budget, threshold, pricing và execution window nằm trong experiment profile riêng.

### 4.4 ADR-004 — Quan hệ với OpenCode: đã chốt

OpenCode chỉ là nguồn tham khảo kiến trúc tại commit đã pin:

`14f0bf64a19493110b51f5fdeb9c1c1bba5dd3f5`

Blueprint học từ OpenCode các ý tưởng:

- một lần gọi model là một boundary rõ ràng;
- agent loop nằm ở tầng điều phối cao hơn;
- tool có contract và registry;
- event/trajectory cần inspect được.

Nhưng Harness không:

- fork OpenCode;
- copy source, test, prompt, schema hoặc asset;
- thêm OpenCode làm submodule, subtree, workspace hay dependency;
- dùng Bun/Effect/Solid stack của OpenCode;
- bê shell/write/network tools vào Judge;
- lấy SQLite hoặc process-local state làm runtime authority;
- tự động đồng bộ theo upstream.

Nếu sau này muốn dùng code/package từ OpenCode, cần review license, dependency, security và một quyết định mới.

### 4.5 ADR-005 — Cấu trúc capability-first modular monolith: đã chốt

Runtime là một modular monolith được tổ chức theo capability trước, không tổ chức toàn repository theo layer kỹ thuật.

Điều này được giải thích chi tiết ở phần 7 và 8.

### 4.6 ADR-006 — Desktop app và local runtime: đã chốt

Sản phẩm là một desktop app tải về, nhưng Judge không chạy trong renderer. Desktop chỉ là client mỏng kết nối tới local runtime độc lập.

Đóng cửa sổ, renderer crash hoặc desktop reconnect không được làm mất hoặc tự hủy run. PostgreSQL và runtime process mới là authority.

### 4.7 ADR-007 — Native shell: đã chốt

Tauri 2 đã được chọn làm native desktop shell. ADR-007 có trạng thái `Accepted` (v2, 2026-08-19).

Tauri host là OS adapter, không phải Judge business capability hay composition root thay thế. React/Vite renderer vẫn là generated-local-runtime-client consumer. Quyền truy cập renderer-to-native mặc định là deny và được mô tả bằng explicit per-window capabilities, project permissions/scopes và typed commands. Các command family được phép giới hạn ở:

- runtime discovery, start-or-attach, health và compatibility status;
- shell-mediated authenticated local-runtime requests mà không lộ installation credential;
- native repository picker do operator khởi tạo, kết quả chỉ dùng cho source registration;
- local notifications chứa safe projection data;
- update availability và explicit coordinated-update preparation.

Renderer không nhận filesystem, shell, process, environment-variable, arbitrary-URL, raw-credential, direct-updater, database, provider, Judge-tool hay scorer capability generic. Content model/source/trace hiển thị không được mở rộng allowlist này.

Các lựa chọn bị loại:

- **Electron**: mature nhưng thêm preload/IPC/Node/Chromium privilege mà thin client không cần; chỉ là contingency qua superseding ADR.
- **Python-hosted webview/native UI**: không có candidate nào đáp ứng đủ React/Vite, per-window permission, signing và three-OS updater boundary.

ADR-007 Accepted không có nghĩa distribution đã sẵn sàng. WP-01/WP-10 vẫn phải tạo readiness spike evidence (ba OS build, lifecycle, secure-store, signed-update, rollback, reproducibility, startup/memory/bundle measurements) trước khi native release được coi là ready.

### 4.8 Hai profile quan trọng vẫn đang khóa

| Profile                   | Trạng thái                             | Ý nghĩa                                                                       |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `real-primary@1`        | `Proposed`, `network_ready: false`   | Không được tạo provider client, đọc credential hoặc gọi mạng.         |
| `rq1-confirmatory-v1@1` | `Proposed`, `execution_ready: false` | Không được mở frozen test hoặc chạy thí nghiệm có kết quả/chi phí. |

Đây không phải thiếu sót. Đây là gate an toàn có chủ đích.

## 5. Bức tranh hệ thống ở mức cao nhất

Hãy hình dung sản phẩm gồm các khối sau:

```text
Người dùng
   |
   v
Desktop app
   |
   | generated local-runtime client
   v
Local daemon/API ------> PostgreSQL <------ Worker
                            |                  |
                            |                  +--> Model provider
                            |                  +--> Source-only workspace/tools
                            |
                            +------ Evaluator
                            |
Ground truth ------> Scorer process ------> ApprovedScoreV1 ------> Evaluation
```

Các nguyên tắc quan trọng:

- desktop không truy cập trực tiếp database, provider, source tool hoặc scorer;
- worker không được đọc ground truth;
- evaluator không được đọc ground truth hoặc import `scoring`;
- scorer chỉ chạy sau khi run đã terminal;
- provider chỉ nhận context đã sanitize;
- PostgreSQL lưu state và work authority;
- source workspace chỉ chứa source đã đăng ký, không chứa đáp án.

## 6. Desktop app, local runtime và các process

### 6.1 Desktop gồm những gì?

Desktop có hai phần khái niệm:

- native shell: quản lý cửa sổ, tìm/start runtime, giữ local credential, mở repository picker, notification, signing và update;
- React/Vite renderer: giao diện người dùng, form, trace view và các projection tạm thời.

Renderer chỉ gọi generated TypeScript client được sinh từ OpenAPI. Nó không được tự tạo request bằng một contract khác.

### 6.2 Local runtime gồm những process nào?

| Process       | Trách nhiệm chính                                                           |
| ------------- | ------------------------------------------------------------------------------ |
| `daemon`    | local API, handshake, source registration, run/status/event projection         |
| `worker`    | claim công việc và thực thi Judge agent loop                               |
| `evaluator` | lập lịch thí nghiệm, quản lý matched cells, aggregate kết quả an toàn |
| `scorer`    | đọc ground truth sau terminal và tạo score được phép công bố         |

Bốn process dùng chung một Python runtime codebase, dependency lock và compatibility version. Chúng không phải bốn microservice phát hành độc lập.

### 6.3 Vì sao phải tách process?

Tách process giúp:

- run tiếp tục khi desktop đóng;
- worker crash có thể phục hồi;
- scorer có credential riêng;
- daemon không cần có provider hoặc ground-truth authority;
- lifecycle và security boundary có thể kiểm thử độc lập.

Tách process không đồng nghĩa với microservices. Business logic vẫn nằm trong cùng modular monolith.

### 6.4 Kết nối desktop và runtime

MVP chỉ cho phép:

- loopback endpoint; hoặc
- OS-local IPC tương đương.

Runtime không bind public interface. Endpoint được tìm qua rendezvous record được OS bảo vệ. Request dùng installation-scoped credential hoặc OS access control tương đương.

Credential không được xuất hiện trong:

- URL;
- renderer storage;
- ordinary log;
- trajectory;
- export.

### 6.5 Compatibility handshake

Trước khi gửi run, desktop phải đọc:

- `runtime_instance_id`;
- `runtime_version`;
- `api_version`;
- `contract_digest`;
- `build_version`;
- `capabilities`;
- `health`;
- safe `recovery_action` nếu có.

Sai major version hoặc contract digest thì fail closed. UI khóa mutation và yêu cầu restart/update; tuyệt đối không fallback sang database hoặc provider trực tiếp.

## 7. Capability là gì?

Capability là một khối trách nhiệm nghiệp vụ có ranh giới sở hữu rõ ràng. Nó thường sở hữu:

- public contract;
- business rules;
- use case;
- port;
- adapter;
- resource;
- persistence metadata và migration contribution.

Capability không nhất thiết là:

- một process;
- một service;
- một repository;
- một layer ngang toàn hệ thống.

Ví dụ `source_access` là capability vì nó sở hữu toàn bộ nghiệp vụ đăng ký source, snapshot, tool và path security. Nhưng daemon và worker đều có thể sử dụng public contract của nó tùy composition.

### 7.1 Bảy capability của runtime

| Capability        | Sở hữu                                                                            | Không sở hữu                                     |
| ----------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| `run_control`   | lifecycle, idempotency, jobs/outbox, claim/lease, ordered event                     | provider mapping, source I/O, label                 |
| `model_gateway` | provider contract/profile, adapter, identity, usage, cost, error                    | agent continuation, tool execution, verdict meaning |
| `source_access` | source registration, immutable snapshot, workspace, bốn source tool, path security | repository-picker UI, Judge policy, ground truth    |
| `agent_runtime` | turn loop, committed history, context allocation, budget, stop/continuation         | `valid/invalid` semantics, label                  |
| `judge`         | candidate semantics, Judge prompt/policy, verdict và evidence validation           | provider SDK, raw filesystem, ground truth          |
| `evaluation`    | protocol/profile, direct-versus-harness schedule, manifest, aggregation/export      | label resolution, scorer credential                 |
| `scoring`       | label/adjudication, post-terminal join, score computation                           | agent context, provider, tool, desktop              |

### 7.2 Quan hệ dependency được phép

```text
run_control     -> không phụ thuộc capability khác
model_gateway   -> không phụ thuộc capability khác
source_access   -> không phụ thuộc capability khác

agent_runtime   -> run_control.public
                -> model_gateway.public
                -> source_access.public

judge           -> run_control.public
                -> agent_runtime.public
                -> source_access.public

evaluation      -> run_control.public
                -> judge.public
                -> model_gateway.public
                -> source_access.public

scoring         -> evaluation.public
```

Graph này phải acyclic.

Đáng chú ý:

- `judge` không gọi thẳng `model_gateway`; nó đi qua `agent_runtime`;
- `evaluation` không được import `scoring`;
- `scoring` chỉ phụ thuộc một chiều vào `evaluation.public`;
- capability chỉ import public surface của capability khác.

### 7.3 Shallow hexagonal bên trong capability

Một capability có thể có:

```text
modules/<capability>/
├── public/        # command/query/event/type cho capability khác
├── domain/        # invariant và model nghiệp vụ
├── application/   # use case/workflow
├── ports/         # abstraction cần từ bên ngoài
├── adapters/      # DB/provider/filesystem/HTTP implementation thuộc capability
└── resources/     # prompt/schema/policy tĩnh thuộc capability
```

Không phải capability nào cũng phải có đủ sáu folder. Chỉ tạo folder khi có artifact thật. Đây là lý do gọi là shallow hexagonal, không phải clean architecture ceremony.

### 7.4 Các vùng nằm ngoài capability

| Vùng             | Được chứa                                                            | Không được chứa                               |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| `shared_kernel` | ID, time, money,`Result`, base error                                   | business model/service                             |
| `platform`      | DB engine, config loader, observability, secret store, process mechanics | business repository hoặc policy                   |
| `entrypoints`   | wiring và process startup/shutdown                                      | business decision                                  |
| `generated`     | projection sinh từ canonical contract                                   | model viết tay hoặc scorer type lộ sang desktop |

Không có global `adapters/` chứa business adapter. Provider adapter thuộc `model_gateway`; filesystem adapter thuộc `source_access`; persistence adapter thuộc capability sở hữu table.

## 8. Cấu trúc source code vật lý tương lai

Blueprint chốt cấu trúc sau cho implementation repository:

```text
harness/
├── README.md
├── compose.yaml
├── contracts/
│   ├── registry.yaml
│   ├── openapi/local-runtime.v1.openapi.yaml
│   ├── schemas/
│   │   ├── shared/v1/
│   │   ├── run-control/v1/
│   │   ├── model-gateway/v1/
│   │   ├── source-access/v1/
│   │   ├── agent-runtime/v1/
│   │   ├── judge/v1/
│   │   ├── evaluation/v1/
│   │   └── scorer-only/v1/
│   └── examples/{valid,invalid}/
├── runtime/
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── src/harness/
│   │   ├── shared_kernel/
│   │   ├── modules/
│   │   │   ├── run_control/
│   │   │   ├── model_gateway/
│   │   │   ├── source_access/
│   │   │   ├── agent_runtime/
│   │   │   ├── judge/
│   │   │   ├── evaluation/
│   │   │   └── scoring/
│   │   ├── platform/
│   │   ├── entrypoints/{daemon,worker,evaluator,scorer}/
│   │   └── generated/contracts/
│   ├── migrations/
│   └── tests/
│       ├── architecture/
│       ├── modules/
│       ├── contract/
│       ├── integration/
│       ├── adversarial/
│       └── e2e/
├── apps/desktop/
│   ├── ui/
│   │   └── src/
│   │       ├── app/
│   │       ├── modules/{runs,judge,trace,settings,evaluation}/
│   │       ├── shared/
│   │       └── generated/runtime-client/
│   ├── shell/
│   ├── resources/
│   └── tests/
├── config/{runtime,flags,providers,evaluation}/
├── datasets/{manifests,synthetic}/
├── packaging/{local-runtime,desktop}/
├── docs/
├── blueprint/
└── openspec/
```

Đây là ownership map, không phải lệnh tạo tất cả folder trống ngay ngày đầu.

### 8.1 `contracts/` ở top-level để làm gì?

Đây là canonical serialized boundary của toàn hệ thống:

- OpenAPI;
- JSON Schema;
- example hợp lệ/không hợp lệ;
- registry về source, owner, consumer và exposure.

Python model và TypeScript client là projection được sinh từ contract, không phải nguồn chuẩn thay thế.

### 8.2 Table và migration thuộc ai?

Mỗi table có đúng một capability owner. Ví dụ:

- `run_control`: run, config, idempotency, work, outbox, claim, trajectory/security event;
- `model_gateway`: provider profile reference và provider attempt;
- `source_access`: source registration/snapshot và managed metadata;
- `agent_runtime`: step, context allocation và tool-call projection;
- `judge`: candidate, verdict và evidence;
- `evaluation`: experiment, cell, approved score và export;
- `scoring`: ground-truth label, adjudication và score join.

`migrations/registry.py` chỉ compose metadata từ module. Nó không sở hữu business table.

## 9. Luồng đầy đủ từ lúc chọn repository đến lúc xem kết quả

### Bước 1 — Desktop kết nối runtime

Native shell tìm hoặc start local daemon. Renderer dùng generated client gọi health/runtime-info và kiểm tra credential, version, contract digest, capability, health.

Chỉ khi connection state là `ready`, chức năng submit mới được bật.

### Bước 2 — Người dùng chọn repository

Native picker trả raw host path. Path này chỉ được tồn tại tạm trong source-registration request.

Việc người dùng chọn path không tự động cấp quyền cho agent. `source_access` vẫn phải:

1. canonicalize path bằng API phù hợp hệ điều hành;
2. kiểm tra loại object và quyền truy cập;
3. dùng checked/no-follow handle;
4. duyệt inventory có giới hạn;
5. loại symlink, special file, report, label, manifest, secret, VCS metadata, dependency và build output;
6. import byte được phép vào managed immutable storage;
7. tính revision, inventory digest và source tree digest;
8. tạo opaque `source_snapshot_id`;
9. bỏ raw path và handle.

Response chỉ trả snapshot ID, revision, tree digest và safe status.

### Bước 3 — Submit Judge run

Desktop gửi:

- canonical finding;
- `source_snapshot_id`;
- provider/experiment profile reference;
- resolved flag preset/override;
- budgets;
- idempotency key.

API không nhận raw repository path trong run submission.

### Bước 4 — Commit accepted run và durable work

Trong PostgreSQL, application atomically lưu:

- candidate;
- run ở trạng thái `accepted`;
- immutable run configuration;
- idempotency binding;
- work item/outbox intent.

Sau durable handoff, run chuyển `queued`. API trả HTTP 202 và `run_id` mà không chờ model.

### Bước 5 — Worker claim work

Worker dùng claim token, version và finite lease. Nó CAS `queued -> running`.

Worker cũ, stale claim hoặc duplicate delivery không được tự ý tiếp tục ghi event hay terminal state.

### Bước 6 — Context preflight

Trước mọi provider call, `agent_runtime` tính:

```text
input_capacity = context_limit - output_reserve
mandatory = system + candidate + tool definitions + verdict schema
optional = committed history + tool results
```

Nếu mandatory không fit, run dừng `budget_exhausted/context_budget`; không được tự cắt system prompt, candidate hoặc verdict schema.

Tool result được xử lý theo thứ tự:

1. authorize/classify;
2. redact secret/prohibited content;
3. bọc delimiter untrusted data;
4. truncate có tính quyết định;
5. digest;
6. mới được persist/send.

### Bước 7 — Gọi provider đúng một attempt quan sát được

`agent_runtime` gửi một `ProviderRequest` chuẩn hóa qua `model_gateway.public`.

Adapter:

- kiểm tra profile trước network;
- tạo đúng một non-streaming attempt;
- không tự retry;
- không tự gọi tool;
- không giữ conversation state làm authority;
- trả normalized response/error và telemetry.

Mọi history được dựng lại từ event đã commit trong PostgreSQL. Provider thread hoặc `previous_response_id` không phải nguồn sự thật.

### Bước 8 — Xử lý tool intent hoặc verdict proposal

Nếu model yêu cầu tool, `agent_runtime` gọi `source_access.public`. Tool được settle đúng một lần và kết quả được commit trước khi xây context tiếp theo.

Nếu model đề xuất verdict, Harness tự validate JSON Schema, semantic rule và evidence. Provider báo structured output thành công chưa đủ để verdict được chấp nhận.

### Bước 9 — Lặp hoặc dừng

Orchestrator kiểm tra:

- cancellation;
- wall clock;
- cost;
- total token;
- maximum steps;
- context budget;
- no progress;
- repair allowance.

Nếu còn hợp lệ, nó rebuild context từ committed history và thực hiện bước tiếp theo. Không có hidden loop trong adapter hoặc SDK.

### Bước 10 — Atomic terminal commit

Một verdict hợp lệ cùng evidence được commit atomically với aggregates, `run.completed` và terminal state.

Nếu lỗi không phục hồi, run thành `failed`. Nếu cancellation được quan sát ở safe boundary, run thành `cancelled`. Nếu chạm budget, run thành `budget_exhausted`.

### Bước 11 — Desktop poll trace

Desktop poll status và finite event pages bằng cursor. Nó render theo `sequence`, không theo timestamp.

Nếu desktop đóng hoặc mất mạng, worker vẫn tiếp tục. Khi kết nối lại, desktop resume cursor, de-duplicate `(run_id, sequence)` và dựng lại view từ PostgreSQL-authoritative API.

### Bước 12 — Scoring sau terminal

Evaluator gửi canonical experiment-cell ID và terminal run ID tới scorer process, không tự đọc label.

Scorer:

1. xác minh terminal subject qua `evaluation.public`;
2. đọc ground truth bằng scorer-only credential;
3. tính scoring detail trong scorer-only schema;
4. gửi `ApprovedScoreV1` không chứa label về `evaluation.public`.

Score không phải run event và không quay lại agent context.

## 10. Judge run lifecycle

Các state hợp lệ:

```text
accepted -> queued -> running -> completed
   |          |          +----> failed
   |          |          +----> cancelled
   |          |          +----> budget_exhausted
   |          +---------------> failed/cancelled
   +--------------------------> failed/cancelled
```

Terminal states là:

- `completed`;
- `failed`;
- `cancelled`;
- `budget_exhausted`.

Terminal state bất biến. Late response, duplicate queue delivery hoặc stale worker không được sửa terminal result.

### 10.1 Idempotency

Cùng idempotency key và cùng canonical request digest trả lại run cũ. Cùng key nhưng digest khác trả conflict. Không được tạo hai run.

### 10.2 CAS và state version

Mỗi transition mang expected state/version. Update zero row nghĩa là caller đã stale và phải reload. Không retry terminal write một cách mù quáng.

### 10.3 Thứ tự budget khi nhiều limit cùng hết

Nếu nhiều limit cùng được thấy tại một safe boundary, chọn một terminal reason theo thứ tự:

1. `wall_clock`;
2. `cost_budget`;
3. `total_tokens`;
4. `max_steps`;
5. `context_budget`;
6. `no_progress`.

Tất cả limit quan sát được vẫn ghi telemetry, nhưng chỉ có một primary terminal reason.

## 11. Bốn tool duy nhất của Judge MVP

### 11.1 `read_file` v1

Đọc text file theo relative path và optional line range, có hard byte/line limit, source digest và truncation metadata.

### 11.2 `list_dir` v1

Liệt kê file/directory theo lexical order. Không trả host metadata, inode, owner hoặc symlink target.

### 11.3 `glob` v1

Match pattern trong inventory đã được authorize, trả relative path theo lexical order và omitted count.

### 11.4 `search_text` v1

Tìm literal UTF-8 query, optional safe glob filter, trả path/line/excerpt theo thứ tự xác định. Regex chưa được cho vào v1.

### 11.5 Tool không tồn tại

Judge không có:

- write/delete/rename;
- shell/exec/process;
- package manager hoặc VCS;
- environment-variable reader;
- network, URL hoặc web fetch;
- raw file descriptor;
- provider-hosted tool;
- plugin/skill discovery;
- dynamic tool installation;
- arbitrary repository selection;
- PoC/Forge/test execution.

Một config, prompt, model request hoặc nút approval không thể làm capability bị loại tự nhiên xuất hiện. Muốn thêm phải có contract, threat model và change riêng.

## 12. Path security và source custody

Tool path chỉ là UTF-8 POSIX relative path trong snapshot đã được giải quyết sẵn.

Trước I/O, hệ thống từ chối:

- POSIX absolute path;
- Windows drive/UNC path;
- URI;
- NUL/control character;
- backslash hoặc separator không canonical;
- `.` hoặc `..` segment;
- encoded traversal;
- symlink escape;
- entry không nằm trong immutable inventory;
- file type không được phép;
- digest mismatch.

Denial xảy ra trước content read và sinh:

- model-actionable safe tool error;
- `security.blocked` event riêng;
- rule ID và safe category;
- không lưu raw forbidden path hoặc prohibited content.

## 13. Ground truth được cô lập như thế nào?

Đây là invariant quan trọng nhất của đồ án.

### 13.1 Agent được thấy gì?

Agent có thể thấy:

- canonical `CandidateFinding`;
- source content được lấy từ immutable snapshot qua bounded tool;
- system prompt, tool schema và verdict schema;
- exact sanitized committed history;
- safe tool/provider error.

### 13.2 Agent tuyệt đối không được thấy gì?

- `GroundTruthLabel`;
- adjudication;
- official report;
- scoring metadata/detail;
- dataset split logic dưới dạng model input;
- provider credential;
- raw host path;
- scorer schema/credential/query.

### 13.3 Isolation không chỉ dựa vào prompt

Blueprint dùng nhiều lớp:

- source-only managed snapshot;
- bốn-tool immutable registry;
- separate scorer capability và entrypoint;
- scorer-only DB role/schema;
- daemon/worker/evaluator không có scorer grant/credential;
- import deny cho `scoring` ngoài scorer root;
- scorer-only schema bị loại khỏi local OpenAPI và desktop generator;
- score chỉ đi một chiều qua label-free `ApprovedScoreV1`;
- adversarial tests kiểm tra mọi forbidden edge.

Prompt chỉ nhắc model hành xử đúng; nó không phải security boundary.

## 14. Verdict có cấu trúc

Verdict bắt buộc có:

- `schema_version`;
- `validity`;
- `severity`;
- `confidence`;
- `rationale`;
- ít nhất một `evidence`;
- `verification_status`;
- `label_normalization_version`.

Cross-field rules:

| Validity    | Severity hợp lệ                           |
| ----------- | ------------------------------------------- |
| `valid`   | `low`, `medium`, `high`, `critical` |
| `invalid` | `none`                                    |

`confidence` nằm trong `[0,1]` nhưng không được tuyên bố là calibrated probability.

Evidence phải có:

- authorized relative source path;
- one-based inclusive start/end line;
- digest của exact source span;
- optional note.

Evidence missing, outside root, symlink escape, reversed range, stale file hoặc digest mismatch đều ngăn `completed`.

Mọi verdict Judge MVP có:

```text
verification_status = unverified
```

`completed` chỉ có nghĩa là verdict schema/evidence hợp lệ, không có nghĩa đã chạy PoC.

## 15. Trajectory và observability

Trajectory là chuỗi event append-only, ordered theo `(run_id, sequence)`. Đây không phải ordinary mutable log.

Các event chính:

- `run.accepted`, `run.queued`, `run.started`;
- `context.allocated`, `context.transformed`;
- `provider.attempted`, `provider.failed`;
- `model.responded`;
- `tool.requested`, `tool.completed`, `tool.failed`;
- `security.blocked`;
- `verdict.validation_failed`;
- `run.cancel_requested`;
- `run.completed`, `run.failed`, `run.cancelled`, `run.budget_exhausted`.

Không có scoring event trong run trajectory.

Mỗi run phải giữ đủ metadata để phân tích và tái lập điều kiện:

- model requested/resolved;
- provider profile ID/version/digest;
- SDK/capability/cutoff/pricing version;
- prompt ID/version/digest;
- tool definition/schema digest;
- resolved flags;
- budgets và sampling;
- native token usage;
- logical token usage;
- queue/provider/tool/end-to-end latency tách riêng;
- decimal cost, currency và pricing version;
- ordered tool calls;
- safe exact model-visible request/response;
- transformation/redaction/truncation version;
- runtime/build/commit/dependency-lock identity.

Raw secret, raw host path, label và prohibited original không được lưu hoặc hash vào run-visible trajectory.

## 16. Context và budget

Mỗi provider call đều phải preflight. Không được tin rằng call trước fit thì call sau cũng fit.

Mandatory content gồm:

- system instruction;
- candidate finding;
- tool definitions;
- verdict schema;
- output reserve.

Optional content gồm committed history và tool result. MVP chưa có semantic compaction. Nếu history omission không được flag/version hóa thì hết chỗ phải dừng, không tự thay đổi ngữ nghĩa.

Stop controls gồm:

- maximum steps;
- total logical tokens;
- wall clock;
- context capacity;
- cost;
- optional no-progress detector.

No-progress v1 ký normalized intent, ordered tool-name/arguments digest và verdict-validation outcome. Chỉ hoạt động khi flag bật.

## 17. Provider abstraction và profile gate

### 17.1 Project-owned request/response

`ProviderRequest` mang:

- profile và experiment reference;
- run/step/attempt ID;
- exact ordered committed messages;
- local tool definitions nếu có;
- response schema;
- sampling/seed;
- max output tokens;
- timeout.

Nó không mang credential, raw host path, ground truth, hosted-tool config, automatic callback, provider thread hoặc arbitrary native kwargs.

`ProviderResponse` giữ safe native request ID, requested/resolved model, assistant content, tool intents, structured-output candidate, native/normalized finish reason, usage và timing.

`ProviderError` giữ normalized category và safe metadata, không giữ raw header/credential/unreviewed native error.

### 17.2 Pre-network gate

Trước client construction hoặc credential access, phải kiểm tra:

- provider profile schema/status/digest;
- exact model snapshot;
- official SDK exact version;
- capability/context/cutoff evidence;
- pricing/currency/source;
- credential owner;
- paid call/cost ceiling;
- approver/date/digest;
- experiment profile và matched-arm equality;
- retry/stream/tool settings.

Thiếu một mục thì trả `pre_network_profile_rejected`; không DNS, không SDK client, không credential và không cost.

### 17.3 Deterministic providers

Hai profile không mạng dùng chung contract:

- `deterministic-scripted-v1`: mô phỏng ordered message, tool intent, verdict và metadata;
- `deterministic-faults-v1`: mô phỏng auth, rate limit, timeout, unavailable, malformed response, mismatch và failure path.

Chúng cho phép làm architecture/contract/lifecycle tests mà chưa cần real model.

## 18. PostgreSQL và khả năng phục hồi

PostgreSQL là source of truth cho:

- source snapshot metadata;
- run/config/lifecycle;
- work item và outbox;
- claim/lease/version;
- ordered events;
- provider attempt và tool call;
- verdict/evidence;
- experiment/cell;
- scorer-controlled records.

Không được dùng các thành phần sau làm authority thay thế:

- SQLite;
- Redis;
- in-memory queue;
- daemon/worker process memory;
- renderer cache;
- HTTP connection;
- filesystem rendezvous record.

### 18.1 Vì sao có work item, outbox, claim và lease?

- `work_item` biểu diễn công việc durable;
- `outbox_record` biểu diễn ý định giao việc được commit cùng transaction;
- `work_claim` biểu diễn worker đang có quyền xử lý trong finite lease;
- version/CAS ngăn worker cũ ghi đè;
- redelivery có thể lặp nhưng event/terminal transition không được nhân đôi.

### 18.2 Provider call không thể exactly-once tuyệt đối

Nếu process crash sau khi provider đã xử lý nhưng trước khi response được commit, hệ thống có thể không biết call có phát sinh chi phí hay không. Blueprint yêu cầu ghi `attempt_outcome_unknown`, không giả vờ chưa gọi và không tự replay primary cell.

Đây là honesty boundary của thiết kế distributed/external call.

## 19. Local asynchronous API

OpenAPI hiện định nghĩa chín đường dẫn:

| Method và path                            | Mục đích                                     |
| ------------------------------------------ | ----------------------------------------------- |
| `GET /health`                            | runtime health                                  |
| `GET /runtime-info`                      | version/contract/capability handshake           |
| `POST /source-snapshots`                 | đăng ký repository và tạo managed snapshot |
| `POST /judge-runs`                       | submit async Judge run                          |
| `GET /runs/{run_id}`                     | đọc state và terminal projection             |
| `GET /runs/{run_id}/events`              | đọc finite ordered event page                 |
| `POST /runs/{run_id}/cancel`             | yêu cầu cancellation idempotent               |
| `POST /runtime-lifecycle/shutdown`       | explicit runtime shutdown                       |
| `POST /runtime-lifecycle/prepare-update` | quiesce/update preparation                      |

Toàn API được bảo vệ bằng local runtime credential hoặc OS-equivalent access control.

Các tính chất bắt buộc:

- submission trả `run_id` ngay;
- finite cursor polling là cơ chế correctness chính;
- streaming nếu có sau này chỉ là projection;
- partial run không có final verdict;
- cursor bị bind vào run/sequence/policy;
- desktop reconnect dựng lại view từ committed resources;
- source registration là nơi duy nhất nhận selected raw path;
- local OpenAPI không có ground-truth/scoring route hoặc scorer-only schema.

## 20. Desktop UX cần hiển thị gì?

### 20.1 Các view chính

- runtime connection;
- repository registration;
- new Judge run;
- run detail;
- evidence navigation;
- safe evaluation aggregates;
- explicit runtime lifecycle controls.

### 20.2 Connection states

- `runtime_starting`;
- `ready`;
- `runtime_unavailable`;
- `unauthorized_local`;
- `incompatible_version`;
- `reconnecting`.

Các state này không thay thế run state.

### 20.3 Run detail

Run page cần có:

1. connection/stale banner;
2. run identity/state/timestamps/cancel action;
3. immutable config/profile/prompt/tool/schema/flag/budget summary;
4. steps, attempts, tools, tokens, latency, cost và security blocks;
5. ordered trace;
6. terminal panel;
7. reproduction digest/export reference và stochastic caveat.

Chỉ `completed` mới hiển thị verdict. `failed`, `cancelled` và `budget_exhausted` không được hiện partial verdict như final.

### 20.4 Disclosure rules

Desktop phải:

- escape untrusted text;
- không execute Markdown/HTML/script;
- không tự fetch URL;
- không có “show original” cho redacted content;
- không hiện raw blocked argument, secret hoặc host path;
- evidence navigation theo run-bound ordinal, không cho nhập arbitrary path;
- export từ cùng safe API projection.

## 21. Evaluation: so sánh direct và harness như thế nào?

### 21.1 Matched pair

Mỗi pair có cùng:

- `case_id`;
- `repeat_index`;
- candidate bytes/digest;
- source snapshot ID/revision/tree digest;
- accepted provider profile/model;
- sampling/seed semantics;
- logical-token budget;
- output reserve;
- wall-clock ceiling;
- Judge core prompt;
- verdict schema;
- scorer semantics;
- safety invariants.

### 21.2 Khác biệt có chủ đích giữa hai arm

| Direct                             | Harness                               |
| ---------------------------------- | ------------------------------------- |
| Judge core + direct wrapper        | cùng Judge core + harness wrapper    |
| một deterministic`SourceBundle` | bốn local source tools               |
| đúng một model call             | bounded multi-turn agent loop         |
| không tool feedback/repair/loop   | có thể bật theo frozen flag preset |
| không memory/PoC                  | cũng không memory/PoC trong MVP     |

Wrapper không giống nhau hoàn toàn, vì source access chính là treatment. Nhưng exact byte/digest và khác biệt phải được công khai.

### 21.3 SourceBundle v1

Direct arm không có tool nên nhận bundle deterministic:

1. ưu tiên file được candidate nhắc tới;
2. thêm các text file còn lại theo lexical path;
3. chỉ thêm nguyên file nếu block fit budget;
4. file không fit được ghi vào omissions block;
5. dùng delimiter cố định;
6. hash exact UTF-8 bundle bytes.

Bundle và harness tool đều bắt đầu từ cùng immutable snapshot và exclusion policy.

### 21.4 Logical-token fairness

Harness nhiều call nên không được chỉ đếm token mới thêm. Mỗi call đếm toàn bộ input được gửi lại, gồm:

- repeated history;
- cached input;
- tool definitions;
- tool results;
- prompt;
- output/reasoning theo formula đã khai báo.

Cached discount chỉ ảnh hưởng billing category, không làm logical input biến mất.

Tool execution time tính vào wall clock, không biến thành token credit.

### 21.5 Primary retry symmetry

Primary direct và harness đều:

- SDK retry = 0;
- project retry flag = false;
- một attempt cho mỗi logical provider call.

Transient failure vẫn được giữ trong denominator. Retry-enabled study phải có profile/flag/experiment identity khác và bật đối xứng cho cả hai arm.

## 22. Dataset split và contamination

### 22.1 Chia theo contest và source family

Mỗi contest thuộc đúng một split:

- `train`;
- `validation`;
- `test`.

Mỗi contest cũng thuộc đúng một `source_family_id`. Các contest có chung code lineage, fork ancestry hoặc protocol family không được nằm ở các split khác nhau.

Không chia theo finding.

### 22.2 Quyền sử dụng từng split

- train: phát triển implementation, prompt và tool;
- validation: chọn budget, flag, repeat, threshold và stopping rule;
- frozen test: chỉ dùng cho confirmatory report sau khi experiment profile đã Accepted.

Test result/trace/label không được quay lại điều chỉnh cùng profile. Nếu thay đổi, phải tạo protocol/profile mới và cần test source chưa bị dùng.

### 22.3 Knowledge-cutoff bucket

Mỗi contest được phân loại theo immutable model snapshot:

- `pre_cutoff`;
- `post_cutoff`;
- `unknown`.

Thiếu cutoff evidence phải là `unknown`, không được quảng bá thành post-cutoff. Bucket này là subgroup về contamination, không thay thế train/validation/test split.

## 23. Repeats, metrics và thống kê

### 23.1 Repeat có ý nghĩa gì?

Repeat đo stochastic variability trong cùng case. Nó không phải independent sample mới.

Inference dùng contest làm cluster chính. Khi bootstrap/resample một contest, mọi case, repeat và arm trong contest đó đi cùng nhau. Source-family clustered sensitivity được báo thêm khi đủ family.

Report phải tách rõ số lượng:

- contests;
- source families;
- cases;
- repeats;
- cells.

### 23.2 Cell classification

Predicted `valid` là positive:

- valid/valid = TP;
- invalid/valid = FP;
- invalid/invalid = TN;
- valid/invalid = FN.

Nếu ground truth valid nhưng run không có completed schema-valid prediction, cell vẫn là FN theo frozen rule và đồng thời được ghi failure/completion class riêng. Failed invalid case không tự động là TN.

### 23.3 Metrics bắt buộc

- precision;
- recall;
- completion rate;
- schema-failure rate;
- matched harness-minus-direct delta;
- contest-cluster confidence interval;
- logical/native token usage;
- cost;
- queue/provider/tool/end-to-end latency;
- repeat agreement/dispersion;
- breakdown theo cutoff, contest và source family.

Mọi declared cell phải còn trong denominator; không được xóa failure để làm số đẹp.

### 23.4 RQ1 conclusion gate

Trước khi xem frozen test, profile phải chốt:

1. minimum precision gain;
2. maximum recall loss;
3. minimum completion rate;
4. exact decision rule và cách xử lý undefined metric.

Kết luận:

| Precision | Recall   | Completion | Kết luận                                               |
| --------- | -------- | ---------- | -------------------------------------------------------- |
| pass      | pass     | pass       | `positive`                                             |
| fail      | pass     | pass       | `negative` hoặc `inconclusive` theo rule đã chốt |
| bất kỳ  | fail     | bất kỳ   | `mixed`                                                |
| bất kỳ  | bất kỳ | fail       | `mixed`                                                |

Precision tăng không được che giấu việc recall sụp hoặc hệ thống không hoàn thành run.

## 24. Config flags và ablation

Mọi behavior tùy chọn có thể ảnh hưởng kết quả phải có:

- stable flag name/type/default/version;
- dependencies;
- arm values;
- telemetry field;
- immutable run-snapshot field;
- enabled acceptance ID;
- disabled acceptance ID.

Các feature flag hiện có:

1. `agent_loop`;
2. `source_tools`;
3. `tool_result_truncation`;
4. `no_progress_detection`;
5. `verdict_schema_repair`;
6. `provider_retry`;
7. `tool_error_feedback`;
8. `structured_output_mode`;
9. `tool_description_profile`.

Các invariant không được tắt:

- ground-truth isolation;
- contest-level split;
- source-snapshot integrity;
- path authorization;
- secret/prohibited redaction;
- context preflight và output reserve;
- verdict/evidence validation;
- exact sanitized trajectory.

Tắt safety invariant không tạo một ablation hợp lệ; nó làm thí nghiệm vô nghĩa hoặc không an toàn.

## 25. Data classification và thứ tự transformation

Các lớp chính:

| Class                   | Ví dụ                                    |
| ----------------------- | ------------------------------------------ |
| `PUBLIC_SAFE`         | safe local API projection                  |
| `AGENT_UNTRUSTED`     | candidate, source, model/tool content      |
| `CONTROL_INTERNAL`    | config, manifest/profile metadata          |
| `EPHEMERAL_SENSITIVE` | native selected raw path                   |
| `SCORER_ONLY`         | label, adjudication, score detail          |
| `EVALUATION_PUBLIC`   | label-free approved aggregate              |
| `SECRET`              | credential/token                           |
| `PROHIBITED`          | ground truth/original không được phép |

Thứ tự bắt buộc:

```text
classify/authorize
-> redact
-> delimit as untrusted
-> bound/truncate
-> digest
-> persist/send/render/export
```

Không được truncate trước rồi mới redact, vì secret có thể bị cắt thành dạng khó phát hiện nhưng vẫn lộ.

Ordinary log chỉ giữ correlation ID, safe category, duration, count và rule ID. Exact sanitized model-visible content thuộc controlled trajectory store, không thuộc console log.

## 26. Ownership của sáu thành viên

| Track | Trách nhiệm chính                                                                         |
| ----- | -------------------------------------------------------------------------------------------- |
| TV1   | kiến trúc,`run_control`, `agent_runtime`, `judge`, `model_gateway`, worker closure |
| TV2   | context allocation, token accounting, budget/stop mechanics trong`agent_runtime`           |
| TV3   | source-tool contract và registry trong`source_access`                                     |
| TV4   | source/workspace security, redaction, threat model, scorer isolation                         |
| TV5   | evaluation protocol/profile, statistics, scoring methodology                                 |
| TV6   | PostgreSQL mechanics, daemon/local API, generated client, desktop và release integration    |

Owner không có nghĩa làm một mình. Contract đổi phải có consumer review; data/security cần TV4; behavior ảnh hưởng kết quả cần TV5.

## 27. Thứ tự implementation theo work package

### WP-01 — Foundation và canonical contracts

Scaffold stack đã chốt, capability boundaries, canonical contracts, generation pipeline và architecture tests. Native shell đã chốt Tauri 2 (ADR-007 Accepted); readiness spike evidence vẫn chờ WP-01/WP-10.

### WP-03, WP-04, WP-05, WP-06 — Các nền song song sau WP-01

- WP-03: provider port, hai deterministic adapter và OpenAI adapter có gate;
- WP-04: context planner và budget enforcement;
- WP-05: source registration, managed snapshot, tool và security;
- WP-06: PostgreSQL event/work/outbox/claim/lease persistence.

### WP-02 — Judge orchestration

Ghép lifecycle, agent loop, provider, context, tool, verdict repair và terminal commit. Phụ thuộc interface của WP-03–WP-05 và foundation.

### WP-07 — Local API và desktop

Xây protected async API, generated client, polling/reconnect và trace-first UI. Phụ thuộc orchestration, source security và persistence.

### WP-08 — Evaluation

Xây scheduler, manifest/profile drift checks, matched pair, ApprovedScore acceptance và report. Result-bearing run vẫn chờ experiment profile Accepted.

### WP-09 — Isolated scorer

Xây scorer process, scorer-only role/schema, post-terminal join và negative proof rằng process khác không thể đọc label.

### WP-10 — Integrated acceptance và release evidence

Chạy deterministic end-to-end trước, sau đó mới thực hiện real RQ1 khi mọi profile/gate đã được chấp nhận.

Dependency rút gọn:

```text
WP-01
├── WP-03 provider
├── WP-04 context
├── WP-05 source/security
├── WP-06 persistence
└── WP-02 orchestration (dùng interface WP-03..05)

WP-02 + WP-05 + WP-06 -> WP-07 API/desktop
WP-02 + WP-06 + WP-07 -> WP-08 evaluation
WP-06 + WP-08 -> WP-09 scorer
WP-02 + WP-05..09 -> WP-10 integration/release
```

## 28. Architecture tests cần có trong tương lai

Blueprint yêu cầu code implementation phải có các nhóm kiểm tra như:

- capability chỉ import capability khác qua `.public`;
- graph không có cycle;
- public type không import FastAPI, SQLAlchemy, provider SDK hoặc shell type;
- table/migration có đúng một owner;
- shared kernel/platform không chứa business logic;
- entrypoint chỉ wiring;
- non-scorer closure không import `scoring` hoặc scorer schema;
- evaluator không reverse-import scoring;
- desktop generated graph không chứa scorer-only schema;
- generated output không drift khỏi canonical contract;
- daemon/worker/evaluator DB role không có scorer grant;
- chỉ bốn Judge tool được compose;
- path, registration, prompt injection, secret, volume và capability attacks đều fail an toàn.

Security phải được chứng minh bằng sự vắng mặt của forbidden route/import/grant, không chỉ bằng runtime permission hoặc prompt.

## 29. Những giới hạn phải nói thật khi bảo vệ

Ngay cả khi implementation tương lai pass hết blueprint, nhóm không được tuyên bố quá mức:

- không có full prompt-injection prevention;
- secret detector có thể bỏ sót format lạ;
- provider external call không exactly-once qua mọi crash;
- local process access control không phải production multi-tenant security;
- stochastic LLM output không byte-identical reproducible;
- `completed` không phải PoC verified;
- post-cutoff bucket không hoàn toàn loại bỏ training contamination;
- blueprint validation không phải runtime/security/scientific evidence.

Sự minh bạch này làm luận văn mạnh hơn, không yếu hơn.

## 30. Extension point cho các giai đoạn sau

### VerificationRunner

Nhận terminal verdict và immutable snapshot qua contract riêng, chạy trong process/sandbox riêng, có command allowlist, resource/network policy và output contract riêng. Không trở thành Judge tool và không được đọc ground truth.

### Audit mode

Cần capability và workflow riêng cho planning toàn repo, finding generation, deduplication và audit metrics. Không thêm mode branch rải rác trong Judge.

### Long-term memory và compaction

Cần provenance, split reset, contamination control, ablation flag và fidelity test riêng.

### Nhiều provider và RQ3

Thêm adapter sau `model_gateway.public`, mapping/conformance riêng và profile/cutoff/pricing evidence riêng. Không thay core loop.

### Static analyzer/general agent cho RQ2

Thêm experiment arm và fairness/normalization rules riêng, không tái sử dụng metric một cách mơ hồ.

### Offline replay/demo

Dựa trên content-addressed event và trace mapping, nhưng replay chỉ là projection, không trở thành lifecycle authority.

## 31. Các hiểu lầm thường gặp

### “Có desktop thì tại sao cần backend?”

`daemon`/worker là local runtime nằm trên cùng máy, không phải public backend SaaS. Nó cần thiết để run sống lâu hơn cửa sổ, giữ security boundary và phục hồi từ PostgreSQL.

### “Capability-first thì bên trong không được có layer?”

Có thể có `domain/application/ports/adapters`, nhưng chúng nằm bên trong từng capability và chỉ tồn tại khi hữu ích. Trục tổ chức cấp hệ thống là capability; layer chỉ là cấu trúc cục bộ.

### “Tại sao không có một thư mục adapter chung?”

Vì adapter chung làm mất owner. OpenAI adapter thuộc `model_gateway`; filesystem adapter thuộc `source_access`; DB adapter thuộc capability sở hữu table. `platform` chỉ giữ technical mechanism chung.

### “Scoring cùng monolith thì có thật sự cô lập không?”

Có thể, vì code repository chung không đồng nghĩa dependency closure và credential chung. Chỉ scorer entrypoint compose `scoring`; process khác không có import, generated schema, DB grant hoặc credential. Cần test chứng minh các ranh giới này.

### “ADR-002 Accepted thì gọi OpenAI được chưa?”

Chưa. ADR-002 chốt integration strategy. `real-primary` vẫn Proposed và `network_ready: false`.

### “ADR-003 Accepted thì chạy RQ1 được chưa?”

Chưa. ADR-003 chốt methodology. Experiment profile chưa có frozen dataset, repeat, threshold, budget, approval và `execution_ready: true`.

### “Verdict completed có phải đã xác minh lỗi không?”

Không. Nó chỉ đã qua schema/evidence validation. `verification_status` vẫn là `unverified`.

### “Tại sao không dùng Redis queue?”

MVP dùng PostgreSQL work/outbox/claim/lease để có một durable authority, giảm infrastructure và tránh ambiguity do nhiều nguồn state. Redis không bị cấm vĩnh viễn, nhưng muốn thêm cần bằng chứng và quyết định mới.

### “Tại sao direct arm được nhìn cả SourceBundle còn harness dùng tool?”

Đó là treatment cần so sánh: direct nhận source tĩnh một lần, harness chủ động khám phá source qua loop. Hai arm vẫn dùng cùng source snapshot, Judge core, model, schema và tổng logical-token budget.

## 32. Trình tự đọc blueprint gốc khi cần đi sâu

Sau khi đọc tài liệu này, hãy quay lại file gốc theo nhu cầu:

1. Quyết định và trạng thái: `blueprint/decisions/README.md` và ADR-001…007.
2. Cấu trúc code: `blueprint/architecture/physical-repository-layout.md`.
3. Module/owner/dependency: `blueprint/architecture/components-and-ownership.md`.
4. Product/process topology: `blueprint/architecture/desktop-runtime-topology.md`.
5. Agent loop: `blueprint/architecture/agent-runtime-boundaries.md` và `end-to-end-sequences.md`.
6. Lifecycle: `blueprint/architecture/judge-lifecycle.md`.
7. Contract: `blueprint/contracts/` và `blueprint/providers/`.
8. Persistence: `blueprint/persistence/`.
9. Security: `blueprint/security/`.
10. Evaluation: `blueprint/evaluation/`.
11. Desktop UX: `blueprint/desktop/`.
12. Chia việc và thứ tự code: `blueprint/delivery/implementation-work-packages.md`.

## 33. Bản tóm tắt một trang

Nếu chỉ nhớ mười điều, hãy nhớ:

1. Đây là blueprint của Judge MVP, chưa phải code.
2. Sản phẩm là desktop app mỏng kết nối local Python runtime độc lập.
3. PostgreSQL là authority cho run, work, claim, event và recovery.
4. Runtime là capability-first modular monolith, không phải layer-first hay microservices.
5. Agent loop do Harness sở hữu; provider adapter chỉ làm một attempt và không gọi tool.
6. Judge chỉ có bốn read-only source tool trên managed immutable snapshot.
7. Ground truth chỉ tồn tại trong scorer process sau terminal và không quay lại trajectory/API/desktop.
8. Mọi verdict hiện tại là `unverified`.
9. RQ1 so direct với harness bằng matched pair, cùng model và tổng logical-token budget, split theo contest + source family.
10. ADR-001…007 đã Accepted; real provider profile và concrete RQ1 profile vẫn là gate chưa mở.

Khi bắt đầu code, đừng scaffold toàn bộ cây thư mục cùng lúc. Bắt đầu từ WP-01 và một vertical slice deterministic nhỏ, dùng contract, architecture test và PostgreSQL transaction làm xương sống. Real provider, frozen test, native shell và paid experiment chỉ bắt đầu khi gate tương ứng được chấp nhận.
