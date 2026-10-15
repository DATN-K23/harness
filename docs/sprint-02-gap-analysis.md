# Báo cáo đối chiếu hiện trạng nhánh `agent-loop-core` với mục tiêu Sprint 2

> **Tài liệu tham chiếu:** `docs/sprint-02.md`  
> **Nhánh hiện tại:** `agent-loop-core`  
> **Ngày lập báo cáo:** 14/10/2026  

---

## 1. Tổng quan điều hành (Executive Summary)

### Nhận định cốt lõi
Nhánh `agent-loop-core` hiện tại đang ở trạng thái **"đi tắt đón đầu về mặt thuật toán logic của Sprint 7–8 (Agent Loop, Adjudication, In-memory Fakes, Offline Demo)"**, nhưng **"chưa hoàn thành nền tảng hạ tầng thực tế của Sprint 2"**.

* **Mục tiêu cốt lõi của Sprint 2:**
  $$\text{Nhập Prompt} \longrightarrow \text{Gọi API Model Thật} \longrightarrow \text{Lưu vào PostgreSQL (Drizzle)} \longrightarrow \text{Xem lại qua Run ID sau khi Restart}$$
* **Hiện trạng thực tế trên nhánh `agent-loop-core`:**
  * **0% luồng thật chạy được:** Chưa có kết nối PostgreSQL, chưa có adapter provider thật (`packages/llm` và `packages/schema` chỉ là thư mục trống chứa `.gitkeep`), chưa có điểm khởi động (CLI) để nhập prompt hoặc tra cứu run.
  * **100% logic trừu tượng (in-memory):** Đã xây dựng hoàn chỉnh hợp đồng `@harness/protocol` (`RunStorePort`, `ModelGatewayPort`, `TrajectoryEvent`) và nhân xử lý `@harness/core` (`JudgeRunner`, `JudgeStep`, `RetryPolicy`, `InMemoryRunStore`, `ScriptedModelGateway`). Toàn bộ chạy offline với dữ liệu giả lập.

> **Kết luận:** Nhánh hiện tại đã có bộ khung hợp đồng (contracts & ports) rất chặt chẽ, nhưng **thiếu hoàn toàn các adapter thực tế (Real Adapters)** mà Sprint 2 yêu cầu nhóm A–D phải xây dựng.

---

## 2. Bảng đối chiếu chi tiết theo yêu cầu `docs/sprint-02.md`

| Hạng mục / Vai trò | Yêu cầu theo `docs/sprint-02.md` | Hiện trạng code trên nhánh `agent-loop-core` | Đánh giá |
|---|---|---|:---:|
| **Mục tiêu chung** | Chạy luồng: Nhập prompt → gọi API model thật → lưu kết quả/lỗi vào PostgreSQL → xem lại theo mã lượt chạy sau restart. | Chỉ chạy offline bằng script `bun run demo` / `bun run stress` với mock data, lưu trong RAM (`InMemoryRunStore`), tắt tiến trình là mất sạch dữ liệu. | 🔴 **Chưa đạt** |
| **Phạm vi** | Runner 1 lượt gọi model (single-turn model runner), làm nền tảng. Kết quả là phản hồi model. | Đã viết `JudgeRunner` đa tầng (Ingestion → Sanitizer → Adjudication Reasoning Loop) với `JudgeVerdict`, nhưng không có runner 1-turn tối giản độc lập cho prompt tự do. | 🟡 **Lệch phạm vi** |
| **A — Setup & Lệnh chạy** | • Bun workspace, TypeScript/Turborepo liên kết các package.<br>• Thống nhất cấu hình DB, model, limits, có cấu hình mẫu (`.env.example`).<br>• Điểm khởi động nối B, C, D (lệnh nhập prompt, lệnh xem lại run).<br>• Hướng dẫn môi trường, migration, khởi động. | • Workspace mới chỉ kết nối `@harness/protocol` và `@harness/core`. Các package `cli`, `llm`, `schema`, `server` chỉ có `.gitkeep`.<br>• Chưa có file `.env.example`, chưa có logic đọc/validate env.<br>• `packages/cli` trống, chưa có CLI command nhập prompt hay xem run.<br>• Chưa có hướng dẫn setup DB / migration. | 🔴 **Còn thiếu 80%** |
| **B — Quản lý run & Runner** | • Chốt schema run: prompt, model, limits, runId, state, kết quả, lỗi.<br>• Viết runner 1 lượt: nhận việc → lưu DB ban đầu → gọi model qua D → lưu kết quả/lỗi qua C.<br>• Kiểm tra input/limit, ghi event, không tự gọi lại khi kết quả chưa rõ.<br>• Thao tác xem run và lịch sử từ DB. | • Đã có `ports.ts`, `events.ts`, `run-config.ts` phân định rõ `RunState` và `JudgeVerdict`.<br>• `JudgeRunner` hiện tại là runner phức tạp 3 stage dành riêng cho finding/PoC, gắn chặt với scripted fakes, thiếu runner 1 lượt đơn giản nhận prompt thô.<br>• Đã có `EventBus`, `EventSink`, `RetryPolicy` kiểm soát retry/gián đoạn.<br>• Chưa có hàm đọc/xem run kết nối với DB thật. | 🟡 **Đạt 40%** (có protocol, thiếu runner 1-turn thực tế) |
| **C — PostgreSQL & Drizzle** | • Kết nối PostgreSQL, khai báo bảng bằng Drizzle, migration đầu tiên.<br>• Chọn dữ liệu cần lưu: run, config, event, attempt, usage, cost.<br>• Lưu/đọc dữ liệu nhất quán, có thứ tự.<br>• Dấu vết trước khi gọi và sau khi gọi, không lưu API key. | • `packages/schema` hoàn toàn trống (`.gitkeep`).<br>• Chưa cài `drizzle-orm`, `drizzle-kit`, `postgres` / `pg`.<br>• Chưa có bảng DB nào được khai báo, chưa có file migration.<br>• Chỉ có `InMemoryRunStore` (Map trong RAM) và bộ test hợp đồng `runStoreContractTests`. | 🔴 **Còn thiếu 85%** (mới có port & test contract, chưa có code DB) |
| **D — Tích hợp API Model thật** | • Tìm hiểu API/SDK provider đầu tiên (OpenAI / Anthropic / Gemini), cấu hình API key.<br>• Adapter trong `packages/llm` nhận request Harness, gọi API thật, trả response/lỗi chuẩn hóa.<br>• Timeout, output limit, tắt SDK auto-retry ngầm.<br>• Trả token usage, cost, latency, che giấu secret khi gặp lỗi auth/rate limit. | • `packages/llm` hoàn toàn trống (`.gitkeep`).<br>• Chưa cài SDK provider nào.<br>• Chỉ có `ScriptedModelGateway` giả lập trong core.<br>• Chưa có bảng giá tính `costUsd`.<br>• Đã có kiểu `ModelGatewayPort`, `ModelAttemptResponse`, `ModelAttemptError` trong protocol nhưng chưa có code gọi HTTP/SDK thật. | 🔴 **Còn thiếu 80%** (mới có interface, chưa có adapter) |
| **Cả nhóm thống nhất** | • Chốt model/provider, budget, timeout, quản lý key.<br>• Ví dụ chung cho request/response/lỗi, chốt 3 ranh giới (A→B, B→D, B→C).<br>• Ghép luồng end-to-end thật trong sprint. | • Đã có giao diện TypeScript tại `@harness/protocol`.<br>• Chưa thống nhất cấu hình môi trường chung, chưa ghép luồng thật qua DB & API. | 🟡 **Đạt 30%** |
| **Research** | • Nghiên cứu source OpenCode, pipeline Judge & Audit.<br>• Nghiên cứu tool, context, stop condition, xử lý lỗi. | • Đã hoàn thành xuất sắc tài liệu: `tv1-agent-loop-design.md`, `tv1-opencode-reference-notes.md`, `tv2-context-engine-contract.md`, `tv1-agent-loop-demo-spec.md`.<br>• Cần trace thực tế từ model thật để đối chiếu giả định. | 🟢 **Đạt 90%** |

---

## 3. Chi tiết những điểm ĐÃ CÓ trên nhánh `agent-loop-core`

Mặc dù chưa làm hạ tầng ngoài của Sprint 2, nhánh `agent-loop-core` đã tạo ra những nền tảng kỹ thuật rất giá trị mà Sprint 2 có thể tận dụng ngay:

1. **Bộ hợp đồng chuẩn hoá tại `@harness/protocol`:**
   * `ModelGatewayPort`, `ModelAttemptRequest`, `ModelAttemptResponse`, `ModelAttemptError`, `TokenUsage`, `ModelUsage` (`packages/protocol/src/model-gateway.ts`): Cung cấp chuẩn giao tiếp chính xác giữa Runner (B) và Provider Adapter (D).
   * `RunStorePort`, `RunRecord`, `RunClaim`, `TrajectoryEvent` (`packages/protocol/src/ports.ts` & `events.ts`): Cung cấp chuẩn giao tiếp chính xác giữa Runner (B) và Drizzle Storage (C), bao gồm cơ chế Compare-and-Set (CAS) và bảo toàn thứ tự sequence của event stream.
   * `RunConfig` và `RunState` (`pending`, `running`, `completed`, `failed`): Tách bạch rõ trạng thái thực thi kỹ thuật và kết luận nghiệp vụ.

2. **Quy chuẩn kiểm thử hợp đồng RunStore (`runStoreContractTests`):**
   * Nằm tại `packages/core/src/testing/run-store-contract.ts`. Đây là bộ kiểm thử nghiệm thu (conformance test suite) viết sẵn. Khi C viết adapter PostgreSQL/Drizzle, chỉ cần chạy bộ test này để chứng minh tính đúng đắn (CAS, idempotency, event ordering, lease expiration).

3. **Cơ chế EventBus, EventSink và RetryPolicy tại `@harness/core`:**
   * `EventSink`: Chuẩn hoá việc ghi nhận sự kiện, tự động loại bỏ secret / credential, kiểm tra kích thước input.
   * `RetryPolicy`: Phân loại lỗi mạng, rate-limit, timeout; tính exponential backoff có jitter; tôn trọng chỉ dẫn không retry khi lỗi không thể phục hồi (401, invalid_request).

4. **Tài liệu nghiên cứu và thiết kế hoàn chỉnh:**
   * Nhóm Research đã hoàn thành phân tích OpenCode và phác thảo pipeline trong thư mục `docs/`.

---

## 4. Những chỗ CÒN THIẾU và CÔNG VIỆC CẦN LÀM trong Sprint 2

Dưới đây là danh sách chi tiết các công việc bắt buộc phải triển khai để hoàn thành nghiệm thu Sprint 2:

```
[Mục tiêu Sprint 2]
 ├── A: Workspace & CLI Entrypoint (packages/cli + .env.example)
 ├── B: Single-turn Runner (packages/core hoặc sub-runner)
 ├── C: PostgreSQL + Drizzle Schema & Migrations (packages/schema + RunStore Adapter)
 └── D: Real LLM Adapter (packages/llm + Provider SDK)
```

### 4.1. Track A — Setup công nghệ và lệnh chạy (Dev A phụ trách)
- [ ] **Khai báo package manifests còn thiếu:**
  * Tạo `packages/cli/package.json`, `packages/schema/package.json`, `packages/llm/package.json`, `packages/server/package.json` với cấu hình TypeScript/Bun để Turborepo quản lý đồng nhất.
- [ ] **Quản lý cấu hình môi trường:**
  * Tạo file `.env.example` chuẩn mẫu chứa:
    * `DATABASE_URL=postgresql://user:password@localhost:5432/harness`
    * `PROVIDER_NAME=openai` (hoặc anthropic/google/openrouter)
    * `MODEL_NAME=gpt-4o-mini` (hoặc model nhóm chọn)
    * `MODEL_API_KEY=...`
    * `MODEL_TIMEOUT_MS=30000`
    * `MODEL_MAX_OUTPUT_TOKENS=4096`
  * Viết module parse/validate env (sử dụng Zod), báo lỗi rõ ràng nếu thiếu cấu hình khi khởi động.
- [ ] **Xây dựng CLI / Điểm khởi động (`packages/cli`):**
  * Lệnh nhập prompt: Chạy runner với prompt người dùng truyền vào (ví dụ: `bun run cli run --prompt "Hello"`). In mã `runId`, trạng thái, kết quả phản hồi của model, token usage và chi phí.
  * Lệnh xem lại run: Tra cứu theo `runId` (ví dụ: `bun run cli view --id <runId>`). Đọc từ PostgreSQL và in lại prompt ban đầu, kết quả/lỗi, danh sách event theo thứ tự thời gian.
- [ ] **Tài liệu hướng dẫn triển khai:**
  * Cập nhật `README.md` hoặc viết `docs/environment-setup.md`: Hướng dẫn chạy PostgreSQL (qua Docker compose hoặc cài cục bộ), chạy lệnh migration và chạy CLI.

### 4.2. Track B — Quản lý run và runner một lượt (Dev B phụ trách)
- [ ] **Xây dựng `SingleTurnRunner` (hoặc hàm thực thi lượt đơn):**
  * `JudgeRunner` hiện tại trong `packages/core` quá nặng (yêu cầu finding markdown, snapshot, PoC code, stage sanitizer).
  * Cần bổ sung một runner hoặc chế độ chạy 1 lượt đơn giản:
    1. Nhận yêu cầu `{ runId, prompt, modelConfig }`.
    2. Gọi C để tạo bản ghi run ban đầu trong DB (`state = 'pending'`).
    3. Ghi event bắt đầu (`run.started` / `model.invoked`).
    4. Gọi adapter D (`ModelGatewayPort.executeAttempt()`).
    5. Ghi event kết quả (`model.completed` hoặc `model.failed`).
    6. Gọi C để cập nhật trạng thái cuối (`completed` kèm output, hoặc `failed` kèm error).
- [ ] **Kiểm tra đầu vào và ràng buộc:**
  * Kiểm tra độ dài prompt, giới hạn output tokens và timeout trước khi gọi D.
  * Không tự ý retry khi kết quả provider trả về là timeout/chưa rõ ràng mà không ghi nhận dấu vết gián đoạn.
- [ ] **Cung cấp API đọc dữ liệu run:**
  * Cung cấp các hàm `getRun(runId)` và `getRunHistory(runId)` thông qua `RunStorePort` để CLI (A) gọi hiển thị.

### 4.3. Track C — PostgreSQL/Drizzle và lưu dữ liệu (Dev C phụ trách)
- [x] **Cài đặt thư viện tại `packages/schema`:**
  * Cài đặt `drizzle-orm`, `drizzle-kit`, driver kết nối (ví dụ `postgres` hoặc `pg`, `@types/pg`).
- [x] **Thiết kế Schema Drizzle:**
  * Bảng `runs`: `id` (text/uuid PK), `prompt` (text), `state` (varchar: pending/running/completed/failed), `model_profile` (varchar), `result_content` (text nullable), `error_message` (text nullable), `prompt_tokens` (int), `completion_tokens` (int), `cost_usd` (numeric), `latency_ms` (int), `created_at`, `updated_at`.
  * Bảng `events`: `id`, `run_id` (FK), `sequence` (int), `event_type` (varchar), `payload` (jsonb), `timestamp`.
  * Bảng `model_attempts`: Lưu từng lần gọi provider (request an toàn không chứa key, response an toàn, finish reason, usage, latency, lỗi nếu có).
- [x] **Tạo và chạy Migration:**
  * Cấu hình `drizzle.config.ts`, tạo migration SQL đầu tiên (`drizzle-kit generate`), script chạy migration (`drizzle-kit migrate` hoặc `bun run db:migrate`).
- [x] **Hiện thực hoá adapter `PostgresRunStore`:**
  * Triển khai adapter `PostgresRunStore` đáp ứng interface `RunStorePort` từ `@harness/protocol`.
  * Chạy bộ test conformance `runStoreContractTests(createPostgresStore)` từ `@harness/core/testing` để bảo đảm adapter tuân thủ đúng yêu cầu CAS và sequence.
- [x] **Đảm bảo tính an toàn dữ liệu:**
  * Tuyệt đối không lưu API Key vào DB; sanitize request/response trước khi lưu.

### 4.4. Track D — Tích hợp API model thật (Dev D phụ trách)
- [x] **Cài đặt SDK và cấu hình tại `packages/llm`:**
  * Thống nhất chọn provider (ví dụ: OpenAI SDK, Anthropic SDK hoặc Gemini).
  * Cài đặt SDK chính thức vào `packages/llm`.
- [x] **Hiện thực hoá adapter `RealModelGateway`:**
  * Viết class `RealModelGateway` triển khai interface `ModelGatewayPort` (`packages/protocol/src/model-gateway.ts`).
  * Nhận `ModelAttemptRequest`, chuyển đổi thành định dạng request của provider SDK.
  * Thiết lập timeout bằng `AbortSignal` / `AbortController`.
  * **Tắt tính năng retry ngầm** của SDK (ví dụ trên OpenAI: `maxRetries: 0`) để B quản lý số lần gọi chính xác.
- [x] **Chuẩn hoá kết quả và xử lý lỗi:**
  * Trả về `ModelAttemptResponse` chuẩn: `attemptId`, `finishReason`, `content`, `usage` (`promptTokens`, `completionTokens`, `totalTokens`, `costUsd`), `latencyMs`.
  * Tính toán `costUsd` dựa theo bảng giá niêm yết của model đã chọn (nếu provider không trả chi phí).
  * Bắt các lỗi HTTP/mạng (401, 429, 500, ECONNRESET, timeout), chuẩn hoá về `ModelAttemptError` với đúng `category` (`transport`, `rate_limit`, `authentication`, `invalid_request`) và `isRetryable`, đảm bảo không để lộ API key trong message.
### 4.5. Hạng mục Cả nhóm cần thống nhất trước khi code
- [ ] **Chốt cấu hình kỹ thuật:**
  * Provider & Model cụ thể (ví dụ: `OpenAI gpt-4o-mini` hoặc `Gemini 1.5 Flash` vì chi phí thấp và tốc độ nhanh).
  * Ngân sách test cho cả nhóm và API key dùng chung/riêng.
  * Timeout mặc định (khuyến nghị: 30s) và token output limit (khuyến nghị: 2048 tokens).
- [ ] **Chốt chữ ký hàm giao tiếp (Interfaces):**
  * A → B: `executeRun({ prompt: string, modelConfig?: RunConfigInput }): Promise<RunResult>`
  * B → D: `ModelGatewayPort.executeAttempt(request: ModelAttemptRequest): Promise<ModelAttemptResponse>`
  * B → C: `RunStorePort` (đã có trong `@harness/protocol`).
- [ ] **Diễn tập kịch bản nghiệm thu:**
  1. Chạy CLI với prompt "Giải thích smart contract reentrancy trong 2 câu".
  2. Quan sát log: DB tạo run → gọi API thật → DB lưu kết quả và usage token/cost.
  3. Tắt CLI / terminal.
  4. Mở lại terminal mới, chạy lệnh xem lại run theo `runId`: Kết quả hiển thị đầy đủ từ PostgreSQL.
  5. Thử kịch bản lỗi: Sai API key hoặc ngắt mạng → hệ thống ghi nhận trạng thái `failed` và lỗi an toàn vào PostgreSQL.

### 4.6. Hạng mục Research tiếp tục thực hiện
- [ ] Lấy dữ liệu trace và response thực tế từ các lần gọi thật của Sprint 2 để phân tích độ trễ, token thực tế và chi phí cho các prompt kiểm tra bảo mật ban đầu.
- [ ] Tiếp tục hoàn thiện thiết kế pipeline Judge & Audit trên cơ sở dữ liệu thật thu được.

---

## 5. Lộ trình triển khai đề xuất để hoàn thành Sprint 2

Để hoàn thành Sprint 2 mà không phá vỡ cấu trúc hiện tại của `agent-loop-core`, nhóm nên tiến hành theo 4 bước tuần tự:

```mermaid
flowchart LR
    Step1["Bước 1: Khởi tạo Package & Config\n(A: package.json, .env.example)"] --> Step2["Bước 2: Xây dựng Adapter Thật\n(C: Drizzle schema + D: LLM SDK)"]
    Step2 --> Step3["Bước 3: Nối Single-turn Runner\n(B: Single-turn Runner)"]
    Step3 --> Step4["Bước 4: CLI & Nghiệm thu\n(A: CLI run/view + Kiểm thử restart)"]
```

1. **Bước 1 (Nền tảng):** Khởi tạo `packages/schema`, `packages/llm`, `packages/cli` và file `.env.example`.
2. **Bước 2 (Hai adapter song song):**
   * Dev C dựng PostgreSQL, bảng Drizzle, migration và `PostgresRunStore`. Chạy kiểm thử với `runStoreContractTests`.
   * Dev D dựng `RealModelGateway` trong `packages/llm` gọi API OpenAI/Gemini thật.
3. **Bước 3 (Điều phối):** Dev B ghép `PostgresRunStore` và `RealModelGateway` vào một `SingleTurnRunner` (hoặc mở rộng `JudgeRunner` với chế độ chạy single-turn prompt).
4. **Bước 4 (Khởi động & Nghiệm thu):** Dev A viết CLI trong `packages/cli`, tạo script `bun run prompt` và `bun run view`, viết hướng dẫn và thực hiện nghiệm thu theo đúng tiêu chí của Sprint 2.
