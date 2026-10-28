# Megapot H03: Claude Sonnet 4.6 + static verdicts, lần đầu ra verdict live (2026-10-29)

> **Kết quả:** run `run-1793209079926` kết thúc `completed`, verdict **VALID / PASS / HIGH / EXPLOIT_CONFIRMED**, 11 trích dẫn code được harness kiểm digest. Cả hai chiều đều do model tự nộp, không có lỗi nào bị che. Đây là kết luận tĩnh theo luật TV4, chưa có bằng chứng thực thi.

## 1. Bối cảnh

- Nhánh `judge-live-test-megapot`, đã reset về `974b01c` ngày 2026-10-28. Các thay đổi P0/P1/P2/prose/A+C/B được giữ ở nhánh `backup/judge-live-2026-10-28`.
- Các lần chạy trước bằng Gemini 3.8 flash qua Antigravity không ra được verdict, vì hai lỗi:
  1. Bộ lọc an toàn của Gemini chặn ngẫu nhiên ở bước kết luận (`blockReason: OTHER`).
  2. Antigravity bỏ qua `tool_choice`, nên Gemini gọi `read_file` thay vì nộp bài.
- Thử nghiệm ngày 2026-10-28 cho thấy Claude qua Antigravity nộp đúng công cụ và không bị chặn. Vì vậy lần này chạy bằng Claude.

## 2. Môi trường

| Mục       | Giá trị                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code       | `974b01c` + bản sửa ở mục 4 (chưa commit lúc chạy run 3)                                                                                    |
| Model      | `ag/claude-sonnet-4-6` qua 9router (Antigravity). `ag/claude-sonnet-5-5` trả 404 trên tài khoản.                                             |
| Finding    | Bản chuẩn hoá của H03, SHA-256 `87488cf699aeea6b73a8066ae6743a63b8fce2336ddc3cd6e349ebae5c8f45d5`                                              |
| Snapshot   | `snap_e6948cc616b6` (27 contract Megapot + OpenZeppelin 5.4.0, Pyth entropy 2.0.0, Solady 0.1.24)                                                  |
| DB         | PostgreSQL 16 tạm, container `harness-run-974b01c-sonnet`, cổng 127.0.0.1:55432, migrate bằng code `974b01c`. Không dùng DB trong `.env`. |
| Giới hạn | `--max-steps 60 --max-total-tokens 1500000 --max-output-tokens 8192 --timeout 180000`, giới hạn ngoài 1800 giây                                |

`--max-output-tokens 8192`: route Claude của router dùng `max_tokens` làm trần thật, nên nếu để 512 thì JSON verdict sẽ bị cắt.

Lệnh (run 3):

```sh
bun --no-env-file run packages/cli/src/index.ts run \
  --snapshot snap_e6948cc616b6 --finding <h03-candidate.md> \
  --model ag/claude-sonnet-4-6 --static-verdicts --structured-output \
  --max-steps 60 --max-total-tokens 1500000 --max-output-tokens 8192 --timeout 180000
```

Credential được truyền qua biến môi trường của process, không ghi vào log.

## 3. Ba lần chạy

| Run                             | Cờ thêm                 | Kết quả                            | Dừng ở       | Lượt gọi AI |             Token | Lần đọc code |
| ------------------------------- | ------------------------- | ------------------------------------ | -------------- | -------------: | ----------------: | --------------: |
| `run-1793206929279`           | `--static-verdicts`     | failed / `schema_repair_exhausted` | Chiều xuôi   |             16 |           294.528 |              19 |
| `run-1793208683047`           | + `--structured-output` | failed / `schema_repair_exhausted` | Chiều ngược |             18 |           331.444 |              21 |
| **`run-1793209079926`** | + bản sửa mục 4        | **completed / VALID**          | —             |   **13** | **221.623** |              18 |

Cả 3 run: không bị bộ lọc chặn, không có lỗi transport. Chi phí ghi là `0` vì model chưa có trong bảng giá. Đây **không phải chi phí thật**.

### Run 1: nộp verdict ở pha chiều xuôi

- Chế độ mặc định: model trả lời bằng JSON trong văn bản.
- Ở pha chiều xuôi, harness cần `{reachability, explanation}`, nhưng Sonnet nộp luôn verdict cuối (`validity: "valid"`, `verificationStatus: "PASS"`).
- Bị từ chối 3 lần vì `SCHEMA_VIOLATION`, hết lượt sửa nên run thất bại. Không có nhánh "incomplete" vì chưa bị ép nộp.

### Run 2: gọi `submit_verdict` ở pha chiều ngược

- Với `--structured-output`, chiều xuôi nộp đúng qua `submit_verification` (`reachable`, lời giải thích do model viết).
- Ở chiều ngược, các bước không bị ép nộp được đưa **tất cả** công cụ, gồm cả `submit_verdict`. Sonnet chọn nộp verdict, bị từ chối 3 lần, run thất bại.

### Run 3: thành công

```
Đọc code ─▶ xuôi: reachable ─▶ ngược: reconstructed ─▶ consensus: agreed-valid ─▶ verdict VALID
```

## 4. Bản sửa

[`packages/core/src/runner/judge-step.ts`](../../../packages/core/src/runner/judge-step.ts): khi đang ở một chiều (pending), các bước không bị ép nộp chỉ đưa cho model các công cụ đọc code và `submit_verification` của đúng chiều đó. `submit_verdict` chỉ xuất hiện ở pha verdict. Diff đầy đủ ở [fix.diff](fix.diff).

Test:

- `judge-step.test.ts`: thêm 2 test. Một test kiểm pha chiều không có `submit_verdict`, một test kiểm pha verdict vẫn có.
- `judge-runner.test.ts`: cập nhật assertion cũ (vốn mong pha chiều có cả hai công cụ nộp).
- `bun run --cwd packages/core typecheck`: đạt. `bun run --cwd packages/core test`: 960 pass, 1 fail. Test fail là `End-to-End Tool Execution with DiskSourceSnapshot`, đã fail trên `974b01c` trước khi sửa.

## 5. Verdict run 3

| Trường          | Giá trị         |
| ----------------- | ----------------- |
| Validity / Status | valid / PASS      |
| Confidence        | HIGH              |
| Reason code       | EXPLOIT_CONFIRMED |

Chuỗi lập luận của model:

1. `scaledEntropyCallback` (Jackpot.sol:717-748) gọi `jackpotLPManager.processDrawingSettlement(...)`.
2. `processDrawingSettlement` (JackpotLPManager.sol:388-391) tính `newLPValue = postDrawLpValue + pendingDeposits - withdrawalsInUSDC` mà không kiểm `lpPoolCap`. Việc kiểm cap ở JackpotLPManager.sol:185 chỉ áp dụng khi nạp tiền.
3. `_setNewDrawingState` (Jackpot.sol:1494-1497) tính `newBonusball` từ giá trị đã vượt cap.
4. `_calculateLpPoolCap` (Jackpot.sol:1469-1476) là giới hạn an toàn, nhưng chỉ được gọi từ các hàm governance.
5. Khi `bonusball + normalBallMax ≥ 256`, `1 << (_bonusball + _tracker.normalMax)` ở TicketComboTracker.sol:142 lỗi, gây DoS khi mua vé.

Trích dẫn (harness đọc từ snapshot và tính digest): JackpotLPManager.sol 183-186, 185, 371-392, 388-391; Jackpot.sol 717-748, 738-748, 1469-1476, 1478-1507, 1494-1497, 1496; TicketComboTracker.sol 142.

## 6. Đối chứng: cùng cấu hình với Gemini

Run `run-1793210739148`: code `7c16a3e` (gồm bản sửa mục 4), cùng finding, snapshot, cờ `--static-verdicts --structured-output` và giới hạn. Chỉ đổi model sang `ag/gemini-3.8-flash-high`.

**Kết quả:** `completed`, verdict **UNVERIFIED / UNRESOLVED / LOW**. Verdict này **do harness tự ghép, không phải do Gemini nộp**.

| Pha | Bước | Bị bộ lọc chặn | Kết quả |
|---|---|---|---|
| Chiều xuôi | 35 | 3 lần, lần thứ 4 qua | `reachable`, lời giải thích do Gemini viết |
| Chiều ngược | 46 | 1 lần, lần thứ 2 qua | `reconstructed`, do Gemini viết |
| Consensus | — | — | `agreed-valid` |
| Verdict | 55 (bị ép nộp) | **6/6, hết lượt thử** | Gemini không nộp được verdict |

Bị chặn đều là `content_filter` / `blockReason: OTHER`. Ở `974b01c`, lỗi này được thử lại (`retry-policy.ts`).

**Vì sao vẫn có verdict:** khi bước verdict bị chặn hết lượt, `974b01c` có cơ chế `composeFromConsensus` (chỉ chạy khi bật static): harness tự ghép verdict từ hai chiều. Muốn ghép ra VALID, harness cần mức độ nghiêm trọng lấy từ báo cáo. Finding H03 đã chuẩn hoá không có trường này, nên kết quả bị hạ xuống UNVERIFIED với lý do *"the model gave no verdict and the report claims no critical, high or medium severity"*. Đây là **lỗi bị che đi**, không phải Gemini kết luận "chưa xác minh được": thực tế cả hai chiều của Gemini đều ủng hộ claim.

Trong log còn có một lỗi timeout kết nối PostgreSQL lúc chờ Gemini ở bước 55. Lỗi này không làm hỏng run, mọi sự kiện vẫn được ghi đủ.

### So sánh Sonnet và Gemini

| | Sonnet 4.6 (`run-1793209079926`) | Gemini 3.8 flash high (`run-1793210739148`) |
|---|---|---|
| Trạng thái | completed | completed |
| Verdict | **VALID / PASS / HIGH**, do model nộp | **UNVERIFIED / UNRESOLVED / LOW**, do harness ghép |
| Chiều xuôi / ngược | reachable / reconstructed | reachable / reconstructed |
| Consensus | agreed-valid | agreed-valid |
| Bị bộ lọc chặn | 0 | **10** (3 xuôi, 1 ngược, 6 verdict) |
| Lượt gọi AI | 13 | **64** |
| Token | 221.623 | **1.204.325** |
| Lần đọc code | 18 | 52 |
| Số bước | 13 | 55 |

**Nhận xét:**
- Hai model **hiểu lỗi giống nhau**: cùng consensus `agreed-valid`.
- Gemini **không qua được bộ lọc ở bước verdict**: bước này yêu cầu khẳng định khai thác được xác nhận, và bị chặn 6/6 lần. Sonnet không bị chặn lần nào.
- Gemini tốn khoảng **5,4 lần token**: đọc nhiều hơn, và mỗi lần thử lại sau khi bị chặn đều tính đủ token đầu vào.
- Với code hiện tại, kết quả UNVERIFIED của Gemini **trông như một kết luận nhưng thực ra là lỗi bị che**. Khi chấm điểm, phải kiểm tra `reasoning` của verdict: nếu có *"the model gave no verdict"* hoặc *"No result was given"* thì phải coi là lỗi.

## 7. Giới hạn của kết quả

- **Kết luận tĩnh:** luật TV4 chấp nhận VALID khi hai chiều đồng thuận `agreed-valid` và trích dẫn khớp snapshot. Chưa có PoC, Halmos hay bằng chứng thực thi.
- **BCE vẫn incomplete:** không có `--static-verdicts` thì verdict này sẽ bị hạ thành UNVERIFIED.
- **BCE thực tế không tạo slice nào trên Megapot:** `snapshot-ingestion.ts` dừng ngay khi có bất kỳ file `.sol` nào dài hơn 120 dòng (25/61 file của snapshot vượt ngưỡng). Mọi đoạn code trong các run đều do model tự đọc bằng công cụ. `bceIncomplete` được gán cứng `true` ở `run-stages.ts`.
- **Mới chạy 1 lần:** chưa đo được độ ổn định giữa các lần chạy, và chưa so với baseline X.
- **Bản sửa mới chỉ áp dụng cho structured output.** Ở chế độ mặc định (run 1) vẫn có thể nộp sai pha.
- Không có ground truth nào được đưa vào context. Finding là bản chuẩn hoá, không chứa phần mitigation hay nhãn chấm.

## 8. File đi kèm

| File                                                          | Nội dung                                          |
| ------------------------------------------------------------- | -------------------------------------------------- |
| `run1-output.txt`, `run2-output.txt`, `run3-output.txt` | Output CLI từng run Sonnet (trace từng bước)          |
| `run-gemini-output.txt` | Output CLI run Gemini |
| `run-*-view.json`                                           | `cli view --json` từ process mới cho từng run |
| `fix.diff`                                                  | Diff bản sửa `judge-step.ts`                   |
