# Sprint 6 — Context cơ bản trong luồng chạy thật: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa các lượt model/tool của `MultiTurnRunner` qua Context Engine dùng chung, stateless và xác định được: chuẩn bị request/budget trước mỗi lần gọi, ghi nhận usage provider sau mỗi lần gọi, định hình tool output sau lọc bảo mật, và truy vết chính xác các biến đổi context.

**Architecture:** Đọc đề xuất TV2 và contract nội bộ trước, sau đó nghiên cứu OpenCode reference, ghi lại commit nguồn, thuật toán và khác biệt. Adapt thành một engine stateless với ba operation `prepare` / `record` / `shapeToolResult`: agent loop sở hữu mọi lần gọi model và persistence; engine nhận đủ dữ liệu mỗi lần, trả prepared items hoặc stop/needs-compaction, và không sửa lịch sử gốc. Sprint 6 triển khai đường cơ bản có output reserve, preflight, tool-output shaping và telemetry; các lớp deterministic masking, LLM compaction và memory chỉ triển khai nếu được phê duyệt scope riêng.

**Tech Stack:** Bun `1.3.14+`, TypeScript, Zod, Turborepo, `@harness/protocol`, `@harness/core`, Bun tests; OpenCode checkout dùng để nghiên cứu/port code thuần TypeScript tối đa có thể, không phụ thuộc runtime Effect hay package private của OpenCode.

**Spec:** Sprint 6 scope tại `docs/core-team-timeline.md` (hàng **6**); thiết kế nền TV2 tại `docs/tv2-context-research-and-plan.md` và `docs/tv2-context-engine-contract.md`; tham chiếu hiện trạng tại `packages/protocol/src/context.ts`, `packages/protocol/src/events.ts`, `packages/core/src/context/`, `packages/core/src/runner/multi-turn-runner.ts`, và `packages/core/src/runner/request-assembly.ts`.

## Global Constraints

- Runtime và package manager: Bun `1.3.14+`; mọi task/test chạy bằng Bun và Turborepo.
- `@harness/protocol` giữ thuần contract: không import Node built-ins, database drivers, provider SDKs hoặc runtime SDKs.
- Không đưa `GroundTruthLabel`, adjudication reports, scoring metadata, credential hoặc secret vào model request, event hay telemetry.
- Phân tích source chỉ qua immutable `SourceSnapshotPort`; không thêm đường dẫn host vào context hoặc request.
- Mọi lựa chọn mới làm thay đổi output phải qua config/policy rõ ràng, được ghi vào immutable run snapshot/event trước khi gọi provider.
- Không thêm dependency chỉ để tái hiện OpenCode; không import `@opencode-ai/llm`, Effect hoặc module private.
- Giữ `SingleTurnRunner` làm baseline, không đổi behavior của baseline trong sprint này.
- Mỗi provider request phải vượt qua context/token/cost preflight trước `executeAttempt`; provider SDK vẫn không retry ngầm.
- Dùng một cửa sổ thí nghiệm/chính sách chung cho mọi provider: `W_exp=16,384` o200k token, output reserve `4,096`, cleanup trigger ở 80% input capacity; hard-limit safety estimate factor `1.2` theo model. Đây là Sprint 6 defaults do người dùng chọn; model profile không fit phải bị reject trước provider call.
- Phân biệt token logic theo tokenizer trung lập `o200k_base` với token usage thật do provider trả về; không coi heuristic hiện tại `ceil(chars / 4)` là o200k hay số token chính xác.
- Context Engine không giữ state giữa các lần gọi, không tự gọi model, không sửa lịch sử gốc; runner ghi các bản ghi/biến đổi và gửi đúng prepared result.
- Tool output đi theo thứ tự security boundary trước: tool result được lọc secret/credential bởi TV4 trước khi Context Engine định hình/cắt theo policy.
- Theo lựa chọn của người dùng: bật L2 tool-output shaping sau sanitizer; giữ prefix liên tục, ghi truncation/continuation metadata, dùng `read_file` offset nếu tool hỗ trợ. L3 masking/supersede/drop-empty vẫn tắt; không thực hiện LLM compaction hoặc memory. Usage thiếu là unavailable/null, không giả thành zero; TV4 chỉ cung cấp sanitizer/security boundary, không sở hữu context policy.
- Không triển khai session notes, cross-run memory, LLM compaction, semantic history selection hoặc agent-loop retry policy trong Sprint 6.
- TDD: test thất bại trước, implementation tối thiểu kế tiếp, chạy focused test rồi package/monorepo verification.
- Không chạy schema test suite trên DB giữ evidence người dùng; schema integration cần DB test riêng vì suite có thể clear tables.

## Review Focus

- Request có tools/schema lớn hoặc context item không phải text: estimate phải tính đúng serialized request, tool definitions và metadata, không chỉ `ContextItem.content`.
- Pinned prompt/instruction/source evidence vượt budget: không được âm thầm loại bằng chứng; planner phải dừng trước provider call với reason rõ ràng.
- Truncation tại ranh giới UTF-8/dòng và output reserve bằng 0/đúng bằng cửa sổ: kết quả phải deterministic, có marker/telemetry và không làm sai line evidence.
- Credential hoặc ground-truth marker xuất hiện trong context cũ hay tool result sau transformation: sanitize trước persistence/request; digest không được làm lộ raw value.
- Run resume hoặc lỗi persistence sau khi prepare: không gửi request không khớp với context allocation đã lưu; terminal run không được tiếp tục.

---

## Scope and Completion Criteria

In scope:

1. Reference study trước implementation, với source paths, commit hash, thuật toán được chọn/bỏ và mapping sang Harness contracts.
2. Một Context Engine dùng chung, stateless, dùng được trong từng provider attempt của multi-turn source run.
3. Ghép system/instruction, prompt/finding, source inventory, persisted history, tool definitions/results trong một phép estimate có output reserve.
4. Định hình tool output sau khi qua security filter; preflight khi request không vừa bằng transformation được bật rõ ràng hoặc stop trước provider call.
5. `record` usage thật sau mỗi model attempt, lưu chênh lệch giữa estimate trung lập và provider usage; telemetry + digest cho prepared context/request thực gửi; resume/readback giải thích được allocation.
6. Offline tests và một live verification run dùng provider thật sau khi unit/integration checks qua.

Out of scope: deterministic observation masking/supersede/drop-empty; nội dung LLM summarization/compaction attempts; session note; long-term memory; source retrieval/ranking; model-specific tokenizer decisions; multi-run learning; changes to Judge verdict policy. `needs_compaction` chỉ là seam tương thích, không được gọi model tóm tắt trong sprint này.

Acceptance:

- `MultiTurnRunner` gọi planner cho mỗi reasoning attempt sau khi ghép history/tools và trước gateway.
- `ModelAttemptRequest` gửi tới gateway chính là request được digest/persist; không có đường bypass planner.
- Output reserve được trừ trước khi provider call; request vượt limit dừng rõ ràng, không gọi gateway.
- Transformation/stop/telemetry có event contracts version-compatible và không tiết lộ dữ liệu nhạy cảm.
- Tests chứng minh pinned evidence được giữ hoặc run fail-closed, transformations deterministic, persistence/resume nhất quán.
- Live run hoàn thành được một tool round trip trên snapshot; `view`/DB readback xác nhận step, tool, prepared request digest, finish reason và usage.

## Reference-first research findings and required investigation

### Hiện trạng Harness đã xác nhận

- `ContextEnginePort` (`packages/protocol/src/context.ts`) định nghĩa `prepare`, `record`, `shapeToolResult`, `ContextPolicy`, `ModelLimits`, `RunBudget`, `PrepareResult` và telemetry.
- `FakeContextEngine` có `nonAuthoritative = true`; `estimateTokens` dùng `ceil(characters / 4)` và ghi rõ không authoritative (`packages/core/src/context/token-estimator.ts`). `PassThroughContextEngine` và `ThresholdContextEngine` hiện ở testing exports.
- `JudgeStep` đã gọi `ContextEnginePort.prepare`, lưu `context.transformed`/`context.allocated` và chặn gateway khi stop/compaction (`packages/core/src/runner/judge-step.ts`). Judge có LLM compaction (`packages/core/src/runner/compaction.ts`).
- `MultiTurnRunner` chưa nhận `ContextEnginePort`; nó gọi `assembleTurnRequest`, ước lượng serialized `items` + `tools` bằng hook hoặc `estimateTokens`, rồi kiểm tra token/cost trực tiếp (`packages/core/src/runner/multi-turn-runner.ts`).
- `request-assembly.ts` đã chuẩn hóa system/source/prompt/history/tools; event `context.allocated` hiện có `stepIndex` và `PrepareTelemetrySchema`, nhưng telemetry digest hiện không định danh toàn bộ request wire-ready.

### TV2 research and contract input (read before OpenCode adaptation)

Đọc và dùng hai tài liệu nhóm đã nghiên cứu trước làm design input bắt buộc:

- `docs/tv2-context-research-and-plan.md` — khảo sát OpenCode/omp/pi-mono/Codex; đề xuất pipeline L0–L6; o200k; shared experimental window `W_exp`; thứ tự giảm tải rẻ-trước-đắt-sau; ablation S0–S4; ranh giới với TV1/TV3/TV4/TV5/TV6.
- `docs/tv2-context-engine-contract.md` — Context Engine stateless, không tự gọi model/giữ state/sửa raw history; ba operations `prepare`, `record`, `shapeToolResult`; input theo từng item + policy + model limits + run budget; outcomes `ready`/`needs_compaction`/`stop`; mọi transformation có telemetry/event để dựng lại chính xác model-visible context.

Hai tài liệu có trạng thái đề xuất/bản nháp. Cần phân biệt **nguyên tắc/decision đã ghi** với các ngưỡng, flag, API/package chưa được nhóm xác nhận; không tự đánh dấu các đề xuất là quyết định cuối.

#### Ý chính phải được phản ánh trong plan

1. **Một workflow dùng chung cho Judge và Audit.** Workflow cung cấp items và pinning phù hợp; engine không biết mode. Không tạo planner riêng theo mode.
2. **Stateless, deterministic, source-preserving.** Mỗi lần gọi nhận đủ state; cùng input/policy cho cùng prepared view; raw append-only history vẫn giữ nguyên, transformations chỉ định hình model view và được ghi event.
3. **Ba điểm gọi:** `prepare` trước từng model call; `record` sau response để ghi actual usage/delta; `shapeToolResult` sau security filter và trước khi tool result được ghi vào history. Engine không gọi gateway; nếu sau này có LLM summary, đó là attempt do runner điều phối và accounting đầy đủ.
4. **Giảm tải rẻ trước:** L2 tool shaping → L3 deterministic handling (supersede read, drop empty, observation masking) → L4 LLM compaction; L5 session/memory về sau. Trong Sprint 6 chỉ ship L2 và những behavior có quyết định được chốt; L3 flags riêng, default-off nếu chưa duyệt; không thực hiện L4/L5.
5. **Pinned evidence không bị lặng lẽ mất.** Nhóm tool call/result phải giữ liên kết; không được giữ request mà bỏ result hoặc tách một operation. Nếu pinned context cộng reserve không vừa thì fail closed `context_budget`.
6. **Đếm neutral và ghi usage thật riêng biệt.** TV2 ghi chọn o200k làm unit chung; provider-reported usage là số dùng báo cáo/cost. Ghi estimate, actual và delta. Xác minh package/version/license/Bun compatibility; không dùng char/4 rồi gắn nhãn o200k.
7. **Công bằng đa provider.** Cửa sổ thử nghiệm/output reserve/trigger chung; giới hạn thật và safety margin từng model là hard safety guard, không làm thay đổi policy dọn. Số cụ thể W/reserve/trigger/margin cần gate xác nhận.
8. **Tool output bảo toàn evidence.** Filter secret trước shaping; Solidity ưu tiên giữ đoạn đầu liên tục và marker đọc tiếp có relative file/range/offset; phối hợp TV3 nếu cần bổ sung offset cho `read_file`. Không đưa host path hoặc raw secret vào placeholder/telemetry.
9. **Telemetry đủ cho Trace View/ablation:** policy/tokenizer version, per-category estimate, output reserve/window/safety, provider actual usage/delta, transformations và số token tiết kiệm, remaining budget, digest của đúng prepared request. Không ghi raw context thay cho digest.

#### Ánh xạ L0–L6 vào Sprint 6

| Lớp TV2 | Scope Sprint 6 |
|---|---|
| L0 Đo | Dùng o200k sau khi kiểm tra package/license/Bun; estimate request, `record` provider usage thật và sai số. |
| L1 Ngân sách | Preflight mỗi attempt với `W_exp=16,384`, reserve `4,096`, trigger 80%, safety factor 1.2; hard model limits chặn request không an toàn. |
| L2 Tool shaping | Shaping sau sanitizer, token-aware/bounded, giữ source prefix, marker+continuation; dùng offset khi tool hỗ trợ. |
| L3 Deterministic cleanup | Chỉ interface/flag và behavior được duyệt; không tự bật các proposal còn mở. |
| L4 LLM compaction | Không có summary provider call trong Sprint 6; context không fit thì stop. |
| L5 Notes/memory | Out of scope; memory split rules thuộc quyết định TV5/research. |
| L6 Telemetry | Allocation/transformation events, request digest, estimate/actual/delta và persisted readback. |

#### Task 1 quyết định đã chốt cho Sprint 6

Các giá trị sau do người dùng chọn từ đề xuất của assistant; đây là quyết định triển khai của Sprint 6, không phải phê duyệt trước đó của TV2 hay các track khác:

- `W_exp=16,384` o200k token chung cho các provider; output reserve `4,096`; bắt đầu cleanup tại 80% input capacity; safety estimate factor `1.2` theo model. Model profile không đủ context/output cap thì reject trước call.
- Dùng o200k sau kiểm tra package/version/license, Bun compatibility và reference vectors. Usage provider thật là số actual; thiếu usage ghi unavailable/null, không giả thành 0.
- Bật L2 tool-output shaping sau sanitizer, giữ source prefix liên tục và marker/continuation; dùng `read_file` offset nếu contract hiện tại hỗ trợ.
- L3 `obs_masking`, `supersede_reads`, `drop_empty` để off. Không LLM compaction, session note hoặc memory trong Sprint 6; context không fit thì `context_budget` stop.
- Pin system/instruction, candidate finding và evidence workflow đánh dấu; giữ tool request/result thành cặp không tách rời.
- TV4 chỉ là security/sanitizer boundary cho thứ tự lọc → shaping; TV2 sở hữu context policy. Cross-track confirmation cần ghi nhận, nhưng không chặn thực thi các quyết định đã được người dùng chọn này.

### Quy ước contract và ví dụ item-level

- `prepare(items, policy, modelLimits, budget)` nhận danh sách item có metadata, không nhận một chuỗi ghép rồi đoán ranh giới lại. Item cần dùng hiện có `type`, `turn`, `isPinned`, `toolMeta.callId/toolName/filePath/lineRange`.
- Khi giảm tải lịch sử, thao tác phải theo nhóm tool call/result; không giữ tool request mà bỏ result tương ứng, hoặc ngược lại. Ưu tiên cặp hoàn chỉnh trong cửa sổ recent.
- Placeholder của masking phải cho biết loại item, tool, relative path/range và cách đọc lại nếu có thể; không chứa host path và không được giả làm source evidence nguyên văn.
- Read mới hơn thay read cũ, drop-empty và observation masking là các policy riêng, có flag/config version và transformation event riêng. Chúng chỉ chạy nếu nhóm duyệt; default trong plan vẫn off.
- `needs_compaction` là yêu cầu cho runner, không phải lời gọi model bên trong engine. Nếu Sprint 6 không làm compaction, runner fail/stop có giải thích thay vì thực hiện summary attempt.
- `record(actualUsage, modelLimits, budget)` là stateless calculation/output; runner là nơi sở hữu tổng budget đã persist. Ghi cả o200k estimate, provider-reported counts và delta theo từng attempt; provider cost tiếp tục lấy từ usage/pricing path hiện tại.
- `shapeToolResult` chỉ nhận content sau sanitize, output giữ relative file/range/line evidence và continuation instruction phù hợp với `read_file` offset hiện có.

### OpenCode reference protocol

- Local reference checkout: `/Users/nguyenbaoan/codeLab/OpenCode`, HEAD đã quan sát `5542415b6424aa9bad8827dc72e8cd0630b2c0ab`.
- Harness attribution hiện ghi `3f393d78bf`, nhưng object commit đó **không có trong local checkout**; không được tuyên bố các line numbers/behavior ở HEAD hiện tại là cùng revision.
- Trước khi adapt, đọc các file reference tại checkout hiện có và truy lịch sử git tới source commit/nearest ancestor nếu có: `packages/core/src/session/compaction.ts`, `packages/core/src/session/runner/llm.ts`, `packages/core/src/util/token.ts`, và các context/request helpers mà những file đó gọi.
- Ghi vào `docs/sprints/sprint-06.md` hoặc phụ lục research được yêu cầu: commit hash chính xác; source file và symbol; điều kiện budget/output reserve; chọn history; cách truncate/compact; telemetry/persistence; phần copy nguyên văn, phần đổi để khớp ports/events; phần không mang sang và lý do.
- Phân biệt rõ code thuần TypeScript có thể port với OpenCode-specific Effect, SQLite/session schema, streaming, permission, attachment và provider abstractions không tương thích.
- Không bắt đầu copy/adapt implementation trước khi research note được hoàn thành và review nội bộ; attribution header phải trỏ tới commit/file thực sự được dùng.

## File Structure

- Create or modify: `packages/core/src/context/request-context-planner.ts` — chỉ tạo nếu reference/code inspection chứng minh cần adapter riêng; nếu không, tích hợp `ContextEnginePort` trực tiếp.
- Modify: `packages/core/src/context/context-engine.ts` — tách contract/production context logic khỏi `FakeContextEngine`; không để implementation dùng trong production kế thừa nhãn/non-authoritative behavior của fake.
- Modify: `packages/core/src/context/token-estimator.ts` — tên/label của estimate phải trung thực; không gọi character heuristic là authoritative tokenizer.
- Create: `packages/core/src/context/o200k-tokenizer.ts` using pinned `js-tiktoken@1.0.21` after Bun smoke test/parity vectors; package is MIT, pure JavaScript, o200k subpath, runtime dependency `base64-js`.
- Modify: `packages/core/src/context/index.ts` — export production planner/type ở public core surface; testing fakes tiếp tục nằm ở testing exports.
- Modify: `packages/core/src/runner/multi-turn-runner.ts` — inject planner/policy, gọi trước mỗi attempt, chỉ gửi prepared request, ghi allocation/transformation và stop fail-closed.
- Modify: `packages/core/src/runner/request-assembly.ts` — chỉ để tách base request khỏi engine hoặc expose canonical serialization; không đổi sanitization/ground-truth boundary.
- Modify: `packages/protocol/src/context.ts` — additive planner telemetry/result fields hoặc exact request digest schema, nếu reference study chứng minh cần thiết.
- Modify: `packages/protocol/src/events.ts` — additive/optional payload fields cho context allocation/transformation; giữ đọc event lịch sử cũ.
- Modify: `packages/core/src/runner/run-queries.ts` — expose allocation/transformation summaries if CLI readback needs them.
- Modify: `packages/cli/src/commands/view.ts` — render prepared token estimate, output reserve, estimate-vs-actual delta, transformations and digest when available; do not print raw full content.
- Create: `packages/core/test/context/request-context-planner.test.ts` — planner boundary, prioritization, fit/stop and deterministic digest tests.
- Modify: `packages/core/test/runner/multi-turn-runner.test.ts` — runner integration, pre-provider stop, per-attempt planner call, persisted/readback digest.
- Modify: `packages/protocol/test/events.test.ts` — event compatibility and validation.
- Modify: `packages/cli/test/cli-view.test.ts` — bounded context telemetry view if view format changes.
- Modify: `docs/sprints/sprint-06.md` — record actual reference research, decisions, task evidence and live verification; keep plan/task status current.

## Interfaces

### Context Engine contract (planned; reconcile with TV2 contract during Task 1)

The preferred design reuses the existing stateless `ContextEnginePort` and accepts the TV2 three-operation boundary. Before implementation, decide how it receives the **fully assembled request** (including tool schema) without losing the contract's item-level metadata. Protocol-owned types only; the engine must not depend on provider SDK or persistence:

```ts
ContextEnginePort.prepare({ items, policy, modelLimits, budget })
ContextEnginePort.record({ actualUsage, modelLimits, budget })
ContextEnginePort.shapeToolResult({ content, toolName, policy })
```

Do not create the proposed `RequestContextPlannerPort` unless Task 1 proves the existing port cannot express complete-request measurement or transformation output. If extending the port is necessary, additions must remain additive/version-compatible; preserve item grouping/pinning and define an explicit association between prepared items and the exact tool-enabled request sent to the gateway.

The plan must define precisely:

- How complete provider-request estimate is computed, including role/item serialization, tool definitions, tool schema, per-request output limit, and configured safety margin.
- Which items are pinned/non-droppable in Sprint 6 and what happens if their estimate plus reserve exceeds model context.
- What deterministic transformation is allowed in the basic sprint; all other unapproved policies remain disabled/no-op.
- Which values are recorded in immutable run config and per-attempt allocation event.
- How a digest binds the exact sanitized provider request without storing duplicate raw prompt/tool content.

## Tasks

### Task 1: Research OpenCode reference and write adaptation decision record

**Files:**
- Read: `/Users/nguyenbaoan/codeLab/OpenCode/packages/core/src/session/compaction.ts`
- Read: `/Users/nguyenbaoan/codeLab/OpenCode/packages/core/src/session/runner/llm.ts`
- Read: `/Users/nguyenbaoan/codeLab/OpenCode/packages/core/src/util/token.ts`
- Read: relevant OpenCode request/history/context tests and git history.
- Read: `packages/core/src/context/*`, `packages/core/src/runner/{judge-step.ts,multi-turn-runner.ts,request-assembly.ts,compaction.ts}`, `packages/protocol/src/context.ts`, and `packages/protocol/src/events.ts`.
- Modify: `docs/sprints/sprint-06.md` research findings and decision record.
- Read before coding: `docs/tv2-context-research-and-plan.md` and `docs/tv2-context-engine-contract.md`.

**Interfaces:**
- Consumes: OpenCode reference checkout plus current Harness context contracts.
- Produces: a reconciled TV2 decision table plus an adaptation table with pinned commit/hash, source symbols, copied behavior, excluded behavior, event/data mapping, tokenizer decision, and final `ContextEnginePort` contract for Task 2.

- [ ] **Step 1: Inspect reference revision and relevant tests before implementation.** Record `git rev-parse HEAD`, `git log`/`git blame` for reference files, and inspect matching tests; verify whether `3f393d78bf` exists in any available local reference object/ref.
- [ ] **Step 2: Trace the reference request lifecycle.** Document how it builds the request, estimates the serialized request, reserves output, selects/truncates history, transforms tool output, and reacts when context cannot fit.
- [ ] **Step 3: Compare reference with Harness.** Map each behavior to `ContextEnginePort`, event schemas, request assembly, runner budget guards, sanitizer and persistence; explicitly list incompatibilities and no-port decisions.
- [x] **Step 4: Reconcile decisions.** The user selected `W_exp=16,384`, output reserve `4,096`, cleanup trigger 80% of input capacity and hard safety estimate factor 1.2; reject provider profiles that do not fit. The user selected L2 shaping after sanitization, L3 flags off, no summary/memory, pinned mandatory items and atomic tool pairs, missing usage unavailable/null, and TV4 only as sanitizer boundary. Pin and verify `js-tiktoken@1.0.21` (MIT/pure JS/o200k export/base64-js runtime dependency) in Task 2/3. These are user-selected Sprint 6 choices, not prior TV2/team approvals.
- [ ] **Step 5: Select a Sprint 6 policy and finalize the Context Engine contract in this file.** Preserve pinned prompt/instruction/evidence; choose a deterministic allowed scope; document whether `ContextEnginePort` is reused/extended and how complete request/tool schema is accounted for. Leave summary generation and memory out of implementation scope.
- [ ] **Step 6: Review research gate.** Confirm the plan names actual source hashes and no code adaptation begins before this record is complete.

**TV2 decisions to carry into design (not silently re-decide):**
- Common engine for Judge and Audit; flow is `measure → budget/preflight → cheap deterministic shaping → optional later reduction/compaction → stop if impossible → telemetry`.
- All context-changing/result-affecting operations use explicit independent flags and are represented in the run's immutable config/telemetry. Existing draft status is proposal/meeting discussion: get acceptance evidence for numerical thresholds and optional L3 behavior.
- o200k uses pinned `js-tiktoken@1.0.21` (MIT, pure JavaScript; package declares `base64-js`); verify Bun behavior and parity before use. Provider actual counts remain separate.
- Shared values selected by user: `W_exp=16,384`, output reserve `4,096`, cleanup trigger 80% of input capacity, model hard-safety estimate factor `1.2`; reject profiles that cannot fit.
- L2 shaping selected on after TV4 sanitization, token-aware, preserve source prefix and safe continuation/offset; inspect/test current `read_file` offset support before deciding if TV3 API change is needed.
- L3 separate flags (`obs_masking`, `supersede_reads`, `drop_empty`) stay default-off.
- L4 summary generation is an ordinary runner-owned model attempt, never an internal engine call; it is outside this Sprint 6 implementation unless explicitly expanded.
- L5 session/long-term memory remains out of scope; no test/train-derived memory may cross split boundaries.

### Task 2: Define versioned request-context policy and telemetry contract

**Files:**
- Modify: `packages/protocol/src/context.ts`
- Modify: `packages/protocol/src/events.ts`
- Modify: `packages/protocol/test/events.test.ts`
- Modify: `packages/core/src/runner/run-config.ts`
- Modify: `packages/core/test/runner/run-config.test.ts`

**Interfaces:**
- Consumes: finalized decisions from Task 1.
- Produces: schema-validated, immutable per-run context policy and additive per-attempt allocation/transformation/record telemetry and request digest payload. Existing old events without new optional fields continue parsing.

- [ ] **Step 1: Add failing protocol tests** for legacy event parse; policy version/shared window/reserve/threshold/safety margin; ready/needs_compaction/stop outcomes; transformation names and before/after counts; estimate, provider actual usage and delta; valid digest; and no raw prompt/tool content in telemetry.
- [ ] **Step 2: Run focused protocol tests** and confirm the new contract tests fail for the intended missing fields/validation.
- [ ] **Step 3: Add the smallest additive Zod/type changes** required by Task 1; do not make old persisted event payloads invalid.
- [ ] **Step 4: Add approved context policy values to run configuration snapshot** only for result-affecting settings; verify different policy values produce different canonical config digests. Keep proposed/unapproved L3 flags off and do not invent threshold values.
- [ ] **Step 5: Run `bun run --cwd packages/protocol test` and focused core run-config tests**; verify old fixtures parse and new config digest records the policy.

### Task 3: Implement deterministic production Context Engine operations

**Files:**
- Create or modify: `packages/core/src/context/request-context-planner.ts` only if Task 1 establishes a distinct request adapter is needed.
- Modify: `packages/core/src/context/context-engine.ts` to separate production engine behavior from fake/test base as decided in Task 1.
- Modify: `packages/core/src/context/token-estimator.ts`
- Create if tokenizer package approved: `packages/core/src/context/o200k-tokenizer.ts` (exact name/dependency decided after research).
- Modify: `packages/core/src/context/index.ts`
- Create: `packages/core/test/context/context-engine.test.ts`
- Create: `packages/core/test/context/request-context-planner.test.ts` only if adapter exists.

**Interfaces:**
- Consumes: protocol contract from Task 2; existing `ModelAttemptRequest`, context policy, model limits, budget and sanitizer utilities.
- Produces: production implementation of `ContextEnginePort` (or approved additive extension), with pure `prepare`, `record`, `shapeToolResult`, deterministic transformations, o200k estimate/safety/output reserve, provider usage delta and request digest. `prepare` must accept a canonical fully assembled `ModelAttemptRequest` (including tools/schema and output settings) or an equivalent typed envelope; the exact canonical representation that is estimated and hashed is what Task 4 sends to the gateway.

- [ ] **Step 1: Write failing unit tests** for o200k reference vectors if tokenizer accepted; serialized request and tool-schema accounting; output reserve; pinned prompt/source evidence; tool-result shaping after sanitization; provider usage recording/delta; deterministic approved transformations; no-fit fail-closed; exact boundary; digest stability/change; secret/ground-truth redaction.
- [ ] **Step 2: Run context-engine tests and confirm expected failures.**
- [ ] **Step 3: Port/adapt the selected OpenCode pure-TypeScript algorithm** with the exact source attribution header and commit discovered in Task 1. Reuse existing `ContextEnginePort` where possible; use Harness protocol types, canonical digest and sanitizer; do not import OpenCode Effect/session/storage layers.
- [ ] **Step 4: Implement `record`** to update logic-token usage, provider-reported usage and their delta without storing engine state between calls.
- [ ] **Step 5: Implement `shapeToolResult`** to receive already-sanitized tool content, apply approved token/line bounds deterministically, include safe continuation metadata, and report truncation/token telemetry.
- [ ] **Step 6: Implement `o200k-tokenizer.ts` around `js-tiktoken@1.0.21`**; run Bun smoke test and parity vectors, benchmark representative Solidity/bytecode fixtures, and record initialization/throughput. Keep provider-reported counts distinct from o200k estimates.
- [ ] **Step 7: Run engine tests and verify deterministic output, original-history immutability and pinned evidence preservation.**

**Task 3 fix-loop requirements (review findings):**
- Digest/estimate must bind the complete canonical sanitized provider request, including tool definitions/schema and output cap. Do not label an item-only digest as the provider request digest.
- `record` must represent missing/partial provider usage as unavailable/null and must not synthesize zero-as-fact. Keep estimate separately for conservative run budgeting.
- Validate policy/model limits at a runtime boundary: positive context/output caps, reserve > 0 and <= output cap, finite safety factor >= 1, positive window, and internally coherent budgets. Invalid profiles fail before gateway invocation.
- Exercise exact fit/one token over, policy threshold semantics with L3 off, tool schema/accounting changes, tool marker within token cap, truncation disabled, and null-usage record behavior.

### Task 4: Integrate Context Engine before/after every real multi-turn operation

**Files:**
- Modify: `packages/core/src/runner/multi-turn-runner.ts`
- Modify: `packages/core/src/runner/request-assembly.ts`
- Modify: `packages/protocol/src/context.ts` — additive prepared-request envelope and nullable/missing usage input for `record`, preserving old event/config parsing.
- Modify: `packages/protocol/test/context.test.ts` — new envelope and missing-usage contract tests.
- Modify: `packages/core/test/runner/multi-turn-runner.test.ts`
- Modify: `packages/core/test/runner/multi-turn-integration.test.ts`
- Modify: `packages/core/test/runner/multi-turn-hardening.test.ts`

**Interfaces:**
- Consumes: finalized planner API from Task 3.
- Produces: `prepare` receives a canonical sanitized `ModelAttemptRequest` envelope (items, tools/schema, output cap/options) and returns the exact prepared request used by guards, attempt persistence and gateway; estimate and digest bind that same request. `record` follows every response and represents missing usage explicitly as null/unavailable; `shapeToolResult` follows TV4 sanitization and precedes history persistence; stop/failure prevents provider call.

- [ ] **Step 1: Add failing runner tests** asserting prepare runs for each attempt after history/tools assembly; exact prepared request reaches gateway; record receives provider actual usage; shaping is called after sanitizer; stop/failure prevents gateway call; pinned oversize fails closed; stale claim/persistence failure prevents next attempt.
- [ ] **Step 2: Run focused runner tests and confirm failures.**
- [ ] **Step 3: Inject `ContextEnginePort` into `MultiTurnRunnerDeps`** using dependency injection; do not silently use a fake engine in real CLI runs.
- [ ] **Step 4: Call `prepare` after base request assembly and before cost/token guards/provider call.** Use the prepared model-visible representation for guards, attempt persistence, gateway call and digest event.
- [ ] **Step 5: Persist context allocation/transformation records in append-only order** before provider attempt; on persistence failure fail closed without sending the provider request.
- [ ] **Step 6: Call `record` after each provider response** and feed returned totals into the next prepare/budget check; when usage is unavailable, add the prepared estimate plus reserved output to conservative token accounting while actual provider usage remains null.
- [ ] **Step 7: Call `shapeToolResult` after source/error sanitization and before persistence/history append**; preserve call-result pairing, relative path/range/offset, and raw immutable history policy.
- [ ] **Step 8: Verify resumed runs rebuild the same prepared request view from persisted items/policy** and do not reapply transformation or change policy.
- [ ] **Step 9: Run focused multi-turn runner, hardening and integration tests.**

### Task 5: Expose bounded context telemetry in persisted run readback

**Files:**
- Modify: `packages/core/src/runner/run-queries.ts`
- Modify: `packages/cli/src/commands/view.ts`
- Modify: `packages/core/test/runner/run-queries.test.ts`
- Modify: `packages/cli/test/cli-view.test.ts`

**Interfaces:**
- Consumes: allocation and transformation events from Task 4.
- Produces: summary/CLI fields for policy version, o200k estimated request tokens, provider actual input/output/total tokens, estimate delta, output reserve, safety margin, transformation names/before-after token counts/savings and exact prepared-request digest; no raw full context content.

- [ ] **Step 1: Add failing readback tests** for old runs with no allocation event, multiple steps, ordered transformations, estimated-vs-actual usage/delta and redacted/omitted raw text.
- [ ] **Step 2: Implement summary reconstruction by run/step/attempt key** and preserve old single-turn view format.
- [ ] **Step 3: Add human and JSON view fields** with bounded output; digest is displayed as digest only.
- [ ] **Step 4: Run focused query and CLI view tests.**

### Task 6: Verify full source → context planner → tool → model loop

**Files:**
- Create or modify: `packages/core/test/runner/context-planner-disk-chain-e2e.test.ts`
- Modify: `docs/sprints/sprint-06.md` verification evidence and checkboxes.

**Interfaces:**
- Consumes: integrated production planner, disk snapshot, tool registry, scripted gateway, run store and CLI view.
- Produces: deterministic offline proof plus one bounded live verification record; do not add secrets or ground truth to fixtures.

- [x] **Step 1: Add offline disk-chain integration test** that prepares initial context, executes a real snapshot-backed tool call, prepares the next request, and verifies digests/readback match the exact gateway-captured requests.
- [x] **Step 2: Add over-budget and sensitive-input integration tests** proving no provider call occurs after stop and no secret/ground-truth reaches requests/events.
- [x] **Step 3: Run focused offline tests** and core/protocol/CLI typechecks. Core typecheck retains only the documented pre-existing `grep.ts` Worker `.once` errors.
- [x] **Step 4: Run `bun turbo typecheck`.** Workspace reports the same pre-existing core grep Worker typing errors; no Task 6 test-file errors remain.
- [x] **Step 5: Run affected package tests without destructive Postgres suite**; protocol/core/CLI focused suites pass. DB suite not run.
- [ ] **Step 6: With explicit live-test authorization and configured provider**, run one multi-turn snapshot flow under a bounded max cost/token/time budget; inspect persisted events, attempts, request digest, tool results and fresh-process `view`. Not run: requires separate live-spend authorization.
- [ ] **Step 7: Record model/provider, exact limits, run ID, measured usage/cost, any omitted/skipped DB parts, and whether provider token counts differ from planner estimates.** Not applicable until authorized live verification.

## Verification Commands

- Focused protocol: `bun run --cwd packages/protocol test`
- Focused core tests: `bun test packages/core/test/context/context-engine.test.ts packages/core/test/context/request-context-planner.test.ts packages/core/test/runner/multi-turn-runner.test.ts packages/core/test/runner/multi-turn-integration.test.ts` (run planner test only if Task 1 chooses a separate adapter)
- Focused CLI tests: `bun test packages/cli/test/cli-view.test.ts`
- Workspace typecheck: `bun turbo typecheck`
- Full unit suite only when DB side effects are safe: `bun turbo test`; schema tests clear their configured database, so do not run against a database containing retained live evidence.

## Self-review

- **Spec coverage:** reference-first research and TV2 proposal/contract reconciliation; shared stateless `prepare`/`record`/`shapeToolResult`; prompt/instruction/source/history/tool composition; o200k estimate versus actual provider usage; shared-window/output-reserve preflight; sanitized tool shaping; transformations/telemetry/digest/readback; and live verification map to Tasks 1–6.
- **Step scan:** each task has a failing-test-first cycle, explicit file/interface ownership, and a verification command; no implementation begins before Task 1 reference decision.
- **Type consistency:** planner contract must be finalized in Task 1; Task 2 owns protocol data; Task 3 exports planner; Tasks 4–6 consume only that contract. If Task 1 chooses reuse of `ContextEnginePort`, update this plan before Task 2 rather than retaining a duplicate API.
- **Review focus:** serialized tool/schema size (Task 3), pinned evidence/no-fit and atomic call-result pairs (Tasks 3–4), o200k tokenizer parity/licensing and estimate delta (Tasks 1/3/5), UTF-8/token output-shaping boundaries after sanitization (Tasks 3–4), secret/ground-truth (Tasks 3 and 6), resume/persistence (Tasks 4 and 6).
- **Scope:** no summary-generation LLM call, session note, long-term memory, unapproved L3 masking policy, semantic retrieval, or Sprint 7–8 retry/agent-loop policy is included. The typed `needs_compaction` branch may remain for future integration but must not call the provider in Sprint 6.
