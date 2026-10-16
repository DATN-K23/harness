# Design

## Context

Xem [proposal.md](proposal.md) về vấn đề cần giải quyết. Harness hiện chỉ có mười package rỗng. Blueprint mô tả TypeScript/Bun nhưng một số spec còn yêu cầu Python capability tree; vai trò schema/core/client/CLI trong blueprint chưa được định nghĩa nhất quán.

Phạm vi thiết kế này là contract tài liệu kiến trúc; chưa triển khai runtime. Main-spec changes nằm trong hai [delta blueprint](specs/blueprint-structure/spec.md) và [delta orchestration](specs/judge-run-orchestration/spec.md).

## Goals / Non-Goals

**Goals:** một developer có thể xác định đúng package, public dependency và process boundary của một thay đổi; phân biệt dữ liệu chung, API ứng dụng, provider protocol và persistence. Reviewer có thể kiểm tra package ownership, dependency graph và process boundaries từ tài liệu Harness.

**Non-Goals:** tạo cây source sâu, port renderer/desktop/datastore, đưa dependency mới vào runtime, chốt SDK/provider profile, viết engine/scorer, áp dụng SmartPoC hay mở quyền thực thi PoC cho Judge. Không chọn cấu trúc thư mục chỉ để làm đầy các package rỗng.

## Decisions

### 1. Một bản đồ package chính, hai lớp thông tin rõ ràng

`blueprint/architecture/module-layout.md` là nguồn định nghĩa package có thẩm quyền. Mỗi package được mô tả theo nhiệm vụ, public surface và boundary của Harness; không có bảng đối chiếu implementation.

| Package | Contract Harness |
|---|---|
| schema | Safe data codecs/types; không DB tables, credentials hay scorer labels |
| protocol | Application API operations, payloads and errors built on schema |
| core | Agent/runtime capabilities and capability-owned persistence |
| llm | Public model port and provider integration |
| server | API handlers and public startup composition |
| client | Generated browser-safe API client; build-time generation stays separate |
| ui | Reusable presentation components |
| app | Screens and flows using client contracts |
| desktop | Narrow native shell/transport; not runtime authority |
| cli | User API commands and narrowly scoped runtime composition commands |

Các ví dụ dưới đây định nghĩa contract mong muốn của Harness; runtime chưa được triển khai.

**Lựa chọn thay thế:** chỉ sửa vài chú thích sẽ để package graph/rules cũ mâu thuẫn; chọn một package map Harness nhất quán và ghi rõ boundary.

### 2. Chuẩn hóa nghĩa của schema và hai loại protocol

Safe data contract thuộc schema, application transport contract thuộc protocol, provider wire codec thuộc llm. Table/persistence không còn ở schema. Ví dụ dùng để review:

| Câu hỏi | Owner |
|---|---|
| Safe run info có các trường gì? | schema |
| API nhận run ID và trả kết quả/lỗi gì? | protocol |
| Handler thực hiện operation nào? | server |
| Run lưu ở bảng/cột nào và transaction do ai thực hiện? | capability owner trong core |
| Request chung được đổi thành OpenAI/Anthropic wire format ra sao? | llm |

Một data schema vừa có thể sinh kiểu TypeScript vừa có thể dùng để decode/validate; import schema không tự thực thi validation. Shared contract không tự cấp DB quyền hay thay domain validation. Không buộc safe wire model giống từng cột DB.

**Lựa chọn thay thế:** giữ tên schema cho DB vì tài liệu đã viết như vậy làm trách nhiệm schema và persistence dễ nhầm. Đổi nghĩa ngay ở bước blueprint rẻ hơn port code rồi sửa.

### 3. Ma trận dependency có phân loại và ngoại lệ hẹp

Bảng dưới là allowlist runtime của Harness đề xuất. Consumer chỉ import public exports; không bắt buộc sử dụng tất cả dependency được phép.

| Consumer | Package nội bộ được phép tại runtime |
|---|---|
| schema | Không có |
| protocol | schema |
| llm | schema |
| core | schema, llm |
| server | protocol, schema, core |
| client | protocol, schema |
| ui | schema khi cần dữ liệu hiển thị; không bắt buộc gọi client |
| app | client, schema, ui |
| desktop renderer | app, ui, client, schema |
| desktop native host | Generated transport contract; không core/llm/server/DB |
| cli API commands | client, schema |
| cli composition commands | Public server/core startup contracts, schema; không private business internals |

Browser type-only imports cũng chỉ từ schema/protocol/public client contract, không dùng type-only làm đường vòng đưa scorer model hoặc backend structure sang UI. Giữ browser imports an toàn, tránh nạp runtime backend qua barrel/transitive dependency.

Client generator được dùng contract và tooling cần thiết, kể cả public server definitions khi thực sự cần; dependency phát sinh chỉ ở build-time. Generated output không import generator/server/core ở runtime. Khi API đổi, tái sinh và kiểm tra diff, không sửa generated code bằng tay. Chỉ xuất các endpoint được API contract cho phép.

CLI serve/start là composition root: ghép service/route và vòng đời tiến trình. Lệnh người dùng thực hiện nghiệp vụ qua API, không có agent loop thứ hai trong CLI. Startup của daemon không kéo scorer vào process chỉ vì cùng ở core. Việc CLI có thể start server không cho desktop quyền khởi tạo nghiệp vụ.

Vẽ hai hình tách biệt:

- Import graph dùng `consumer -> dependency`, theo bảng trên, không có `client -> server` runtime edge.
- Data-flow graph có `client --HTTP/IPC--> server -> core -> llm/provider` và persistence; có thể có worker/process/DB không phải package import.

**Lựa chọn thay thế:** graph gộp dễ khiến người đọc import server vào client; cấm CLI/backend hoàn toàn sẽ loại bỏ composition seam cần cho startup. Ngoại lệ giới hạn startup giữ ranh giới authority.

### 4. Capability ownership tồn tại bên trong package

Đặt `run_control`, `source_access`, `agent_runtime`, `judge`, `evaluation` và scorer-isolated `scoring` ở các vùng có owner trong core; `model_gateway` ở llm. Không tạo thêm mười dịch vụ hay đổi release topology. Shared safe data chuyển sang schema nhưng domain decision ở capability owner, wire operation ở protocol.

Định nghĩa public subpath theo nhu cầu, ví dụ đường tới service/type công khai; không buộc có thư mục vật lý tên `public`. Public operation không cho phép truy vấn trực tiếp bảng của capability khác. Database driver/migration assembly là hạ tầng core; contribution của từng bảng/migration vẫn có đúng owner, không dồn business query vào global database utility.

Scorer thuộc core về vị trí source nhưng **không thuộc dependency closure của daemon, worker, evaluator, ordinary CLI hay frontend**. Không export scorer qua shared barrel; không đưa GroundTruthLabel vào common schema/generated client. Scorer entrypoint có migration/schema projection và DB role riêng. Đổi vị trí persistence không bỏ yêu cầu grants, exact trace, outbox/claims, terminal CAS hay recovery khi provider attempt không rõ kết quả.

Registry visibility không thay thế authorization ở leaf executor. Harness phải duy trì kiểm quyền trước I/O và loại bỏ execution capability của Judge tại registry lẫn execution boundary.

**Lựa chọn thay thế:** đưa mọi thứ vào schema chung phá browser/scorer isolation; sao chép một root core barrel kéo mọi capability cũng không chấp nhận được. Vị trí source chung được chọn cùng với reachability và process-role restrictions tường minh.

### 5. Scope quyết định tái sử dụng và stack

Trong file ADR hiện có, thêm quyết định kế tiếp (dùng ID chưa trùng tại lúc apply) xác định package alignment và hướng selective reuse được leader yêu cầu. Bảo toàn ADR-004/008 như lịch sử, bổ sung supersession links cho phần reference-only/no-copy/package-role bị thay thế. Không tự ghi acceptance của một cuộc họp chưa diễn ra; phân biệt chỉ đạo reuse đã có với implementation reuse chưa làm.

Giữ React/Tauri/PostgreSQL và provider strategy hiện hành trong phạm vi change này. Không thay stack đã được chọn trong ADR chỉ bằng package alignment. Migration stack hoặc thay official-SDK strategy bằng route/protocol transport khác cần một change/ADR riêng trước khi port code phụ thuộc lựa chọn đó. Không chặn việc sửa package definitions vì những quyết định ngoài scope này.

Cập nhật `openspec/config.yaml` chỉ phần context bị lệch (stack chưa chọn và mô tả physical layout), tham chiếu ADR/package map mới; không nhân bản toàn bộ các bảng hoặc đổi research rules. Không thêm RQ1 methodology vào product blueprint; mục tiêu nghiên cứu giữ ở proposal/evaluation docs.

**Lựa chọn thay thế:** đổi stack cùng lúc sẽ vượt phạm vi định nghĩa package và ảnh hưởng các invariant/effort triển khai lớn. Giữ mọi no-copy statement làm quyết định hiện hành lại trái chỉ đạo mới của leader.

### 6. Phạm vi file và acceptance evidence

- `module-layout.md`: nguồn định nghĩa và import/generation/transport maps, ví dụ schema/protocol/persistence và ví dụ contract.
- `system-overview.md`: sửa nhãn persistence owner, package/process references và scorer boundary; giữ transaction/data-field semantics.
- `sequences.md`: sửa participant/package labels, không đổi state machine hay thuật toán enqueue/recovery trong change này.
- `vocabulary.md`: schema, API protocol/provider protocol, capability/package/process, CLI composition và đường desktop hiện hành.
- `README.md`: index/tóm tắt trỏ về module layout; không duplicate detailed matrix.
- `architecture-decisions.md`: quyết định kế tiếp và supersession có phạm vi.
- `openspec/config.yaml`: context nhất quán; main specs sync qua workflow.

Acceptance là review tài liệu có thể lặp lại: đủ mười package, graph không chu trình/không cấm một cạnh đồng thời cho phép nó, ownership và process boundaries nhất quán. Dùng một ví dụ schema/API/handler/persistence, một ví dụ client codegen, một ví dụ CLI serve và một ví dụ scorer leakage để kiểm tra ranh giới. Không tạo application tests chỉ để kiểm tra câu chữ; không chạy paid provider.

## Risks / Trade-offs

- [Capability/source chung bị hiểu là quyền chung] → Review dependency closure và scorer roles, không chỉ package.json.
- [Người đọc suy ra stack thay đổi từ package alignment] → Ghi rõ stack Harness hiện hành và yêu cầu ADR riêng cho stack migration.
- [Spec cũ và delta tạm thời khác nhau trước sync] → Apply đọc main + delta, chỉ công bố đồng bộ hoàn tất sau sync/archive; không sửa historical archives để che khác biệt.
- [Cấu trúc đúng bị coi là MVP hoàn tất] → Tasks chỉ là documentation evidence; lifecycle/PoC/research acceptance giữ riêng.

## Migration Plan

1. Chốt package responsibilities và boundary của Harness.
2. Viết quyết định kế tiếp và package map; rà soát capability/scorer và CLI exceptions.
3. Đồng bộ cross-references/labels và context trong các file nêu trên.
4. Kiểm toàn bộ scenario trong delta; strict validate change, sync spec theo workflow rồi validate main specs khi sync. Ghi lại lỗi baseline ngoài scope nếu có.
5. Hoàn tất documentation task và cập nhật trạng thái timeline phù hợp bằng chứng, không đánh dấu cả Judge/runtime cycle hoàn thành.

Rollback: revert đúng documentation diff và delta sync của change; không có data migration hay runtime deployment. Giữ nguyên package `.gitkeep`, file làm việc của user và `.gitignore` đang sửa.
