# Audit Harness

Repository triển khai harness đánh giá và kiểm định smart-contract finding bằng LLM.

## Trạng thái hiện tại

WP0-WP5 đã đóng. WP6 đã triển khai tool registry tối thiểu và `read_file` v0; hiện đang chờ Gate WP6. Chưa có
agent loop, provider adapter hoặc Judge demo.

## Prerequisites

- Node.js major 24, dùng một patch LTS hiện hành.
- Corepack.
- pnpm `11.17.0` được pin trong `package.json`.

Kiểm tra môi trường:

```powershell
node --version
node -p "process.release.lts"
corepack pnpm --version
```

`process.release.lts` phải trả tên LTS, không được để trống.

## Cài đặt

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
```

`corepack enable` tạo pnpm shim để dùng lệnh `pnpm` trực tiếp. Các script nội bộ vẫn gọi qua Corepack, vì vậy
`corepack pnpm verify` hoạt động cả khi pnpm shim chưa có trong `PATH`.

## Quality commands

```powershell
corepack pnpm check
corepack pnpm test
corepack pnpm test:e2e:slice1
corepack pnpm verify
```

- `check`: format check, ESLint, TypeScript strict và dependency rules.
- `test`: tooling/unit/contract/integration test mặc định.
- `test:e2e:slice1`: ở WP1 chỉ kiểm tra fixture layout và oracle separation.
- `verify`: chạy toàn bộ quality command đã hiện thực.

`demo:slice1` được giữ làm command contract nhưng chỉ được hiện thực ở WP9, sau khi agent loop, tool và fake
provider tồn tại. Không coi fixture preflight hiện tại là Judge E2E đã hoàn thành.

## Tài liệu triển khai

- [Blueprint](docs/06-blueprint.md)
- [Slice 1 implementation plan](docs/07-slice-1-implementation-plan.md)
- [Slice 1 acceptance contract](docs/slice-1/acceptance-contract.md)
