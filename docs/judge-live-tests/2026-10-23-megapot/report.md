# Báo cáo test Judge Pipeline — Megapot (2026-10-23)

## Cập nhật sau đợt sửa 2 (A1 do thành viên khác sửa, không đụng tới)

| Lỗi | Sửa | Test |
|---|---|---|
| A2 ingestion stub `Vault/withdraw` | CLI dùng `SnapshotIngestion`; bộ chuyển đổi `normalizeFinding` (core `ingestion/finding-normalizer.ts`, prompt `finding-normalizer.v1`) gọi provider 1 lần (+1 repair) khi finding khác template `Target/Root cause/Attack scenario/Impact/State`. JSON finding (Hound, verification-data) chỉ giữ trường claim; `status`, `confidence`, id, tên model bị loại (R2). Cờ `--no-normalize`; kết quả ghi vào `run.started.snapshot.findingNormalization` (R1). | `finding-normalizer.test.ts` |
| PoC rác từ ingestion | Regex lấy PoC ghép sai dấu đóng/mở fence → văn xuôi thành `submitter_poc`, chính nó làm Gemini trả `malformed_function_call`. Sửa: ghép fence theo cặp. | `snapshot-ingestion.test.ts` |
| A3 header "tier 2 … at most 0 runs" | Không có PoC → `tier: none`. | `adjudication-step.test.ts` |
| B1 envelope arguments | (đợt 1) | |
| B2 `malformed_function_call` | Gateway phân loại `malformed_tool_call` (không retry y nguyên); JudgeStep thêm lượt repair (dùng chung budget schema repair). Response rỗng (không choice, không usage) → retry. | `gateway-options`, `judge-step` |
| B3 quota trong 503 | `[429]/usage limit` trong 5xx → `rate_limit`, `reset after Xm Ys` → `retryAfterMs`; nếu reset sau deadline → dừng ngay sau 1 attempt. | `real-model-gateway`, `retry-policy` |
| B4 `model_attempts` trống | `EventSink.onAppended` + JudgeRunner ghi 1 dòng cho mỗi `provider.attempted`. | `judge-runner.test.ts` |
| B5 `cli:view` | Judge run không verdict vẫn hiện event + terminal. | `cli-view.test.ts` |
| C1/C2 xung đột prompt & step | Step bị ép bắt đầu sớm theo số câu trả lời còn nợ (forward, backward, verdict); prompt ép đòi đúng JSON của pha đang chờ. | `judge-step.test.ts` |
| C3 tool description lặp | Không gửi `tool_description` dạng system khi đã gửi `tools`. | `gateway-options` |

### Run sau sửa: `run-1792752140850` (`ag/gemini-3.8-flash-high`, `--timeout 600000`)

- Finding: **normalized** → claim `JackpotLPManager.processDrawingSettlement` (đúng sink của H-03).
- Tool calling: 7 lời gọi hợp lệ (glob, grep ×2, read_file ×4 gồm `processDrawingSettlement`); 1 `malformed_function_call` ở step 2 → repair → step 3 gọi tool đúng.
- **Forward: `reachable`. Backward: `reconstructed`. Consensus: `agreed-valid`** — khớp ground truth H-03 (valid/High).
- Verdict cuối: không có — step 10 nhận 6 response rỗng liên tiếp (17–144 s) từ Antigravity → hết wall-clock. Dù có verdict, A1 hiện vẫn ép thành `UNVERIFIED`.
- `model_attempts` có đủ dòng cho từng attempt.

### Hành vi provider Antigravity qua 9router (không sửa được phía harness)

| Model | Tool call nhiều step | Câu trả lời dài khi tools tắt |
|---|---|---|
| `ag/gemini-3.8-flash-high` | tốt (repair xử lý lỗi lẻ) | ~50–100% response rỗng, càng dài càng hay rỗng |
| `ag/gemini-3.8-flash` / `-medium` | `malformed_function_call` | hay rỗng |
| `ag/gemini-3.8-flash-low` | `malformed_function_call` lặp lại | trả nhanh (~10 s) nhưng sai schema verdict |
| `ag/gemini-4-argon-high`, `ag/gemini-3.1-pro-high`, `ag/gemini-pro-agent` | 404 | 404 |

Gợi ý: gateway gọi non-streaming; response rỗng nhiều khả năng do upstream cắt request dài không stream → cân nhắc hỗ trợ streaming trong `RealModelGateway`, hoặc dùng provider khác cho đánh giá.

---

# Báo cáo đợt 1

## Thiết lập

| Mục | Giá trị |
|---|---|
| Snapshot | `snap_c23510d25db6` (Megapot; không có ID `sprint78-megapot`) |
| Finding | [`finding-lp-pool-cap.md`](finding-lp-pool-cap.md) — LP pool cap không được áp khi settle drawing (tương ứng H-03, ground truth **valid / High**) |
| Lệnh | `bun run cli:run -- --snapshot snap_c23510d25db6 --finding <file> --timeout 180000 [--model ...]` |
| DB | Postgres tạm `harness-postgres-5433` (volume của `harness-postgres`, cổng 5432 bị `techstore_postgres` chiếm) |

## Các lần chạy

| Run ID | Model | Kết quả | Nguyên nhân |
|---|---|---|---|
| `run-1792743527014` | `cx/gpt-6-luna` | `failed / provider_retries_exhausted` | Codex hết quota (`429` bị 9router gói thành `503`), retry 5 lần vô ích |
| `run-1792745431829` | `cx/gpt-6-luna` | `failed / provider_retries_exhausted` | Như trên, quota chưa hồi |
| `run-1792745184127` | `ag/gemini-3.8-flash-high` | `failed / provider_permanent` ở step 2 | `finish_reason: malformed_function_call` — **bug converter** (mục B1) |
| `run-1792745499250` | `ag/gemini-3.8-flash-high` (sau khi sửa B1) | `budget_exhausted / max_steps` | Hết 10 step trước khi có forward/backward/verdict |

## 1. Tool calling (run `run-1792745499250`)

9 lời gọi tool, **0 lỗi argument**, đúng file:

| Step | Tool | Arguments | Nhận xét |
|---|---|---|---|
| 1 | `glob` | `**/*` | Thừa: liệt kê toàn bộ snapshot, bị truncate |
| 2 | `grep` | `_calculateLpPoolCap` | Đúng hàm trong finding |
| 3 | `read_file` | `Jackpot.sol` 1460–1510 | Đúng `_calculateLpPoolCap` + `_setNewDrawingState` |
| 4 | `read_file` | `Jackpot.sol` 1505–1540 | Đọc tiếp `bonusballMax` |
| 5 | `grep` | `MAX_BIT_VECTOR_SIZE` | Đúng hằng số then chốt |
| 6 | `read_file` | `Jackpot.sol` 180–210 | Khai báo hằng |
| 7–8 | `read_file` | `TicketComboTracker.sol` 1–200 | Đúng sink overflow |
| 9 | `read_file` | `TicketComboTracker.sol` 200–240 | Bị chặn: tools disabled do chạm step limit |

Thiếu sót: model **không đọc `JackpotLPManager.processDrawingSettlement`** — sink chính của claim — mà tin vào narrative của finding.

## 2. Forward / Backward và verdict

- **Forward:** không có kết quả. Model không bao giờ trả JSON `{"reachability", "explanation"}`.
- **Backward:** không chạy tới.
- **Verdict cuối:** không có (`budget_exhausted`). Ở step 10 model trả về:
  `{"verdict":"valid","severity":"High","reasoning":"..."}` ([step10-model-output.txt](step10-model-output.txt)) — **đúng về nội dung** so với H-03 (kể cả Panic `0x11` trong `TicketComboTracker`), nhưng sai schema → `verdict.validation_failed`, sau đó pipeline chèn lại prompt forward thì đã hết step.

## 3. Điểm nghẽn / lỗi phát hiện

### A. Lỗi khiến pipeline **không thể** ra kết quả đúng với verification data

| # | Vị trí | Vấn đề |
|---|---|---|
| A1 | `packages/core/src/runner/run-stages.ts` (mọi nhánh `passed`) + `judge-step.ts:450` | `bceIncomplete` luôn `true` → mọi verdict khác `unverified` bị ép thành `UNVERIFIED/UNRESOLVED`. **Recall trên finding valid = 0 theo cấu trúc.** |
| A2 | `packages/cli/src/index.ts` (ingestion stub) | Claim decomposition hard-code `targetContracts: ["Vault"]`, `targetFunctions: ["withdraw"]`, rootCause/impact là placeholder — được pin vào context của mọi finding. |
| A3 | `prompts/judge-system.v1.txt` | Prompt thiết kế cho PoC ("missing PoC makes the finding invalid", Tier 1/2), trong khi CLI chạy narrative-only, `maxProbeRuns: 0`, `enablePocExecution: false` → header ghi "at most 0 runs". Thiên lệch về invalid/unverified. |

### B. Lỗi kỹ thuật (gateway / runner)

| # | Vị trí | Vấn đề | Trạng thái |
|---|---|---|---|
| B1 | `packages/llm/src/gateway/message-converter.ts` | Judge lưu `tool_request` dạng `{"name","arguments"}`, converter gửi lại nguyên envelope làm `function.arguments`. Gemini: `malformed_function_call` 3/3; sau khi bóc envelope: gọi tool hợp lệ 3/3. | **Đã sửa** + test |
| B2 | `packages/llm/src/gateway/response-mapping.ts` | `finish_reason` lạ (`malformed_function_call`) → `invalid_request` vĩnh viễn, run chết ngay; nên cho repair/retry 1 lần. | Chưa sửa |
| B3 | Phân loại lỗi provider | 9router trả `503` chứa `[429] usage limit ... reset after 29m` → `transport`, retry 5 lần (~40s) vô ích. | Chưa sửa |
| B4 | `JudgeRunner` | Không gọi `recordModelAttempt` → bảng `model_attempts` **0 dòng** cho cả 4 run (vi phạm yêu cầu ghi chi phí từng attempt). | Chưa sửa |
| B5 | `cli:view` | Với Judge run chỉ in telemetry, không in event/verdict; phải query `events` trực tiếp. | Chưa sửa |
| B6 | CLI Judge dùng `PassThroughContextEngine` | Không có compaction/token accounting thật dù flags bật (`enableLlmCompaction: true` chỉ là ghi nhận). | Chưa sửa |

### C. Prompt / context / latency / token

| # | Quan sát | Số liệu |
|---|---|---|
| C1 | Hai yêu cầu output xung đột: forward prompt đòi `{"reachability"}`, judge-system đòi verdict JSON, max-steps forcing đòi "final JSON verdict". Model chọn sai cả hai. | step 10 |
| C2 | `maxSteps: 10` dùng chung cho khám phá + forward + backward + verdict + repair; không có step dự trữ cho 3 lượt trả lời bắt buộc. | 8 step khám phá, 0 còn lại |
| C3 | Tool description gửi 2 lần: vừa là `system` message, vừa trong `tools`. 6 `system` message liên tiếp đầu hội thoại. | ~4 message thừa |
| C4 | `glob **/*` ở step 1 tốn context, bị truncate. | step 1 |
| C5 | Token & latency | Tổng prompt ≈ 58,7k, completion 617; model latency ≈ 83s/87,6s tổng; step 10 nhảy 6,9k → 12,0k prompt tokens và 41s (chưa rõ nguồn 5k tăng thêm, cần điều tra) |
| C6 | Chi phí ghi nhận ≈ $0,0092 — tính theo bảng giá cấu hình, không phải giá thật của Antigravity. | |

## 4. Đề xuất để Judge cho kết quả khớp verification data

Ưu tiên theo tác động:

1. **Gỡ khóa A1:** chỉ đặt `bceIncomplete` khi ingestion thật sự trả `bceStatus: "incomplete"`; hoặc cho phép verdict `valid` khi forward=`reachable`, backward=`reconstructed` và citations đều resolve trong snapshot. Nếu không, mọi so sánh với `finding/valid/*` đều cho recall 0.
2. **Thay ingestion stub (A2)** bằng claim extraction thật từ finding (contract/function trong header, root cause, impact) — tối thiểu là parse `**Contracts:**` / `**Functions:**`, hoặc một lượt LLM có schema.
3. **Tách pha rõ ràng (C1, C2):** (a) khám phá có budget riêng (vd. 8 step), (b) forward 1 lượt, (c) backward 1 lượt, (d) verdict 1 lượt + 1 repair — mỗi pha một prompt duy nhất, không chồng yêu cầu output. Max-steps forcing phải biết pha hiện tại (đòi forward JSON nếu đang ở forward).
4. **Prompt narrative-only (A3):** thêm biến thể `judge-system` cho finding không có PoC: tiêu chí valid = path reachable + impact reconstructable + citations, thay vì "missing PoC ⇒ invalid".
5. **Backward phải buộc đọc sink:** yêu cầu cite dòng của hàm sink (ở đây `processDrawingSettlement`) trước khi kết luận `reconstructed`.
6. **Gateway (B2, B3):** coi `malformed_function_call` là lỗi model có thể repair (gửi lại với nhắc schema tool); nhận diện `usage limit`/`429` trong thân `503` là `rate_limit` có `retryAfter` và dừng sớm khi reset > timeout.
7. **Quan sát (B4, B5):** ghi `model_attempts` cho Judge; `cli:view` in event và verdict của Judge run — cần cho đo cost/variance RQ1.
8. **Context (C3, C4, B6):** bỏ tool description khỏi `system` khi đã gửi `tools`; gộp các system prompt; dùng `ProductionContextEngine` cho Judge; gợi ý trong prompt dùng `grep` thay vì `glob **`.
9. **Đánh giá:** sau khi sửa 1–3, chạy lại 11 finding valid của Megapot (H01–H03, M01–M08) × ≥3 lần mỗi finding để đo recall và variance; bổ sung finding invalid để đo precision.
