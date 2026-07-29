# Kế hoạch triển khai Slice 1 — Walking Skeleton

> **Trạng thái:** Implementation Plan v1.0
> **Nguồn quyết định:** [`06-blueprint.md`](06-blueprint.md), đặc biệt Mục 3, 7, 8, 9, 15-17 và 20-22
> **Phạm vi:** Chỉ Slice 1. Không triển khai trước tính năng của Slice 2 trở đi.

---

## 1. Mục tiêu của Slice 1

Slice 1 phải chứng minh kiến trúc có thể chạy xuyên suốt bằng một luồng Judge tối thiểu:

```text
Judge input
  → tạo Run và RunConfigSnapshot
  → compose prompt v0
  → fake provider yêu cầu gọi read_file
  → tool chỉ đọc source workspace được cấp
  → kết quả tool quay lại agent loop
  → fake provider trả structured Judge verdict
  → verdict được validate
  → Run hoàn thành và có trajectory trong bộ nhớ
```

Đầu ra quan trọng không phải số lượng module đã tạo, mà là một lát cắt end-to-end chạy được, deterministic,
không cần API key và không cần mạng.

### User story kiểm chứng

> Với một source fixture và một finding cần chấm, người phát triển chạy một lệnh. Hệ thống tạo Judge run,
> dùng fake provider gọi `read_file`, trả verdict có cấu trúc, lưu đúng các event quan trọng và kết thúc ở
> trạng thái `completed`.

---

## 2. Phạm vi bắt buộc

Slice 1 gồm đúng các khả năng sau:

1. pnpm workspace chạy trên Node.js LTS và TypeScript strict.
2. Contract/schema v0 tối thiểu.
3. Domain invariant tối thiểu cho Run và ToolCall.
4. Port cần thiết cho provider, workspace, run repository, event store, clock và ID generator.
5. In-memory adapter và filesystem workspace adapter.
6. Fake provider deterministic.
7. Prompt Judge v0 có version, component hash và aggregate hash.
8. Typed error taxonomy và lỗi tool mà model có thể đọc để sửa.
9. `read_file` có giới hạn workspace và tham số dòng.
10. Agent loop xử lý tuần tự một tool call trong một provider turn.
11. Structured Judge verdict.
12. End-to-end test cho verdict `valid` và `invalid`.
13. Quality gate chạy trên Windows và Linux.

### Không thuộc Slice 1

Không đưa các phần sau vào pull request của Slice 1:

- provider thật hoặc AI SDK adapter;
- SQLite, Drizzle, migration hoặc database-backed queue;
- API, SSE, web UI hoặc trace replay;
- `glob`, `grep`, `list_dir`, skill discovery hoặc registry production đầy đủ;
- compaction, truncation, session note hoặc long-term memory;
- Docker sandbox, Foundry hoặc verification;
- dataset thật, ground truth loader, scoring hoặc experiment campaign;
- parallel tool execution, multi-agent, plugin, MCP hoặc LSP;
- cost tracking theo giá provider thật.

Typed error và tham số recovery phải được biểu diễn trong contract/config từ Slice 1. Retry provider có
backoff, stream recovery và cancellation hoàn chỉnh thuộc Slice 3; không kéo implementation đó vào Slice 1.

---

## 3. Cấu trúc source tối thiểu

Chỉ tạo package khi package được triển khai cùng contract hoặc hành vi thật. Không merge package rỗng.

```text
harness/
├─ apps/
│  └─ worker/                 # composition root và deterministic demo
├─ packages/
│  ├─ contracts/              # Zod schema, JSON Schema và public type
│  ├─ domain/                 # invariant và state transition
│  ├─ application/            # CreateRun, RunJudge và application port
│  ├─ agent-runtime/          # agent loop tối thiểu
│  ├─ providers/              # ModelProvider port, ModelEvent và fake provider
│  ├─ tools-skills/           # tool contract, registry tối thiểu và read_file
│  ├─ trajectory/             # event sink/query port
│  └─ adapters/               # in-memory store, filesystem workspace, clock và ID
├─ config/
│  ├─ defaults.yaml
│  ├─ flags.yaml
│  ├─ runtime.yaml
│  └─ policies/
│     └─ judge.yaml
├─ tests/
│  ├─ contract/
│  ├─ integration/
│  ├─ fixtures/
│  └─ e2e/
├─ package.json
├─ pnpm-workspace.yaml
└─ tsconfig.base.json
```

Chưa tạo `protocol`, `web`, `evaluation`, `verification` hoặc `context-memory` vì Slice 1 chưa có hành vi
thuộc các package này.

### Dependency direction

```text
contracts
  ├─→ domain
  ├─→ providers
  ├─→ tools-skills
  └─→ trajectory

domain + contracts + agent-runtime
  → application

providers + tools-skills + trajectory + domain
  → agent-runtime

application ports + module ports
  → adapters

application + adapters
  → apps/worker
```

Các adapter được lắp tại composition root. `domain`, `application` và `agent-runtime` không import Node
filesystem, YAML parser, model SDK hoặc implementation của adapter.

---

## 4. Ownership và review

Trước khi viết schema, nhóm xác nhận owner và reviewer sau:

| Artifact | Owner chính | Review bắt buộc |
|---|---|---|
| `Run`, `RunConfigSnapshot`, provider turn | TV1 | TV2, TV5 |
| Prompt component, prompt manifest và hash | TV2 | TV1, TV5 |
| Tool definition, `ToolCall`, `ToolResult`, `ToolError` | TV3 | TV1, TV5 |
| Workspace boundary và test truy cập sai phạm vi | TV4 | TV3, TV1 |
| Judge input, `JudgeVerdict`, `Finding` | TV5 | TV1, TV6 |
| `RunEvent` và dữ liệu cần cho trace | TV6 | TV1, TV5 |
| `VerificationResult` schema placeholder v0 | TV4 | TV5 |

TV1 là integration owner của Slice 1. Integration owner không tự quyết định mọi contract; nhiệm vụ là giữ
critical path chạy được và giải quyết xung đột dependency.

---

## 5. Trình tự triển khai

Không bắt đầu theo module một cách độc lập rồi chờ cuối Slice mới tích hợp. Mỗi work package bên dưới phải
giữ walking skeleton ở trạng thái build/test được.

Mỗi checkbox nên được tạo thành một issue có owner và bằng chứng kiểm chứng. Không gộp nhiều checkbox không
liên quan vào cùng một issue chỉ để giảm số lượng task.

| Work package | Phụ thuộc | Kết quả chính |
|---|---|---|
| WP0 | Không | Acceptance contract và ownership |
| WP1 | WP0 | Workspace và quality gate |
| WP2 | WP0, WP1 | Contract/schema v0 đã freeze |
| WP3 | WP2 | Domain invariant và state machine |
| WP4 | WP2 | Port và adapter tối thiểu |
| WP5 | WP2, WP4 | Config snapshot và prompt hash |
| WP6 | WP2, WP4 | Registry tối thiểu và `read_file` |
| WP7 | WP2, WP5 | Fake provider deterministic |
| WP8 | WP3-WP7 | Judge agent loop tích hợp |
| WP9 | WP8 | Demo command end-to-end |
| WP10 | WP9 | Test pyramid và cross-platform gate |
| WP11 | WP10 | Review, bằng chứng và bàn giao |

### WP0 — Chốt execution contract của Slice 1

**Mục tiêu:** biến mô tả trong blueprint thành một acceptance scenario duy nhất mà cả nhóm hiểu giống nhau.

#### Công việc

- [x] Xác nhận implementation owner và ghi rõ reviewer trong Mục 4.
- [x] Chọn Node.js LTS major; pin trong `.node-version`, còn `engines` được tạo cùng root package ở WP1.
- [x] Chốt tên các lệnh chuẩn: `check`, `test`, `test:e2e:slice1`, `demo:slice1`.
- [x] Chốt fixture source, finding `valid`, finding `invalid` và expected verdict.
- [x] Viết expected event order của happy path trước khi viết agent loop.
- [x] Ghi rõ dữ liệu nào fake provider được script sẵn và dữ liệu nào runtime phải tự tạo.

Artifact: [`slice-1/acceptance-contract.md`](slice-1/acceptance-contract.md) và
[`decisions/2026-07-28-slice-1-runtime-tooling.md`](decisions/2026-07-28-slice-1-runtime-tooling.md).

#### Đầu ra

- owner/reviewer matrix được nhóm xác nhận;
- acceptance fixture spec;
- expected event sequence;
- không còn cách hiểu khác nhau về “Slice 1 hoàn thành”.

#### Gate WP0

TV1, TV3, TV5 và TV6 cùng review acceptance scenario. Chưa đạt gate thì không freeze schema.

---

### WP1 — Scaffold workspace và quality gate

**Mục tiêu:** mọi thành viên có cùng lệnh cài đặt, build, typecheck và test.

#### Công việc

- [x] Tạo root `package.json` ở chế độ private.
- [x] Tạo `pnpm-workspace.yaml`.
- [x] Bật TypeScript `strict`, `noUncheckedIndexedAccess` và source map.
- [x] Cấu hình formatter, linter, test runner và dependency-rule check.
- [x] Pin dependency bằng lockfile; CI dùng frozen lockfile.
- [x] Tạo config loader boundary, chưa đưa config toàn cục vào domain.
- [x] Tạo CI matrix Windows và Linux.
- [x] Chỉ tạo package khi work package triển khai package đó được merge cùng lúc.

#### Lệnh chuẩn dự kiến

```text
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:e2e:slice1
pnpm demo:slice1
```

`pnpm check` phải bao gồm format check, lint, typecheck và dependency-rule check.

#### Gate WP1

- fresh clone chạy được trên ít nhất một máy Windows khác máy scaffold;
- CI Windows và Linux cùng xanh;
- không có package rỗng;
- không cần API key hoặc network để chạy test.

Trạng thái gate sau implementation:

- [x] local frozen install, `check`, default test và Slice 1 fixture preflight;
- [x] không tạo package nghiệp vụ rỗng;
- [x] test sau khi install không cần network hoặc API key;
- [x] fresh checkout, frozen install và toàn bộ quality command chạy xanh trên GitHub-hosted Windows runner;
- [x] GitHub Actions Windows/Linux thực sự chạy xanh trên PR #1.

**WP1 closed:** PR #1 được merge vào `main` sau khi hai required status check cùng pass. GitHub-hosted runner
cung cấp môi trường sạch, độc lập với máy scaffold; việc clone repository trên máy thành viên khác thuộc bước
onboarding và không chặn WP1.

---

### WP2 — Contract/schema v0

**Mục tiêu:** tạo một nguồn schema duy nhất cho runtime validation, TypeScript type và JSON Schema gửi provider.

#### Nhóm schema bắt buộc

- [x] ID: `run_id`, `turn_id`, `message_id`, `tool_call_id`, `event_id`, `finding_id`.
- [x] `RunMode`, `RunStatus`, `ToolCallStatus`.
- [x] `Run` và `RunConfigSnapshot`.
- [x] Prompt component manifest và aggregate prompt hash.
- [x] Provider request, normalized `ModelEvent` và provider finish reason tối thiểu.
- [x] `ToolDefinition`, `ToolCall`, `ToolResult` và typed `ToolError`.
- [x] `RunEvent` discriminated union.
- [x] Judge input và `JudgeVerdict`.
- [x] `Finding` và `VerificationResult` contract v0 để đóng architecture-readiness gap; behavior verification
  chỉ được triển khai ở Slice 6.

#### Quy tắc schema

- dùng Zod đã pin trong lockfile;
- export type bằng inference từ schema, không viết lại interface tương đương;
- JSON Schema dùng native `z.toJSONSchema()`;
- enum/discriminated union không dùng string tùy ý;
- timestamp, sequence, version và hash có semantics được mô tả rõ;
- structured verdict không được parse từ văn xuôi;
- schema thay đổi phải có owner và consumer review.

#### Test bắt buộc

- valid fixture parse thành công;
- thiếu trường bắt buộc hoặc enum sai bị từ chối;
- encode/decode không làm mất dữ liệu;
- Zod runtime schema và JSON Schema có semantics tương đương trên fixture đại diện;
- `RunEvent` không chấp nhận payload của event type khác;
- `JudgeVerdict` giữ riêng `valid`, `invalid` và `uncertain`.

#### Gate WP2 — Contract freeze v0

TV1, TV3, TV5 và TV6 approve. Sau gate, thay đổi breaking phải kèm migration note hoặc decision record, kể cả
khi Slice 1 mới dùng in-memory storage.

**Trạng thái:** implementation và test bắt buộc đã hoàn thành; sẵn sàng review tại Gate WP2. Chưa đánh dấu
contract frozen trước khi gate được xác nhận.

---

### WP3 — Domain invariant và state machine

**Mục tiêu:** trạng thái hợp lệ được bảo vệ trong domain, không phụ thuộc adapter.

#### Công việc

- [ ] Implement transition:
  `queued → running → waiting_tool → running → completed|failed|cancelled`.
- [ ] Từ chối transition không hợp lệ, ví dụ `completed → running`.
- [ ] Bảo đảm ToolCall chỉ settle một lần.
- [ ] Bảo đảm Run chỉ `completed` khi có structured verdict hợp lệ.
- [ ] Không dùng trạng thái `done`.
- [ ] Định nghĩa typed invariant error.
- [ ] Định nghĩa stop reason tối thiểu cho `max_steps`, timeout, cancellation và internal failure.

`verifying` có thể tồn tại trong contract v0 nhưng chưa có use case ở Slice 1.

#### Test bắt buộc

- table test cho mọi transition hợp lệ;
- table test cho transition bị cấm;
- ToolCall không thể complete/error lần hai;
- verdict invalid schema không thể làm Run thành `completed`;
- stop reason được giữ khi Run thành `failed` hoặc `cancelled`.

#### Gate WP3

Domain test không cần filesystem, clock thật, provider hoặc database.

---

### WP4 — Port và adapter tối thiểu

**Mục tiêu:** agent core có thể test hoàn toàn bằng dependency giả và không biết implementation bên ngoài.

#### Port cần có

- [ ] `ModelProvider`;
- [ ] `Workspace`;
- [ ] `RunRepository`;
- [ ] `RunEventSink`/`EventStore`;
- [ ] `Clock`;
- [ ] `IdGenerator`;
- [ ] interface tối thiểu mà agent runtime dùng để resolve/execute tool.

#### Adapter cần có

- [ ] in-memory run repository;
- [ ] in-memory event store giữ đúng thứ tự event trong một run;
- [ ] deterministic clock cho test;
- [ ] deterministic ID generator cho test;
- [ ] filesystem source workspace adapter.

#### Workspace boundary

Filesystem adapter phải:

- chỉ nhận path tương đối;
- chuẩn hóa path theo hệ điều hành;
- từ chối absolute path;
- từ chối `..` thoát source root;
- từ chối symlink resolve ra ngoài source root;
- không expose ground-truth path cho runtime;
- trả typed error, không trả raw stack trace cho model.

#### Gate WP4

- adapter có contract test chung;
- thay in-memory adapter bằng adapter khác không sửa domain;
- boundary test chạy trên Windows và Linux.

---

### WP5 — Config snapshot và prompt v0

**Mục tiêu:** cùng input/config tạo cùng prompt manifest và hash.

#### Config tối thiểu

- [ ] `defaults.yaml`: model reference giả, mode, output contract version.
- [ ] `flags.yaml`: tools và prompt variant; các tính năng Slice sau mặc định tắt.
- [ ] `runtime.yaml`: `max_steps`, timeout và repair limit đã quyết định.
- [ ] `policies/judge.yaml`: workspace/tool policy tối thiểu của Judge mode.
- [ ] merge config theo thứ tự blueprint và validate trước khi tạo Run.
- [ ] tạo immutable `RunConfigSnapshot`.

#### Prompt component v0

1. harness policy;
2. Judge instruction;
3. workspace metadata không chứa ground truth;
4. enabled skill summary rỗng ở Slice 1;
5. budget/stop-condition reminder;
6. structured output contract.

Tool definition đi qua provider tool contract, không lặp toàn bộ trong system prompt.

#### Hashing

- normalize UTF-8 và line ending trước khi hash;
- canonicalize thứ tự component;
- mỗi component có `id`, `version`, content hash;
- aggregate hash phụ thuộc content và thứ tự component;
- lưu manifest/hash trong `RunConfigSnapshot`.

#### Test bắt buộc

- golden test cho prompt Judge v0;
- cùng input cho cùng hash trên Windows và Linux;
- đổi một component làm aggregate hash thay đổi;
- đổi thứ tự component làm hash thay đổi;
- config sai bị từ chối trước khi agent loop bắt đầu;
- prompt không chứa tool implementation hoặc ground truth.

---

### WP6 — Tool contract, registry tối thiểu và `read_file`

**Owner chính:** TV3
**Phối hợp:** TV1 về runtime contract, TV4 về workspace boundary, TV5 về trajectory fields.

**Mục tiêu:** agent gọi được một tool mà không hardcode `read_file` trong agent loop.

#### Registry tối thiểu

- [ ] đăng ký tool theo ID/version;
- [ ] từ chối ID trùng;
- [ ] resolve tool theo ID;
- [ ] validate input bằng Zod;
- [ ] gọi workspace qua port;
- [ ] trả `ToolResult` chuẩn;
- [ ] trả model-readable error cho lỗi có thể sửa;
- [ ] agent loop chỉ biết registry interface, không import `read_file`.

Tool visibility, mode filtering, concurrency, artifact truncation và registry production đầy đủ để Slice 4.

#### `read_file` v0

Input:

```yaml
path: string
start_line: positive integer | optional
end_line: positive integer | optional
```

Output phải có:

- title;
- nội dung có số dòng;
- metadata về path và khoảng dòng thực tế;
- artifact reference nếu contract yêu cầu;
- thông báo rõ khi file không tồn tại, khoảng dòng sai hoặc path bị chặn.

#### Model-readable error

Thông báo lỗi phải gồm:

1. error code ổn định;
2. chuyện gì xảy ra;
3. input nào không hợp lệ;
4. cách sửa an toàn;
5. không tiết lộ host path, stack trace hoặc cách vượt policy.

Ví dụ semantics:

```text
FILE_NOT_FOUND: "contracts/Vualt.sol" không tồn tại trong source workspace.
Hãy kiểm tra lại path và gọi read_file với một relative path hợp lệ.
```

#### Test bắt buộc

- đọc toàn bộ file;
- đọc một khoảng dòng;
- dòng bắt đầu/kết thúc biên;
- `start_line > end_line`;
- file không tồn tại;
- input sai kiểu;
- unknown tool;
- duplicate tool ID;
- absolute path;
- path traversal;
- symlink escape;
- lỗi trả cho model không chứa host path.

#### Gate WP6

TV1 ghép `read_file` thông qua registry interface mà không sửa agent core cho riêng tool này.

---

### WP7 — Fake provider deterministic

**Mục tiêu:** kiểm thử agent loop và demo hoàn toàn offline.

#### Scenario chính

Fake provider được script theo request:

1. Turn 1 nhận Judge prompt và tool definition.
2. Turn 1 phát normalized event và yêu cầu `read_file` fixture.
3. Turn 2 phải nhận đúng tool result trong chronological messages.
4. Turn 2 trả structured `JudgeVerdict`.

#### Scenario bổ sung

- [ ] direct structured verdict không gọi tool;
- [ ] malformed verdict để kiểm tra schema failure/repair boundary;
- [ ] tool error được đưa lại cho model;
- [ ] provider error được phân loại đúng nhưng chưa cần network backoff.

#### Quy tắc

- không gọi mạng;
- không dùng random;
- ID, clock và output được kiểm soát;
- fake phải assert request mà runtime gửi, không chỉ phát output mù;
- event fake phát ra phải cùng normalized `ModelEvent` contract mà provider thật sẽ dùng;
- không đưa logic đặc biệt dành cho fake vào agent core.

#### Gate WP7

Fake provider scenario chạy độc lập và thất bại rõ ràng nếu prompt, tool definition hoặc chronological
messages sai contract.

---

### WP8 — Application use case và agent loop

**Mục tiêu:** ghép toàn bộ đường chạy Judge nhưng vẫn giữ đúng dependency boundary.

#### Application

- [ ] `CreateRun` resolve config và tạo immutable snapshot.
- [ ] lưu Run ở trạng thái `queued`.
- [ ] `RunJudge` chuyển Run sang `running` và gọi agent runtime.
- [ ] application cập nhật trạng thái cuối qua repository port.
- [ ] mọi lỗi được map thành failure/cancellation rõ ràng.

#### Agent loop tối thiểu

1. nhận Run, Judge input và config snapshot;
2. kiểm tra stop condition;
3. compose provider request;
4. gọi `ModelProvider`;
5. normalize và ghi provider events;
6. nếu có một tool call, chuyển Run sang `waiting_tool`;
7. validate và execute qua registry;
8. ghi ToolCall/ToolResult event;
9. đưa tool result vào history theo đúng thứ tự;
10. chuyển Run lại `running`;
11. nếu có final result, validate `JudgeVerdict`;
12. hoàn thành hoặc thất bại bằng typed reason.

Không hardcode số turn bằng `if turn === 1`. Loop phải dựa trên model event và stop condition. Slice 1 chỉ
cho phép một tool call trong một provider turn và xử lý tuần tự; parallel/batch call thuộc Slice 4.

#### Error behavior tối thiểu

- schema/tool input error có thể sửa được phải trở thành model-readable tool result;
- permission/workspace denial không retry và không chỉ cách vượt policy;
- malformed verdict không được đánh dấu completed;
- internal invariant error kết thúc run;
- mọi nhánh lỗi phát event tương ứng;
- `max_steps` bảo vệ fake scenario bị loop vô hạn.

#### Gate WP8

Integration test chứng minh fake provider → `read_file` → fake provider → verdict hoạt động mà không import
adapter concrete vào domain/agent core.

---

### WP9 — Composition root và deterministic demo

**Mục tiêu:** cung cấp một lệnh để thành viên khác nhìn thấy Slice 1 chạy end-to-end.

#### Công việc

- [ ] Lắp dependency trong `apps/worker`, không dùng service locator toàn cục.
- [ ] Tạo source fixture nhỏ và finding công khai.
- [ ] Tạo `demo:slice1` chạy bằng fake provider.
- [ ] In kết quả ngắn: `run_id`, status, classification, evidence refs và số event.
- [ ] Lưu hoặc in trace tóm tắt để kiểm tra thứ tự.
- [ ] Process exit code khác 0 khi contract hoặc expected verdict sai.

Demo không phải API, TUI hoặc UI tạm thời. Không xây giao diện sẽ bị bỏ đi ở Slice 2.

#### Gate WP9

Một thành viên không viết code Slice 1 chạy được demo từ fresh clone theo README.

---

### WP10 — Test pyramid và cross-platform gate

**Mục tiêu:** chứng minh Slice 1 đúng bằng contract và behavior, không chỉ bằng một happy-path demo.

#### Contract test

- schema valid/invalid và encode/decode;
- Zod ↔ JSON Schema semantic fixture;
- fake provider phát normalized event;
- tool implementation tuân thủ Tool contract;
- in-memory store giữ đúng event order.

#### Unit test

- run-state transition;
- tool-call settlement;
- prompt composition/hash;
- config merge/snapshot;
- tool input validation;
- workspace path boundary;
- structured verdict validation;
- stop condition tối thiểu.

#### Integration test

- fake provider gọi `read_file` rồi trả verdict;
- tool error quay lại model dưới dạng sửa được;
- invalid verdict không hoàn thành Run;
- event payload khớp trạng thái Run/ToolCall.

#### End-to-end test

1. finding hợp lệ → `classification: valid`;
2. finding không hợp lệ → `classification: invalid`;
3. cả hai run có config snapshot, prompt hash và trajectory;
4. không scenario nào cần network hoặc API key.

#### Expected event order tối thiểu

Tên event chính xác được freeze tại WP2, nhưng semantics phải gồm:

```text
run_created
run_started
provider_turn_started
tool_call_requested
provider_turn_completed
tool_call_started
tool_call_completed
provider_turn_started
provider_turn_completed
verdict_produced
run_completed
```

Provider turn phải kết thúc ở safe boundary trước khi runtime thực thi tool hoặc validate final verdict. WP0
phải chốt payload và tên event cụ thể trước khi viết loop; không sửa expectation chỉ để test xanh.

#### Cross-platform

CI chạy cùng các lệnh trên:

- Windows;
- Linux;
- Node.js LTS major đã pin;
- frozen pnpm lockfile.

#### Gate WP10

Tất cả command chuẩn xanh trên hai hệ điều hành. Không chấp nhận “chạy trên máy người viết” làm bằng chứng.

---

### WP11 — Review, tài liệu và bàn giao

**Mục tiêu:** đóng Slice 1 bằng bằng chứng có thể tái lập và tạo điểm nối rõ cho Slice 2.

#### Công việc

- [ ] Review dependency graph, không có import ngược.
- [ ] Review runtime không nhìn thấy ground truth.
- [ ] Review fake-specific logic không lọt vào agent core.
- [ ] Ghi lệnh chạy và expected output vào README.
- [ ] Cập nhật `journal.md`: quyết định, lỗi đã gặp và bằng chứng Windows/Linux.
- [ ] Cập nhật architecture-readiness checklist:
  schema v0, fake-provider scenario, contract owner/reviewer.
- [ ] Liệt kê port sẽ được thay bằng persistent adapter ở Slice 2.
- [ ] Gắn log CI hoặc test report vào biên bản hoàn thành.

#### Gate đóng Slice 1

Chỉ đóng Slice 1 khi toàn bộ Definition of Done ở Mục 8 đạt.

---

## 6. Critical path và công việc song song

### Critical path

```text
WP0 Acceptance contract
  → WP1 Workspace
  → WP2 Schema v0
  → WP3 Domain + WP4 Ports
  → WP6 Tool + WP7 Fake provider
  → WP8 Agent loop
  → WP9 Demo
  → WP10 E2E/CI
  → WP11 Close
```

### Có thể làm song song sau khi WP2 freeze

| Nhánh | Người chính | Công việc |
|---|---|---|
| A | TV1 | Domain, application và agent loop |
| B | TV2 | Config snapshot, prompt composition và hashing |
| C | TV3 | Tool contract, registry tối thiểu và `read_file` |
| D | TV4 | Workspace boundary và negative security test |
| E | TV5 | Judge fixture, verdict schema và acceptance assertion |
| F | TV6 | RunEvent review, composition root, demo và CI handoff |

Các nhánh không được tự tạo type trùng. Nếu contract thiếu, owner tạo thay đổi ở `contracts` và lấy review
chéo trước khi consumer sử dụng.

---

## 7. Chiến lược pull request

Giữ pull request nhỏ theo vertical outcome:

| PR | Nội dung | Điều kiện merge |
|---|---|---|
| PR1 | Workspace, command chuẩn, CI tối thiểu | Windows/Linux check xanh |
| PR2 | Contract/schema v0 và contract test | Cross-owner approve |
| PR3 | Domain invariant, port và in-memory adapter | Unit/contract test xanh |
| PR4 | Config snapshot, prompt v0 và hash | Golden/hash test xanh |
| PR5 | Registry tối thiểu và `read_file` | Tool/workspace test xanh |
| PR6 | Fake provider và normalized events | Provider contract test xanh |
| PR7 | Application + agent loop integration | Integration scenario xanh |
| PR8 | Demo, E2E, docs và close gate | Toàn bộ DoD đạt |

Không bắt buộc đúng tám PR nếu nhóm cần gộp, nhưng mỗi PR phải có một outcome kiểm chứng được. Không merge
một PR chỉ tạo hàng loạt folder/interface mà chưa có consumer hoặc test.

---

## 8. Definition of Done của Slice 1

### Functional

- [ ] Judge run `valid` chạy end-to-end bằng fake provider.
- [ ] Judge run `invalid` chạy end-to-end bằng fake provider.
- [ ] Fake provider gọi được `read_file` qua registry interface.
- [ ] Structured verdict được Zod validate trước khi Run completed.
- [ ] Run có config snapshot, prompt manifest/hash và in-memory trajectory.

### Architecture

- [ ] Schema v0 là nguồn type duy nhất.
- [ ] Dependency rules được kiểm tra tự động.
- [ ] Agent core không import tool cụ thể, filesystem adapter hoặc fake provider.
- [ ] Adapter chỉ được lắp ở composition root.
- [ ] Không có package rỗng hoặc abstraction chưa có consumer.

### Safety

- [ ] Runtime chỉ đọc source workspace fixture.
- [ ] Absolute path, traversal và symlink escape bị từ chối.
- [ ] Error gửi model không lộ host path, secret hoặc stack trace.
- [ ] Ground truth không nằm trong runtime dependency graph hoặc workspace.

### Quality

- [ ] Format, lint, typecheck, unit, contract, integration và E2E test đều xanh.
- [ ] Cùng test chạy trên Windows và Linux.
- [ ] Test mặc định không cần mạng, API key hoặc provider thật.
- [ ] Event order và prompt hash deterministic.
- [ ] Không có lỗi bị nuốt hoặc chuyển toàn bộ thành generic string.

### Team handoff

- [ ] Owner/reviewer của shared contract đã được ghi.
- [ ] Thành viên khác chạy được `demo:slice1` từ fresh clone.
- [ ] README và journal đã cập nhật.
- [ ] Có bằng chứng CI/test kèm commit.
- [ ] Điểm thay in-memory adapter bằng durable adapter cho Slice 2 đã được liệt kê.

---

## 9. Rủi ro cần kiểm soát

| Rủi ro | Dấu hiệu | Cách xử lý |
|---|---|---|
| Over-scaffold | Nhiều package chỉ có `index.ts` | Chỉ tạo package cùng behavior/test đầu tiên |
| Contract drift | Consumer tự định nghĩa `Run` hoặc `ToolCall` | Enforce import từ `contracts`, review chéo |
| Fake quá dễ | Fake phát verdict mà không kiểm tra request | Fake assert prompt, tools và message history |
| Agent loop gắn với `read_file` | Core có `if tool === "read_file"` | Chỉ gọi registry interface |
| Test xanh giả | E2E không thật sự đọc fixture | Assert tool event, path, line metadata và evidence |
| Leakage từ đầu | Tool nhận host path hoặc contest root | Workspace chỉ nhận source root và relative path |
| Scope creep | Bắt đầu API, SQLite hoặc provider thật | Đưa issue về Slice tương ứng, không merge vào Slice 1 |
| Cross-platform drift | Path test chỉ chạy Windows | CI Windows/Linux và canonical path contract |
| Hash không ổn định | CRLF/LF tạo hash khác | Normalize encoding/line ending và golden test |
| Event schema thiếu dữ liệu | Slice 2 phải sửa lại toàn bộ | TV5/TV6 review event trước contract freeze |

---

## 10. Điều kiện bắt đầu Slice 2

Slice 2 chỉ bắt đầu sau khi:

1. Slice 1 đạt toàn bộ Definition of Done.
2. `Run`, `RunEvent`, `ToolCall` và config snapshot đã có schema v0.
3. Fake-provider E2E là regression test cố định.
4. In-memory `RunRepository` và `EventStore` đã nằm sau port.
5. Event order/sequence semantics đã được chốt.
6. Agent loop không cần thay đổi để chuyển từ in-memory sang persistent adapter.
7. Nhóm đã ghi rõ những gì Slice 2 thay thế:
   storage, queue, migration, API và durable replay.

Nếu Slice 2 buộc phải sửa agent loop chỉ để lưu database, dependency boundary của Slice 1 chưa đạt và phải
được sửa trước khi tiếp tục.
