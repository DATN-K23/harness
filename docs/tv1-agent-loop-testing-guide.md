# Hướng dẫn test Agent Loop (TV1)

> Dành cho: TV1 và bất kỳ ai cần kiểm tra lõi Agent Loop (`packages/protocol`, `packages/core`).
> Nhánh: `agent-loop-core`. Toàn bộ chạy **offline**, không cần API key, không cần Docker, không cần database.

---

## 1. Chuẩn bị (một lần)

Cần **Bun 1.3.14** (đúng phiên bản workspace ghim).

```bash
npm install -g bun@1.3.14
bun --version        # phải ra 1.3.14
```

Trên Windows + Git Bash, nếu `bun` không nhận, thêm thư mục npm global vào PATH:

```bash
export PATH="$PATH:$(cygpath "$(npm prefix -g)")"
```

Cài dependency ở thư mục gốc repo:

```bash
git switch agent-loop-core
bun install
```

---

## 2. Bốn lệnh cần chạy (theo thứ tự)

| # | Lệnh | Chạy ở đâu | Kết quả đúng |
|---|---|---|---|
| 1 | `bun run typecheck` | gốc repo | `Tasks: 2 successful, 2 total` |
| 2 | `bun test` | `packages/core` | `554 pass`, `0 fail` |
| 3 | `bun test` | `packages/protocol` | `129 pass`, `0 fail` |
| 4 | `bun run demo` | `packages/core` | bảng 4 kịch bản (xem mục 4) |
| 5 | `bun run stress` | `packages/core` | `100/100 runs crash-free, 0 invariant violations` |

Lưu ý: **đừng chạy `bun test` ở thư mục gốc**. Ở gốc hãy dùng `bun run test` (đi qua turbo) hoặc vào từng package.

Số test có thể tăng khi nhóm thêm test; điều quan trọng là `0 fail`.

---

## 3. Test được tổ chức thế nào

Mọi test dùng `bun:test`, không dùng thư viện mock. Các "đối tác" của vòng lặp (model, tool, context engine, store…) được thay bằng **fake có sẵn** trong `packages/core/src/testing`.

| Thư mục (`packages/core/test/`) | Kiểm tra gì |
|---|---|
| `runner/judge-runner.test.ts` | Vòng đời run: fast-reject, nhiều bước, nén context, tiếp quản (hydration), huỷ, không bao giờ crash |
| `runner/judge-step*.test.ts` | JudgeStep: 7 cổng, ép kết luận khi hết bước, lọc bí mật trước khi cắt, sửa verdict |
| `runner/retry-policy.test.ts` | Phân loại lỗi, số lần retry, công thức backoff, huỷ khi đang chờ |
| `runner/stop-conditions.test.ts` | Thứ tự ưu tiên điều kiện dừng, phát hiện không tiến triển |
| `runner/history-hydrator.test.ts` | Dựng lại context từ event sau khi worker chết |
| `step/parallel-tool-dispatcher.test.ts` | Chạy tool song song nhưng kết quả theo đúng thứ tự gọi |
| `judge/*.test.ts` | Verdict synthesizer (digest bằng chứng do hệ thống tính), tier 1/2, `run_state_probe` |
| `scenarios/*.test.ts` | Kịch bản end-to-end: crash recovery, stop precedence, cờ bật/tắt, tái lập |
| `stress.test.ts` | 100 run, kiểm tra bất biến từng run |
| `architecture.test.ts` | Luật phụ thuộc: protocol không import node/bun, core chỉ phụ thuộc protocol, file chuyển thể từ OpenCode có header + NOTICE |
| `testing/*.test.ts` | Chính các fake (store, gateway, snapshot…) |

Test của `@harness/protocol` nằm ở `packages/protocol/test/` (schema, verdict, event, cờ).

### Chạy một phần

```bash
cd packages/core
bun test test/runner/judge-runner.test.ts          # một file
bun test -t "cancel"                               # lọc theo tên test
bun test test/scenarios                            # cả thư mục
```

---

## 4. Demo: đọc kết quả thế nào

```bash
cd packages/core
bun run demo
```

Kết quả đúng:

```
scenario           state      reason                 steps  tokens
confirmed-exploit  completed  EXPLOIT_CONFIRMED      3      2460
missing-poc        completed  MISSING_POC            0      0
cheating-poc       completed  NON_FAITHFUL_OVERRIDE  0      0
failing-poc        completed  EXECUTION_FAILED       0      0
```

Điểm cần nhìn:
- Ba kịch bản bị loại sớm phải **0 token, 0 bước** (không gọi model).
- Kịch bản khai thác thành công đi qua nhiều bước và có chi phí.

Mỗi kịch bản ghi 7 file vào `packages/core/demo-output/<kịch bản>/` (thư mục này bị git bỏ qua):

| File | Trụ cột |
|---|---|
| `01-verdict.json` | Phán quyết có cấu trúc |
| `02-dossier.md` | Báo cáo chi tiết |
| `03-trajectory.json` | Nhật ký từng bước (event theo thứ tự) |
| `04-exploit-proof.json` | Bằng chứng khai thác / lý do không có |
| `05-context-economics.json` | Phân bổ context và token |
| `06-event-stream.jsonl` | Luồng event bắt lúc chạy |
| `07-reliability.json` | Độ tin cậy của run |

Chạy demo hai lần phải cho **đúng cùng nội dung** (tất định: fake clock + seed cố định).

---

## 5. Stress 100 run

```bash
cd packages/core
bun run stress
```

Đúng khi in:

```
100/100 runs crash-free, 0 invariant violations, 0 unhandled errors (base seed 20261011, ...)
```

Báo cáo chi tiết: `packages/core/demo-output/reliability-report.json`. "Crash-free" nghĩa là, với mỗi run: runner trả kết quả (không reject), đúng một trạng thái cuối, sequence event liên tục từ 1, tổng token/chi phí bằng tổng các `provider.attempted`. Lệnh thoát mã 1 nếu có vi phạm.

---

## 6. Tự kiểm chứng "test có răng" (tuỳ chọn, 5 phút)

Để chắc test thật sự bắt được lỗi, thử phá có chủ đích rồi hoàn lại:

1. **Luật kiến trúc:** thêm `import "node:fs"` vào một file trong `packages/protocol/src`, chạy `cd packages/core && bun test test/architecture.test.ts` → phải **fail**. Xoá dòng đó.
2. **Fast-reject:** trong `packages/core/src/runner/` sửa để stage 1 không từ chối khi thiếu PoC → test `MISSING_POC` phải fail (vì gateway bị gọi). Hoàn lại bằng `git checkout -- <file>`.
3. **Thứ tự kết quả tool:** đổi sắp xếp theo `callIndex` trong `packages/core/src/step/parallel-tool-dispatcher.ts` → test "out-of-order completion" phải fail.

Luôn `git status` sau khi thử để chắc đã hoàn lại.

---

## 7. Thêm test mới

- Dùng các fake trong `@harness/core/testing` (`ScriptedModelGateway`, `InMemoryRunStore`, `InMemoryToolRegistry`, `FakeClock`, `SeededRandom`, `FakeSleep`…). Ví dụ dựng sẵn một "thế giới test" nằm ở `packages/core/test/helpers/runner-world.ts`.
- Không dùng `Date.now()`, `Math.random()` hay timer thật trong code lõi; truyền clock/random/sleep giả vào.
- Một scenario trong spec = một test. Spec nằm ở `openspec/changes/bootstrap-agent-loop-core/specs/*/spec.md`.
- Output test phải sạch (không warning, không `console.log` thừa).
- Nếu bạn viết adapter thật cho một port (ví dụ store PostgreSQL của TV6), chạy bộ **contract test** có sẵn để kiểm tra adapter đúng hợp đồng:

```ts
import { runStoreContractTests } from "@harness/core/testing"
runStoreContractTests(() => makeMyPostgresStore())
```

---

## 8. Khi test fail

| Triệu chứng | Nguyên nhân hay gặp |
|---|---|
| `bun: command not found` | Chưa có PATH npm global (mục 1) |
| `bun test` ở gốc repo báo lỗi | Đừng chạy ở gốc; dùng `bun run test` hoặc vào package |
| Architecture test fail | Vừa thêm import `node:`/`bun:` vào protocol, hoặc file chuyển thể từ OpenCode thiếu header/NOTICE |
| Test về digest/prompt lệch trên máy khác | Line ending: kiểm tra `.gitattributes` đang ép LF |
| `turbo` báo cache hit nhưng nghi ngờ | Chạy `bun test` trực tiếp trong package để bỏ qua cache |

Tài liệu liên quan: `packages/core/README.md` (lệnh và bảng port theo từng track), `openspec/changes/bootstrap-agent-loop-core/design.md` (quyết định thiết kế và 6 cổng phê duyệt G1–G6).
