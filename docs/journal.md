# Project Journal

Cập nhật hàng tuần, cả nhóm cùng đóng góp. Mẫu và cơ sở: [`04-working-rules.md`](04-working-rules.md).

**Ba chỉ số theo dõi liên tục:** cost / run · tỷ lệ compile · delta baseline vs harness.

---

## Tuần 1 (27/07-02/08/2026)

**Hoàn thành:** Chốt Blueprint v0.3; hoàn thành WP0 acceptance contract và WP1 workspace scaffold. Local frozen
install, format, lint, TypeScript strict, dependency rules, 3 tooling tests và 6 Slice 1 fixture-preflight tests
đều pass trên Node.js 24 LTS.

**Vướng mắc:** Shared contract vẫn cần TV1, TV5 và TV6 review trước WP2 freeze. GitHub Actions Windows/Linux
được cấu hình nhưng chỉ được xác nhận sau khi branch được push.

**Quyết định:** Dùng Node.js 24 LTS, pnpm 11.17.0, TypeScript 6.0.3, Zod cho schema ở WP2 và modular monolith.
TypeScript 7 chưa được chọn vì typescript-eslint hiện chưa hỗ trợ. CI chạy cùng quality gate trên Windows và
Linux; runtime test không cần API key hoặc model provider.

**Số liệu mới:** 0 dependency violation; 9/9 local test pass; chưa có cost/run, compile rate hoặc
baseline-vs-harness delta vì agent runtime chưa được triển khai.

**Kế hoạch tuần sau:** Hoàn tất CI/review WP1, sau đó triển khai WP2 contract/schema v0.
