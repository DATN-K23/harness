# Contracts

Nguồn schema duy nhất cho runtime validation, TypeScript type và JSON Schema của harness. Package này không
được import filesystem, model SDK, database driver hoặc framework server.

## Quy ước wire format

- Object dùng `snake_case`, là strict object và từ chối field không khai báo.
- TypeScript type được suy ra bằng `z.infer`; không viết interface tương đương ở consumer.
- ID là opaque string do hệ thống sinh, không dùng array index và không suy diễn ý nghĩa từ nội dung ID.
- `schema_version` hiện là literal `1`; chỉ tăng khi shape hoặc semantics của contract thay đổi.
- Timestamp là ISO-8601 có timezone và được lưu ở UTC.
- `RunEvent.sequence` là số nguyên dương, tăng đơn điệu trong một run và được cấp khi append event; không dùng
  thời gian hoàn thành để tạo sequence.
- Version của prompt component và tool theo `major.minor.patch`.
- Hash là SHA-256 lowercase với prefix `sha256:`. Aggregate prompt hash phụ thuộc content và thứ tự component;
  thuật toán tạo hash thuộc WP5, còn WP2 chỉ freeze representation.
- `confidence` nằm trong `[0, 1]`; line number và token/step limit là số nguyên dương.
- `uncertain` và `unverified` là trạng thái riêng, không tự động ép thành `invalid` hoặc `rejected`.
- `StopReason` phân biệt `max_steps`, `timeout`, `cancellation` và `internal_failure`; domain giữ nguyên reason
  khi Run kết thúc.
- WP5 thêm optional `recovery_limits` và `policy` vào wire snapshot để snapshot v0 cũ vẫn parse được; resolver
  WP5 luôn tạo snapshot mới có cả hai field.

## JSON Schema

Dùng `toDraft7JsonSchema(schema)`, được triển khai trực tiếp bằng native `z.toJSONSchema()`. Draft 7 là wire
target cho provider/tool schema. Contract test dùng AJV và format validation để chứng minh fixture đại diện có
cùng kết quả accept/reject giữa Zod và JSON Schema.

## Thay đổi contract

Sau Gate WP2, breaking change phải có owner, consumer review và migration note hoặc decision record. Không sửa
fixture expected chỉ để phù hợp implementation.
