# Slice 1 Acceptance Contract

> **Phiên bản:** 1.0.0
> **Trạng thái:** Ready for review
> **Phạm vi:** WP0 — Walking Skeleton
> **Không phải runtime schema:** WP2 mới freeze Zod schema v0.

---

## 1. Điều Slice 1 phải chứng minh

Một Judge run phải chạy hoàn toàn offline theo luồng:

```text
finding input + source workspace + resolved config
  → Run queued
  → Run running
  → compose Judge prompt v0
  → fake provider yêu cầu read_file
  → runtime validate và thực thi tool trong source workspace
  → fake provider nhận tool result
  → fake provider trả structured JudgeVerdict
  → runtime validate verdict
  → Run completed
  → in-memory trajectory có đúng event order
```

Slice 1 được chấp nhận khi cả case `valid` và `invalid` chạy qua cùng một đường code. Không được tạo nhánh
runtime đặc biệt theo expected verdict.

---

## 2. Implementation ownership

Theo yêu cầu hiện tại, TV3 trực tiếp triển khai toàn bộ Slice 1. Module ownership dài hạn và review contract
vẫn giữ theo blueprint:

| Artifact                                       | Implementation owner trong Slice 1 | Reviewer bắt buộc trước WP2 freeze |
| ---------------------------------------------- | ---------------------------------- | -------------------------------------- |
| Run, config snapshot, agent loop               | TV3                                | TV1, TV5                               |
| Prompt manifest và hash                       | TV3                                | TV1, TV5                               |
| Tool contract, ToolCall, ToolResult, ToolError | TV3                                | TV1, TV5                               |
| Workspace boundary                             | TV3                                | TV4                                    |
| Judge input, JudgeVerdict, Finding             | TV3                                | TV5, TV6                               |
| RunEvent và trace fields                      | TV3                                | TV1, TV5, TV6                          |
| VerificationResult contract v0                 | TV3                                | TV4, TV5                               |

Một người có thể viết toàn bộ code nhưng shared contract không được self-approve. Review ở đây bảo vệ khả
năng tích hợp của các Slice sau, không chia lại công việc implementation.

---

## 3. Command contract

| Command                  | Ý nghĩa                                          | Exit code khác 0 khi                          |
| ------------------------ | -------------------------------------------------- | ---------------------------------------------- |
| `pnpm check`           | Format check, lint, typecheck và dependency rules | Có vi phạm quality/dependency                |
| `pnpm test`            | Unit, contract và integration test mặc định    | Có test thất bại                            |
| `pnpm test:e2e:slice1` | Chạy hai Judge acceptance case offline            | Verdict, event hoặc state sai                 |
| `pnpm demo:slice1`     | Chạy một case dễ đọc và in trace tóm tắt   | Run không completed hoặc output sai contract |

WP1 hiện thực `check`, `test` và `test:e2e:slice1`; ở WP1, E2E command mới chạy fixture preflight. WP9 hiện
thực `demo:slice1`, còn WP10 thay preflight bằng Judge E2E hoàn chỉnh. WP0 freeze tên và semantics cuối để
README, CI và thành viên không dùng các lệnh khác nhau hoặc coi fixture preflight là agent E2E đã hoàn thành.

---

## 4. Fixture layout và security boundary

```text
tests/fixtures/slice1/
├─ source/                         # runtime được cấp thư mục này
│  └─ contracts/
│     └─ Vault.sol
├─ inputs/                         # application nhận từng finding
│  ├─ valid-reentrancy.json
│  └─ invalid-access-control.json
└─ expected/                       # chỉ E2E assertion được đọc
   ├─ valid-reentrancy-verdict.json
   └─ invalid-access-control-verdict.json
```

Quy tắc:

1. `Workspace` của runtime chỉ trỏ tới `source/`.
2. Finding được application truyền vào Run; model không tự đọc thư mục `inputs/`.
3. Runtime, tool và fake provider không nhận path tới `expected/`.
4. E2E test đọc `expected/` sau khi Run kết thúc để assert.
5. `read_file` chỉ nhận relative path tính từ `source/`.

Việc tách thư mục ngay từ fixture ngăn test vô tình huấn luyện một dependency boundary sai rồi mang sang
dataset thật.

---

## 5. Source fixture

[`Vault.sol`](../../tests/fixtures/slice1/source/contracts/Vault.sol) chứa hai vùng độc lập:

| Vùng          | Ý nghĩa                                                                   |
| -------------- | --------------------------------------------------------------------------- |
| `withdraw()` | Có external call trước khi xóa balance; finding reentrancy là`valid` |
| `setFee()`   | Có`onlyOwner`; finding missing access control là `invalid`            |

Fixture cố ý nhỏ và không phụ thuộc Foundry. Slice 1 kiểm tra agent/tool flow, không kiểm tra compiler hoặc
verification sandbox.

---

## 6. Acceptance case A — Valid finding

### Runtime input

[`valid-reentrancy.json`](../../tests/fixtures/slice1/inputs/valid-reentrancy.json)

Claim: `withdraw()` có thể bị re-enter vì gửi ETH trước khi cập nhật `balances[msg.sender]`.

### Fake-provider script

Turn 1:

```yaml
expected_request:
  mode: judge
  visible_tools:
    - read_file
scripted_output:
  type: tool_call
  tool: read_file
  input:
    path: contracts/Vault.sol
    start_line: 24
    end_line: 32
  finish_reason: tool_calls
```

Turn 2 phải assert chronological messages chứa ToolResult thực tế với dòng 28 và 31. Nếu thiếu ToolResult
hoặc tool output không đến từ registry execution, fake provider phải fail test.

Turn 2 scripted output là nội dung trong
[`valid-reentrancy-verdict.json`](../../tests/fixtures/slice1/expected/valid-reentrancy-verdict.json).

### Expected result

- Run status: `completed`;
- classification: `valid`;
- severity: `high`;
- evidence gồm `contracts/Vault.sol:28` và `contracts/Vault.sol:31`;
- đúng một ToolCall `read_file` ở trạng thái `completed`.

---

## 7. Acceptance case B — Invalid finding

### Runtime input

[`invalid-access-control.json`](../../tests/fixtures/slice1/inputs/invalid-access-control.json)

Claim: bất kỳ account nào cũng có thể gọi `setFee()`.

### Fake-provider script

Turn 1 gọi:

```yaml
tool: read_file
input:
  path: contracts/Vault.sol
  start_line: 13
  end_line: 37
```

Turn 2 phải assert ToolResult chứa định nghĩa `onlyOwner` và khai báo `setFee(... external onlyOwner)`.

Turn 2 scripted output là nội dung trong
[`invalid-access-control-verdict.json`](../../tests/fixtures/slice1/expected/invalid-access-control-verdict.json).

### Expected result

- Run status: `completed`;
- classification: `invalid`;
- severity: `unknown`;
- evidence gồm modifier và vị trí áp dụng modifier;
- đúng một ToolCall `read_file` ở trạng thái `completed`.

---

## 8. Happy-path event order

Mỗi event có `event_id`, `run_id`, `sequence`, `occurred_at`, `type`, `schema_version` và payload theo type.
WP2 chốt field schema; WP0 chốt semantics và thứ tự:

| Sequence | Event type                  | Invariant chính                                                                         |
| -------: | --------------------------- | ---------------------------------------------------------------------------------------- |
|        1 | `run_created`             | Run ở`queued`, config snapshot đã tồn tại                                         |
|        2 | `run_started`             | Run chuyển sang`running`                                                              |
|        3 | `provider_turn_started`   | Turn 1 dùng prompt/tool manifest đã hash                                              |
|        4 | `tool_call_requested`     | Tool name và raw input từ provider được liên kết với turn; chưa có side effect |
|        5 | `provider_turn_completed` | Turn 1 kết thúc với`finish_reason: tool_calls`                                      |
|        6 | `tool_call_started`       | Schema input đã hợp lệ; chỉ bắt đầu sau safe provider-turn boundary              |
|        7 | `tool_call_completed`     | ToolCall settle đúng một lần và có ToolResult                                      |
|        8 | `provider_turn_started`   | Turn 2 chứa ToolResult theo chronological history                                       |
|        9 | `provider_turn_completed` | Turn 2 kết thúc với final-result finish reason                                        |
|       10 | `verdict_produced`        | Structured verdict hoàn chỉnh đã qua Zod validation                                  |
|       11 | `run_completed`           | Run có verdict hợp lệ và terminal status                                             |

Không được:

- chạy tool trước `provider_turn_completed` của Turn 1;
- phát `run_completed` trước khi verdict validate;
- cập nhật event cũ;
- dùng completion time làm sequence;
- bỏ event lỗi để làm test xanh.

---

## 9. Scripted data và runtime-generated data

### Fake provider được script sẵn

- quyết định gọi `read_file`;
- tool name và tool input;
- normalized provider finish reason;
- final structured verdict;
- provider metadata giả ổn định phục vụ contract test.

Fake provider không được script sẵn ToolResult. Nó phải nhận ToolResult do registry và workspace adapter tạo.

### Runtime phải tự tạo

- `run_id`, `turn_id`, `tool_call_id`, `event_id`;
- timestamp và event sequence;
- resolved `RunConfigSnapshot`;
- prompt components, component hash và aggregate prompt hash;
- provider request và chronological messages;
- tool input validation;
- workspace path resolution;
- file content và numbered-line ToolResult;
- Run/ToolCall state transition;
- verdict validation;
- trajectory;
- terminal Run status.

Trong test, Clock và IdGenerator là deterministic adapter. Deterministic không có nghĩa là fake provider
được phép điền thay dữ liệu thuộc trách nhiệm runtime.

---

## 10. Output contract để quan sát

`demo:slice1` in một summary tương đương:

```json
{
  "run_id": "run_slice1_valid_001",
  "status": "completed",
  "classification": "valid",
  "severity": "high",
  "evidence_refs": [
    "contracts/Vault.sol:28",
    "contracts/Vault.sol:31"
  ],
  "tool_call_count": 1,
  "event_count": 11,
  "prompt_hash": "sha256:..."
}
```

Hash cụ thể do WP5 tạo. WP0 chỉ chốt thuật toán family là SHA-256 và output phải mang prefix `sha256:`.

---

## 11. WP0 review gate

Artifact WP0 sẵn sàng review khi:

- [X] Node.js major và command contract đã chốt;
- [X] implementation owner và contract reviewer đã ghi;
- [X] source fixture đã cố định;
- [X] hai finding input tách khỏi expected verdict;
- [X] fake-provider scenario đã mô tả;
- [X] happy-path event order đã chốt;
- [X] scripted/runtime-generated responsibility đã tách rõ.

Approval trước khi sang WP2 contract freeze:

- [ ] TV1 — agent/runtime consumer;
- [ ] TV3 — implementation owner;
- [ ] TV5 — evaluation consumer;
- [ ] TV6 — trace/protocol consumer.

TV4 review riêng workspace boundary trước khi merge `read_file` ở WP6.

Môi trường hiện tại còn một precondition cho WP1: thay Node.js `v24.9.0` bằng một patch Node.js 24 có
`process.release.lts` hợp lệ.
