# Tasks

## 1. Chốt bằng chứng và quyết định kiến trúc

- [x] 1.1 [TV1 + TV6; gate: trước sửa package map] Chốt mười package và ghi trách nhiệm, public surface, dependency và boundary trong module layout. Bằng chứng: reviewer xác định được ownership mà không cần artifact đối chiếu source ngoài.
- [x] 1.2 [TV1 + TV6; gate: sau 1.1] Bổ sung quyết định kế tiếp trong `architecture-decisions.md` về package ownership và selective reuse theo chỉ đạo leader; nối supersession cho phần no-copy/layout cũ mà giữ lịch sử. Bằng chứng: reviewer phân biệt được quyết định hiện hành, lịch sử và phần chưa triển khai; React/Tauri/PostgreSQL và provider strategy không bị âm thầm thay đổi.

## 2. Định nghĩa package và kiểm tra boundary ngay tại nguồn

- [x] 2.1 [TV1 + TV2 + TV3; gate: sau 1.2] Viết lại trách nhiệm, nội dung và public surface của schema/protocol/core/llm trong `module-layout.md`, gồm data schema khác DB schema, application protocol khác provider protocol và persistence theo capability. Bằng chứng: lần đúng một ví dụ data/API/model/persistence qua walkthrough; không còn mô tả schema chung sở hữu bảng/migration của runtime.
- [x] 2.2 [TV6; gate: sau 2.1] Viết lại server/client/ui/app/desktop/cli, gồm generated client, build-time dependency và CLI composition exception. Bằng chứng: UI/desktop không có backend/DB authority; không có cột so sánh implementation ngoài Harness.
- [x] 2.3 [TV1 + TV6; gate: sau 2.2] Thêm ma trận runtime/type-only/generation dependency và hai hình riêng cho import với transport vào module layout. Bằng chứng: ma trận và hình không mâu thuẫn/không chu trình; protocol→schema được phép, client→server là transport, và generation imports không trở thành browser imports.
- [x] 2.4 [TV4 + TV5; gate: sau 2.3, trước cập nhật overview] Review và ghi capability/scorer ownership với public subpath, separate entrypoints, DB role/schema projections và cấm shared-barrel label export. Bằng chứng: walkthrough CandidateFinding/SourceSnapshot tới agent, GroundTruthLabel chỉ tới scorer; thử phân loại một shared schema lộ nhãn và một CLI startup kéo scorer đều bị boundary rules từ chối; giữ Judge chỉ đọc/unverified.

## 3. Đồng bộ tài liệu phụ thuộc

- [x] 3.1 [TV6 + TV4; gate: sau 2.4] Sửa package/persistence labels và references trong `system-overview.md` và `sequences.md`. Bằng chứng: mọi table/migration có capability owner ở core, không còn EventSink/DB được mô tả là authority của common schema; transaction, lifecycle, budget, recovery, redaction và scorer invariants không đổi trong diff.
- [x] 3.2 [TV1 + TV6; gate: sau 3.1] Đồng bộ `vocabulary.md`, README và phần context lỗi thời trong `openspec/config.yaml`; dùng cross-reference về module layout thay cho bản sao ma trận. Bằng chứng: không còn hướng dẫn hiện hành “chưa chọn stack”, Python physical tree hoặc CLI chỉ là frontend; lịch sử ADR được giữ nguyên, sáu file blueprint vẫn nằm trong giới hạn cấu trúc.

## 4. Kiểm tra liên tài liệu và bàn giao

- [x] 4.1 [TV1 + TV4 + TV5 + TV6; gate: sau 3.2] Đối chiếu toàn bộ scenario của hai delta với tài liệu sau sửa; chạy `openspec validate align-packages-with-opencode --strict` và `git diff --check`, kiểm liên kết cùng graph. Bằng chứng: log/lệnh tái hiện và bảng scenario→section trong ghi chú task; xác nhận không thêm source/manifests, không đổi stack, không triển khai SmartPoC hoặc phát sinh paid call. Mọi thay đổi tùy chọn ảnh hưởng kết quả phát hiện ngoài scope phải chuyển sang change riêng có flag, telemetry, snapshot và test bật/tắt đi cùng.
- [x] 4.2 [TV6; gate: documentation Definition of Done] Ghi bằng chứng người khác đọc/đối chiếu được package map, cập nhật trạng thái hoặc ghi chú phù hợp trong `docs/timeline.csv` mà không đánh dấu Judge/runtime hoàn thành; sync hai delta vào main specs rồi archive change theo workflow OpenSpec. Bằng chứng: task evidence và timeline phản ánh đúng phần tài liệu; main specs đã đồng bộ và được validate strict sau sync.


## Apply evidence — 2026-10-06

Scope: documentation only. Existing `.gitignore` edits were preserved. No Harness
source/manifests, reference code, stack migration, SmartPoC or paid provider calls
were introduced. Package directories remain placeholders. The two delta specs were
synced into the main specs and this change was archived on 2026-10-08.

Package map records Harness ownership and proposed boundaries without external-source comparison. This artifact scope was narrowed on 2026-10-08.

### Scenario coverage

All section references below are in the six tracked blueprint files, not the ignored handbook.
`layout` = [module-layout.md](../../../../blueprint/architecture/module-layout.md);
`overview` = [system-overview.md](../../../../blueprint/architecture/system-overview.md);
`ADRs` = [architecture-decisions.md](../../../../blueprint/decisions/architecture-decisions.md).

| Delta scenario | Acceptance evidence / section |
|---|---|
| ADR content preserved after consolidation | ADRs: Current applicability annotations and ADR-009; original ADR bodies compared with HEAD |
| Reuse direction supersedes a historical no-copy statement | ADR-009 Context and decision, Retained decisions and adaptation gates; ADR-004/008 annotations |
| Uniform desktop wrapper reference | layout: Harness stack choices; README and ADR-009 retain Tauri |
| Authoritative datastore via Drizzle ORM | layout: Capability placement; overview: Capability table/migration ownership and Authority |
| A developer locates data and API definitions | layout: Package responsibilities and Data, API, model and storage walkthrough |
| Package map is reviewed from Harness documentation | layout: ten package roles and boundaries are self-contained |
| Client generation and CLI startup are reviewed | layout: client, cli, Dependency matrix and separate import/transport figures |
| Application and provider protocols are distinguished | layout: protocol, llm and Data, API, model and storage walkthrough |
| A shared schema or CLI import would expose labels | layout: Boundary review walkthrough steps 2–4 reject shared labels and transitive scorer barrel |
| Package boundaries preserve the Judge contract | layout: Boundary review walkthrough step 5 and adaptation paragraph; ADR-009 retains read-only/unverified |
| Track implementation placement is reviewed | layout: ten Package responsibilities, Capability placement, Composition and repository placement |
| Scorer placement does not expose ground truth through core | layout: scoring owner, separate entrypoint and Boundary review walkthrough; overview process isolation |
| Cross-capability dependency is audited | layout: public subpaths, gateway persistence port/adapter direction and prohibition on foreign-table queries |
| Shared data contracts do not duplicate persistence models | layout: schema and RunInfo projection example; overview Authority |
| Deployment split is reviewed | layout: Composition and repository placement; overview Process composition, coordinated version and desktop contract |
| CLI starts the daemon | layout: cli and graph; overview Process composition retains durable admission; sequences only relabel DB/EventSink |

### Reproducible review

Run from repository root, with Python 3 and OpenSpec available:

```sh
openspec validate align-packages-with-opencode --strict
git diff --check
```

Expected: change valid and no whitespace errors.
Inspect `git diff -- blueprint openspec/config.yaml docs/timeline.csv` against this
scenario table. The following documentation check verifies relative links, the
runtime graph, ten package sections, six-file structure and unchanged execution
semantics against the pre-change Git HEAD. After commit, replace HEAD with the
pre-change revision when replaying the preservation comparison.

```sh
python3 - <<'PY_CHECK'
from pathlib import Path
import re, subprocess
files = list(Path('blueprint').rglob('*.md'))
assert len(files) == 6
for p in files:
    for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', p.read_text()):
        if '://' in target: continue
        name, _, anchor = target.partition('#')
        dest = p.parent / name if name else p
        assert dest.exists(), (p, target)
        if anchor:
            heads = re.findall(r'^#+ (.+)$', dest.read_text(), re.M)
            assert anchor in [re.sub(r'[^\w\- ]', '', h.lower()).replace(' ', '-') for h in heads]
layout = Path('blueprint/architecture/module-layout.md').read_text()
for name in 'schema protocol core llm server client ui app desktop cli'.split():
    assert layout.count('### ' + name + '\n') == 1
allowed = dict(protocol=['schema'], llm=['schema'], core=['schema','llm'],
    server=['protocol','schema','core'], client=['protocol','schema'], ui=['schema'],
    app=['client','schema','ui'], desktop_renderer=['app','ui','client','schema'],
    cli_api=['client','schema'], cli_composition=['server','core','schema'],
    desktop_native=['generated_contract'])
graph = layout.split('### Runtime import graph')[1].split('```mermaid')[1].split('```')[0]
assert set(re.findall(r'^  (\w+) --> (\w+)$', graph, re.M)) == {(a,b) for a,bs in allowed.items() for b in bs}
def visit(n, stack):
    assert n not in stack
    for b in allowed.get(n, []): visit(b, stack + [n])
for n in allowed: visit(n, [])
def versions(name):
    p = 'blueprint/' + name
    return subprocess.check_output(['git','show','HEAD:' + p], text=True), Path(p).read_text()
a,b = versions('architecture/system-overview.md')
start,end = '## Persistence Field Dictionary','## PostgreSQL Consistency, Work Delivery, and Recovery'
assert a.split(start)[1].split(end)[0] == b.split(start)[1].split(end)[0]
assert a.split('### Transaction boundaries')[1] == b.split('### Transaction boundaries')[1]
a,b = versions('architecture/sequences.md')
assert a.split('## Tool failure and recovery')[1] == b.split('## Tool failure and recovery')[1]
a,b = versions('decisions/architecture-decisions.md')
b = b.split('\n\n# ADR-009:', 1)[0]
assert re.sub(r'\n> Current applicability: [^\n]+\n', '', b).rstrip() == a.rstrip()
assert not subprocess.check_output(['git','diff','--name-only','--','packages'], text=True).strip()
print('PASS: structure, links, graph, preserved fields/transitions/recovery/ADR history')
PY_CHECK
```

Validation results recorded 2026-10-08: strict change validation PASS; `git diff --check`
PASS; structure/link/anchor check PASS; runtime allowlist equality and acyclic graph
PASS; unchanged field dictionary, transaction/recovery text and lifecycle section
PASS; historical ADR bodies preserved PASS. No runtime tests/build are claimed for
this documentation-only change. Source/runtime boundary enforcement still needs
implementation tests in the relevant future changes.

### Documentation handoff

A teammate can review the map without the ignored `zinn` handbook using the package definitions, concrete walkthroughs, all-scenario table and replay commands above. This records portable review evidence, **not** a claim that a teammate already
ran it on another machine. Team review and runtime readiness remain separate gates.
Timeline receives a dated documentation-only note; no Judge/runtime cycle is marked complete.

The synced main specs are:

- [blueprint-structure](../../../specs/blueprint-structure/spec.md)
- [judge-run-orchestration](../../../specs/judge-run-orchestration/spec.md)

The delta snapshots remain in this archive for traceability. Validate the archived
change and both affected main specs with OpenSpec when replaying this documentation
change; do not treat successful documentation validation as runtime implementation evidence.
