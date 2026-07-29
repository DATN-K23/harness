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
