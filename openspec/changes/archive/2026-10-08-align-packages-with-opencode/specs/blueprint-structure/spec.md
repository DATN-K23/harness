# Spec Delta

## MODIFIED Requirements

### Requirement: Blueprint SHALL preserve ADR decisions
Blueprint MUST giữ nội dung lịch sử, status, chosen option, rationale và rejected alternatives của các ADR hiện có, gồm ADR-001 đến ADR-008. Khi thay đổi quyết định, tài liệu MUST ghi rõ quyết định kế tiếp và phạm vi supersession; lịch sử không được sửa thành một lựa chọn mới đã được duyệt trong quá khứ. Package alignment và cho phép tái sử dụng source MUST được phân biệt với quyết định đổi stack hoặc tích hợp code.

#### Scenario: ADR content preserved after consolidation
- **GIVEN** các ADR trước khi cập nhật package map
- **WHEN** đối chiếu tài liệu sau cập nhật
- **THEN** nội dung lịch sử vẫn truy được, và người đọc nhận biết lựa chọn hiện hành cùng phạm vi thay thế mà không mất rationale hoặc rejected alternatives

#### Scenario: Reuse direction supersedes a historical no-copy statement
- **GIVEN** chỉ đạo cho phép tái sử dụng phần OpenCode phù hợp và ADR cũ ghi no-copy
- **WHEN** quyết định alignment được ghi nhận
- **THEN** phần no-copy được đánh dấu superseded bằng tham chiếu quyết định mới, nhưng không ngụ ý đã copy source, chọn fork/dependency hay đổi desktop/database

### Requirement: Blueprint SHALL maintain uniform desktop and datastore technical stack
Blueprint MUST giữ lựa chọn Harness hiện hành: Tauri 2 và PostgreSQL qua Drizzle, với persistence/migration do capability trong `core` sở hữu, không đặt trong package dữ liệu chung `schema`. Thay đổi stack cần quyết định superseding riêng.

#### Scenario: Uniform desktop wrapper reference
- **GIVEN** reviewer kiểm tra blueprint Harness
- **WHEN** tìm lựa chọn desktop
- **THEN** Tauri 2 được xác định nhất quán là lựa chọn Harness

#### Scenario: Authoritative datastore via Drizzle ORM
- **GIVEN** định nghĩa lưu trữ trong ADR và system overview
- **WHEN** kiểm tra vị trí table/migration và datastore authority
- **THEN** PostgreSQL vẫn là authority duy nhất của Harness, table/migration thuộc capability trong core, và schema dùng chung không cấp quyền truy vấn DB

## ADDED Requirements

### Requirement: Harness package responsibility map
Blueprint MUST định nghĩa mười package `schema`, `protocol`, `core`, `llm`, `server`, `client`, `ui`, `app`, `desktop`, `cli` tại một nguồn có thẩm quyền, gồm nhiệm vụ, nội dung, public surface và giới hạn. Định nghĩa SHALL mô tả contract của Harness mà không yêu cầu đối chiếu implementation với dự án khác.

#### Scenario: A developer locates data and API definitions
- **GIVEN** một dữ liệu domain, hợp đồng API, table DB và handler
- **WHEN** developer tra module layout
- **THEN** lần lượt tìm thấy schema dữ liệu ở schema, API contract ở protocol, persistence theo capability ở core và handler ở server

#### Scenario: Package map is reviewed from Harness documentation
- **GIVEN** reviewer chỉ dùng tài liệu kiến trúc Harness
- **WHEN** reviewer tra package mapping
- **THEN** nhiệm vụ, public surface và boundary của cả mười package vẫn được xác định mà không cần source ngoài

### Requirement: Explicit dependency and transport documentation
Blueprint MUST có ma trận import runtime, generation/build và type-only được phân loại, tách khỏi HTTP/IPC transport. Ma trận SHALL cho phép protocol dùng schema, client runtime dùng schema/protocol và CLI composition dùng public core/server; MUST cấm browser runtime dùng backend, DB hoặc scorer internals. Các sơ đồ và lời văn SHALL nhất quán, không có chu trình runtime.

#### Scenario: Client generation and CLI startup are reviewed
- **GIVEN** client generator cần đọc API definitions và CLI serve cần ghép runtime
- **WHEN** reviewer kiểm tra dependency map
- **THEN** generation dependencies không trở thành browser runtime imports, CLI serve là composition entrypoint, và đường client gọi server được vẽ là transport thay vì import implementation

#### Scenario: Application and provider protocols are distinguished
- **GIVEN** một operation API ứng dụng và một encoder/decoder giao thức model
- **WHEN** reviewer xác định package owner
- **THEN** API thuộc protocol, giao thức model thuộc llm, và core điều phối qua model port mà không đặt HTTP application policy trong provider codec

### Requirement: Package alignment preserves research and safety contracts
Package alignment MUST giữ CandidateFinding/SourceSnapshot ở phía agent và GroundTruthLabel ở scorer riêng; budget, terminal/failure semantics, exact sanitized trace, immutable config và experiment-drift controls SHALL giữ nguyên.

#### Scenario: A shared schema or CLI import would expose labels
- **GIVEN** schema export hoặc CLI startup closure kéo theo scorer-only table, credential hay label
- **WHEN** đối chiếu boundary map
- **THEN** thiết kế bị từ chối dù dependency package có vẻ hợp lệ, và scorer tiếp tục có entrypoint, schema projection và quyền lưu trữ tách biệt

#### Scenario: Package boundaries preserve the Judge contract
- **GIVEN** package boundary hoặc runtime composition có thể cấp thêm quyền cho Judge
- **WHEN** reviewer kiểm tra package contract
- **THEN** Judge vẫn chỉ đọc, verdict `unverified`, và budget/failure/recovery semantics được giữ nguyên
