# Blueprint Structure

## Purpose

Định nghĩa cấu trúc tổ chức mới cho thư mục `blueprint/`, giảm thiểu số lượng file và loại bỏ nội dung dư thừa, giúp developer dễ navigate và maintain.

## Requirements

### Requirement: Blueprint SHALL contain no more than 10 normative files
Thư mục `blueprint/` MUST chứa tối đa 10 file normative (markdown, schema, YAML). Các file example/fixture có thể tồn tại thêm nhưng không được tính vào giới hạn này.

#### Scenario: File count within limit
- **WHEN** thư mục `blueprint/` được liệt kê đệ quy và đếm các file normative (loại trừ examples)
- **THEN** tổng số file bản mẫu MUST nhỏ hơn hoặc bằng 10

### Requirement: Blueprint SHALL have flat-first directory structure
Blueprint MUST tổ chức theo cấu trúc phẳng ưu tiên, tối đa 2 cấp thư mục (gốc + 1 cấp con). Không được có nested subdirectories sâu hơn 1 cấp. Thư mục mã nguồn `packages/core/src/` MUST tổ chức theo các khối capability được định nghĩa trong kiến trúc tổng quan: `source/` (quản lý snapshot), `tool/` (công cụ đọc mã nguồn), `context/` (rút gọn ngữ cảnh và token), `sandbox/` (môi trường thực thi an toàn), `judge/` (chế độ Judge), `audit/` (chế độ Audit), và `eval/` (bộ đánh giá thực nghiệm).

#### Scenario: No deeply nested directories
- **WHEN** duyệt cây thư mục `blueprint/`
- **THEN** không có file nào nằm sâu quá `blueprint/<section>/<file>` (tức là KHÔNG có `blueprint/a/b/c.md`)

#### Scenario: Core source modules align with capability layout
- **WHEN** kiểm tra cấu trúc thư mục `packages/core/src/`
- **THEN** các module `source/`, `tool/`, `context/`, `sandbox/`, `judge/`, `audit/`, và `eval/` được tổ chức độc lập theo đúng ranh giới capability của blueprint

### Requirement: Blueprint SHALL preserve current architecture decisions
Các lựa chọn kiến trúc còn hiệu lực MUST được ghi tại tài liệu blueprint có thẩm quyền, gồm stack, package ownership, provider boundary, runtime/desktop boundary và điều kiện tái sử dụng OpenCode. Quyết định tái sử dụng source MUST được phân biệt với đổi stack, chọn dependency/fork hay tích hợp code.

#### Scenario: Current decisions are documented without a separate ADR archive
- **WHEN** developer tra package layout và system overview
- **THEN** tìm thấy lựa chọn kiến trúc hiện hành và các ranh giới cần triển khai mà không cần giữ lịch sử ADR đã supersede

#### Scenario: Reuse direction is scoped
- **GIVEN** quyết định mới cho phép tái sử dụng phù hợp và ADR cũ ghi giới hạn no-copy
- **WHEN** package alignment được ghi nhận
- **THEN** phần bị thay thế trỏ tới quyết định mới, nhưng không hàm ý source đã được copy, dependency/fork đã được chọn, hay stack đã đổi

### Requirement: Blueprint SHALL not duplicate content across files
Mỗi khái niệm, quy tắc, hoặc quyết định kiến trúc MUST được định nghĩa tại đúng một vị trí. Các file khác muốn tham chiếu MUST sử dụng cross-reference link thay vì sao chép nội dung.

#### Scenario: No content duplication found
- **WHEN** tìm kiếm một requirement ID (ví dụ: ORCH-01) hoặc thuật ngữ kỹ thuật cốt lõi (ví dụ: GroundTruthLabel boundary) trong toàn bộ blueprint
- **THEN** định nghĩa chi tiết MUST chỉ xuất hiện tại đúng một file, các file khác chỉ chứa cross-reference link

### Requirement: Blueprint README SHALL serve as navigation index
File `blueprint/README.md` MUST chứa mục lục đầy đủ với mô tả ngắn và đường dẫn đến mọi file trong blueprint. README thay thế vai trò của manifest cũ làm "source of truth" cho danh sách artifacts.

#### Scenario: README covers all blueprint files
- **WHEN** liệt kê tất cả file trong `blueprint/` (trừ README.md)
- **THEN** mỗi file MUST được liệt kê trong README.md kèm mô tả ngắn gọn

### Requirement: Blueprint SHALL eliminate pure-meta files
Các file chỉ chứa meta-information mà không có nội dung kỹ thuật độc lập (manifest.yaml, manifest-format.md, validation-report.md, scope-audit.md, normative-backreferences.md) MUST bị loại bỏ hoặc gộp vào các file có nội dung cốt lõi.

#### Scenario: No standalone meta-only files exist
- **WHEN** kiểm tra danh sách file trong `blueprint/`
- **THEN** MUST không tồn tại file nào mà nội dung chỉ là cross-referencing, traceability matrix, hoặc digest tracking mà không kèm nội dung kỹ thuật cốt lõi

### Requirement: Blueprint SHALL maintain ground-truth isolation documentation
Tài liệu về ground-truth isolation boundary (GroundTruthLabel chỉ đến scorer, không bao giờ vào agent/provider/tool/desktop paths) MUST được giữ nguyên ở dạng rõ ràng trong cấu trúc mới, vì đây là invariant an toàn không thể bỏ qua.

#### Scenario: Ground-truth isolation rules findable
- **WHEN** developer tìm kiếm quy tắc về ground-truth isolation trong blueprint mới
- **THEN** MUST tìm thấy section rõ ràng mô tả boundary rules trong tối đa 1 file, với nội dung tương đương phần hiện tại trong `security/ground-truth-flow-audit.md` và `security/data-classification.md`

### Requirement: Blueprint SHALL maintain consistent core identity across all documents
Tất cả các tài liệu trong `blueprint/` MUST nhất quán định nghĩa hệ thống là khung tác tử AI (AI Agent framework) cho bảo mật Smart Contract hoạt động ở 2 chế độ chính: Audit Mode và Judge Mode. Blueprint MUST KHÔNG chứa các tham chiếu lỗi thời đến nghiên cứu so sánh RQ1 hay các cơ chế lập lịch so khớp direct/harness arm trong tài liệu sản phẩm.

#### Scenario: No legacy RQ1 references found
- **WHEN** tìm kiếm các thuật ngữ "RQ1", "primary RQ1 profile", hoặc "matched direct and harness calls" trong thư mục `blueprint/`
- **THEN** không có kết quả nào xuất hiện trong các tài liệu kiến trúc chuẩn mực

#### Scenario: Dual mode definition consistent
- **WHEN** kiểm tra phần tổng quan của `blueprint/README.md`, `blueprint/architecture/system-overview.md`, và `blueprint/architecture/module-layout.md`
- **THEN** tất cả đều thống nhất định nghĩa hai chế độ vận hành: Audit Mode và Judge Mode

### Requirement: Blueprint SHALL maintain uniform desktop and datastore technical stack
Blueprint MUST thống nhất chọn Tauri 2 làm desktop application wrapper và PostgreSQL qua Drizzle ORM làm authoritative datastore duy nhất. Bảng và migration MUST thuộc capability persistence trong `core`; package `schema` chỉ chứa data contract dùng chung và MUST NOT cấp quyền truy cập DB. Thay đổi stack cần quyết định superseding riêng.

#### Scenario: Uniform desktop wrapper reference
- **WHEN** kiểm tra các đề cập đến desktop wrapper trong `blueprint/README.md`, `blueprint/architecture/module-layout.md`, `blueprint/architecture/sequences.md`, và `blueprint/architecture/system-overview.md`
- **THEN** Tauri 2 được xác định là lựa chọn Harness nhất quán

#### Scenario: Authoritative datastore via Drizzle ORM
- **WHEN** kiểm tra định nghĩa lưu trữ và cơ sở dữ liệu trong `blueprint/architecture/module-layout.md` và `blueprint/architecture/system-overview.md`
- **THEN** PostgreSQL được xác nhận là authoritative datastore duy nhất, Drizzle ORM quản lý persistence do capability trong `core` sở hữu, và `schema` dùng chung không sở hữu DB tables/migrations

### Requirement: Harness package responsibility map
Blueprint MUST định nghĩa mười package `schema`, `protocol`, `core`, `llm`, `server`, `client`, `ui`, `app`, `desktop`, và `cli` tại một nguồn có thẩm quyền, gồm nhiệm vụ, nội dung, public surface và giới hạn. Định nghĩa MUST thể hiện contract Harness, không bắt buộc so sánh implementation với dự án ngoài.

#### Scenario: A developer locates data and API definitions
- **GIVEN** một data contract, API operation, database table và handler
- **WHEN** developer tra module layout
- **THEN** schema dữ liệu thuộc `schema`, API contract thuộc `protocol`, persistence thuộc capability trong `core`, và handler thuộc `server`

#### Scenario: Package map is reviewed from Harness documentation
- **GIVEN** reviewer dùng các tài liệu kiến trúc Harness
- **WHEN** reviewer tra package map
- **THEN** nhiệm vụ, public surface và boundary của cả mười package được xác định mà không cần một source đối chiếu ngoài

### Requirement: Explicit dependency and transport documentation
Blueprint MUST phân loại runtime import, type-only import và generation/build dependency, tách biệt chúng khỏi HTTP/IPC transport. Runtime graph MUST không có chu trình; browser runtime MUST NOT import backend, database hoặc scorer internals. CLI composition MAY dùng public core/server startup contracts.

#### Scenario: Client generation and CLI startup are reviewed
- **GIVEN** client contracts được generate và CLI có lệnh serve/start
- **WHEN** reviewer kiểm tra dependency map
- **THEN** generation dependency không đi vào browser runtime, CLI startup là composition entrypoint, và client gọi server qua transport thay vì import server implementation

#### Scenario: Application and provider protocols are distinguished
- **GIVEN** một operation API ứng dụng và một encoder/decoder giao thức model
- **WHEN** reviewer xác định package owner
- **THEN** API thuộc `protocol`, provider wire format thuộc `llm`, và core điều phối qua model port

### Requirement: Package alignment preserves research and safety contracts
Package alignment MUST giữ `CandidateFinding`/`SourceSnapshot` ở phía agent và `GroundTruthLabel` ở scorer riêng. Budget, terminal/failure semantics, exact sanitized trace, immutable configuration và experiment-drift controls SHALL tiếp tục được bảo toàn.

#### Scenario: A shared schema or CLI import would expose labels
- **GIVEN** shared schema hoặc CLI composition có thể kéo label hay scorer credential vào tiến trình thường
- **WHEN** reviewer kiểm tra dependency closure
- **THEN** thiết kế bị từ chối; scorer giữ entrypoint, schema projection và quyền lưu trữ riêng

#### Scenario: Package boundaries preserve the Judge contract
- **GIVEN** package boundary hoặc runtime composition có thể cấp thêm quyền cho Judge
- **WHEN** reviewer kiểm tra package contract
- **THEN** Judge vẫn chỉ đọc, verdict giữ trạng thái `unverified`, và budget/failure/recovery semantics được giữ nguyên

### Requirement: Blueprint SHALL present architectural flows at high level
Sơ đồ tuần tự và tương tác kiến trúc trong `blueprint/architecture/sequences.md` MUST giữ ở mức tổng quan (high-level), thể hiện rõ luồng dữ liệu cho cả Audit Mode và Judge Mode, đồng thời loại bỏ các chi tiết triển khai mức quá thấp (như cơ chế cập nhật nhị phân hệ điều hành có chữ ký số hoặc logic PoC runner chi tiết).

#### Scenario: Audit mode high-level sequence exists
- **WHEN** kiểm tra `blueprint/architecture/sequences.md`
- **THEN** tồn tại sơ đồ tuần tự mức cao mô tả luồng Audit Mode từ khi nạp repository smart contract đến khi xuất báo cáo findings

#### Scenario: Premature OS update coordination removed
- **WHEN** kiểm tra `blueprint/architecture/sequences.md`
- **THEN** sơ đồ `Coordinated signed update` mức hệ điều hành được loại bỏ để tập trung vào kiến trúc runtime của Agent
