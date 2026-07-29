# Project Journal

Cập nhật hàng tuần, cả nhóm cùng đóng góp. Mẫu và cơ sở: [`04-working-rules.md`](04-working-rules.md).

**Ba chỉ số theo dõi liên tục:** cost / run · tỷ lệ compile · delta baseline vs harness.

---

## Tuần 1 (27/07-02/08/2026)

**Hoàn thành:** Chốt Blueprint v0.3; hoàn thành WP0 acceptance contract và WP1 workspace scaffold. Local frozen
install, format, lint, TypeScript strict, dependency rules, 3 tooling tests và 6 Slice 1 fixture-preflight tests
đều pass trên Node.js 24 LTS.

**Vướng mắc:** Chưa có blocker cho WP2. Shared contract đã được nhóm review; các thay đổi breaking sau WP2
freeze vẫn phải kèm migration note hoặc decision record.

**Quyết định:** Dùng Node.js 24 LTS, pnpm 11.17.0, TypeScript 6.0.3, Zod cho schema ở WP2 và modular monolith.
TypeScript 7 chưa được chọn vì typescript-eslint hiện chưa hỗ trợ. CI chạy cùng quality gate trên Windows và
Linux; runtime test không cần API key hoặc model provider.

**Số liệu mới:** 0 dependency violation; 9/9 local test pass; GitHub Actions Windows và Ubuntu cùng pass trên
PR #1. Chưa có cost/run, compile rate hoặc baseline-vs-harness delta vì agent runtime chưa được triển khai.

**Kế hoạch tuần sau:** WP0 và WP1 đã đóng qua PR #1. Bắt đầu WP2 contract/schema v0.

### Cập nhật WP2 (29/07/2026)

**Hoàn thành:** Tạo `packages/contracts` làm nguồn schema duy nhất; triển khai ID, Run/config, prompt manifest,
provider/model event, tool call/error/result, RunEvent, Finding, Judge và VerificationResult contract v0.
TypeScript type đều suy ra từ Zod. JSON Schema dùng native `z.toJSONSchema()` và được đối chiếu bằng AJV.

**Bằng chứng:** Fixture Slice 1 parse thành công; invalid field/enum và event payload sai type bị từ chối;
round-trip không mất dữ liệu; `valid`, `invalid`, `uncertain` giữ riêng. WP2 sẵn sàng contract-freeze review.

**Tiếp theo:** Dừng tại Gate WP2. Chỉ bắt đầu WP3 sau khi contract consumer xác nhận schema v0.

### Cập nhật WP3 (29/07/2026)

**Hoàn thành:** WP2 đã freeze qua PR #3. Tạo `packages/domain` với Run state machine, ToolCall settlement,
typed invariant error và typed stop reason cho `max_steps`, timeout, cancellation, internal failure. Transition
trả state mới, không mutate state cũ; timestamp do caller truyền và phải tăng đơn điệu.

**Bằng chứng:** Table test bao phủ mọi Run transition hợp lệ/bị cấm; ToolCall không settle lần hai; verdict sai
schema không thể complete Run; failed/cancelled Run giữ stop reason. Domain chỉ phụ thuộc `contracts`, không dùng
filesystem, clock thật, provider hoặc database.

**Tiếp theo:** Dừng tại Gate WP3 trước khi triển khai port/adapter của WP4.

### Cập nhật WP4 (29/07/2026)

**Hoàn thành:** WP3 đã merge qua PR #4. Tạo `packages/application` chứa port `ModelProvider`, `Workspace`,
`RunRepository`, `RunEventSink`/`EventStore`, `Clock`, `IdGenerator`, `ToolResolver` và `ToolExecutor`. Tạo
`packages/adapters` với in-memory repository/event store, deterministic clock/ID và filesystem source
workspace.

**Bằng chứng:** Reusable contract suite kiểm tra repository/event store; event store bắt đầu sequence từ 1,
giữ thứ tự theo từng run và từ chối event ID trùng. Filesystem boundary test từ chối absolute path, traversal
và symlink ra ngoài root; lỗi có type và không chứa host source path. Test sử dụng API Node đa nền tảng để CI
Windows/Ubuntu xác nhận khi mở PR.

**Tiếp theo:** Dừng tại Gate WP4. WP5 và WP6 chỉ bắt đầu sau khi port/adapter contract được review và CI hai hệ
điều hành pass.

### Cập nhật WP5 (29/07/2026)

**Hoàn thành:** WP4 đã merge qua PR #5. Thêm bốn config YAML cho Judge Slice 1, typed YAML source adapter,
structured merge theo `defaults → mode policy → experiment → explicit override`, immutable config snapshot và
sáu Judge prompt component v0. Mỗi component và manifest tổng được SHA-256 sau khi chuẩn hóa BOM, Unicode và
line ending.

**Quyết định contract:** `recovery_limits` và `policy` được thêm dưới dạng optional field để snapshot WP2 cũ
vẫn parse được; resolver WP5 luôn tạo snapshot có đầy đủ hai field. Điều này sửa thiếu sót giữa contract WP2 và
DQ-16 mà không tạo breaking migration.

**Bằng chứng:** Golden prompt và aggregate hash được pin; cùng input tạo cùng hash, CRLF/LF tạo cùng component
hash, còn đổi content hoặc thứ tự component làm aggregate hash đổi. Config sai bị chặn trước khi tạo snapshot;
prompt không chứa host path, fixture oracle, source finding hoặc tool implementation.

**Tiếp theo:** Dừng tại Gate WP5 trước khi WP7 dùng prompt/config contract hoặc WP8 tích hợp agent loop.

### Cập nhật WP6 (29/07/2026)

**Hoàn thành:** WP5 đã merge qua PR #6. Tạo `packages/tools-skills` với executable tool abstraction,
`ToolRegistry` implement application port và `read_file` v0. Registry đăng ký/resolve theo ID, từ chối ID trùng,
validate Zod input và validate `ToolResult` trước khi trả cho runtime.

**Error contract:** Unknown tool, input sai, line range sai, file không tồn tại và workspace denial đều trở
thành typed `ToolExecutionError` chứa `ToolError` chuẩn. Model message có mã lỗi, input sai và cách sửa an toàn;
permission denial không retry, không chứa host path hoặc raw stack.

**Bằng chứng:** Test bao phủ đọc toàn file, khoảng dòng inclusive, dòng đầu/cuối, range đảo/out-of-bounds,
unknown/duplicate tool, input sai kiểu, file thiếu, absolute path, traversal và symlink escape. Dependency rule
ngăn `tools-skills` import adapter, domain internals hoặc agent loop.

**Tiếp theo:** Dừng tại Gate WP6. WP8 chỉ tích hợp `read_file` qua `ToolResolver`/`ToolExecutor`, không thêm
nhánh `if tool_id === "read_file"` vào agent core.
