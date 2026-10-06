# TV2 — Context & Memory: Khảo sát harness mã nguồn mở và kế hoạch thiết kế

> Track: **TV2 — Context & Memory** (2 thành viên)
> Ngày soạn: 04/10/2026
> Trạng thái: **Đề xuất**, chưa được nhóm duyệt. Mang tới buổi chốt Sprint 1.

## Mục lục

1. [Tóm tắt](#tóm-tắt)
2. [Bài toán của TV2, suy luận từ đầu](#1-bài-toán-của-tv2-suy-luận-từ-đầu)
3. [Các harness mã nguồn mở quản lý token thế nào](#2-các-harness-mã-nguồn-mở-quản-lý-token-thế-nào)
4. [Thiết kế riêng: Context Engine 6 lớp](#3-thiết-kế-riêng-context-engine-6-lớp)
5. [Kế hoạch cho hai người](#4-kế-hoạch-cho-hai-người)
6. [Câu hỏi cần chốt với nhóm](#5-câu-hỏi-cần-chốt-với-nhóm)
7. [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tóm tắt

- Không harness nào trong số được khảo sát đếm token chính xác lúc quyết định. Chúng ước lượng khoảng 4 ký tự = 1 token, rồi lấy số token thật do provider trả về sau mỗi lần gọi.
- Chúng giảm context theo thứ tự rẻ trước, đắt sau: **cắt output của tool → ẩn kết quả tool cũ → tóm tắt bằng LLM**.
- Bài báo NeurIPS 2025 *The Complexity Trap* cho thấy chỉ cần ẩn kết quả tool cũ là chi phí giảm khoảng một nửa, mà chất lượng ngang tóm tắt bằng LLM.
- Đề xuất cho nhóm:
  - Lấy cách **ẩn tất định** (deterministic) làm cơ chế giảm tải chính.
  - Kiểm tra ngân sách **trước** mỗi lần gọi model.
  - Dùng **một cửa sổ context chung** cho mọi provider.

---

## 1. Bài toán của TV2, suy luận từ đầu

Mỗi lần gọi model đều phải thoả **input + output ≤ cửa sổ W**. Agent của harness gọi nhiều lượt và lịch sử cứ dài ra, nên sinh ra ba vấn đề:

| | Vấn đề | Hệ quả nếu bỏ qua |
|---|---|---|
| **P1 — Vừa** | Lượt sau lớn hơn lượt trước, sớm muộn sẽ vượt W | Provider từ chối, run lỗi giữa chừng |
| **P2 — Đắt** | Mỗi lượt gửi lại toàn bộ lịch sử, nên tổng token tăng theo bậc hai của số bước | Chi phí mỗi run cao, harness thua nhánh gọi trực tiếp ở chỉ số cost |
| **P3 — Nhiễu** | Context càng nhiều đoạn code không liên quan, model càng dễ suy luận lệch | Có thể làm **giảm precision**, mà precision là trọng tâm của đồ án (giả thuyết cần đo) |

Ví dụ về P2: phần bắt buộc là 6k token và mỗi bước thêm 3k token.

| Số bước | Tổng token logic của run |
|---|---|
| 10 | 6·10 + 3·(10·9/2) = **195k** |
| 20 | 6·20 + 3·(20·19/2) = **690k** |

Bản thân phương pháp nghiên cứu (không phải tài liệu nào) còn đặt thêm bốn ràng buộc:

- **Đo đúng:** số token phải chính xác thì bảng chi phí mới có giá trị.
- **Tắt được:** mỗi cơ chế giảm context phải tắt riêng được để làm ablation.
- **Công bằng:** cùng một chính sách cho mọi provider; nếu không thì RQ3 đang so hai harness khác nhau.
- **Không rò rỉ:** bộ nhớ không được mang thông tin từ tập test hay từ nhãn.

Vì vậy TV2 không chỉ là "nén context". Đó là một **pipeline năm bước: Đo → Quyết định ngân sách → Giảm tải → Ghi nhớ → Ghi vết**.

---

## 2. Các harness mã nguồn mở quản lý token thế nào

Nhóm đã xem cách bốn harness mã nguồn mở xử lý chuyện context đầy: **OpenCode**, **omp (oh-my-pi)**, **pi-mono** (bản gốc mà omp phát triển tiếp) và **Codex CLI** của OpenAI.

### 2.1 Mỗi harness làm gì

**OpenCode**
- Đếm token bằng ước lượng thô: khoảng 4 ký tự là 1 token.
- Không kiểm tra trước. Gọi model xong, xem model báo đã dùng bao nhiêu token; nếu gần đầy thì nén trước lượt sau.
- Kết quả tool quá dài thì chỉ đưa cho model phần đầu, kèm lời nhắc "muốn xem tiếp thì đọc tiếp từ dòng N".
- Có tuỳ chọn (mặc định tắt) xoá nội dung các kết quả tool cũ, chỉ giữ những kết quả gần nhất.
- Khi thật sự đầy thì nhờ model viết bản tóm tắt theo mẫu cố định (mục tiêu, việc đã làm, việc đang làm, bước tiếp theo, file liên quan). Phần hội thoại gần nhất vẫn giữ nguyên văn.

**omp (oh-my-pi)**: làm kỹ nhất trong bốn harness.
- Đếm token chính xác hơn: có bộ đếm riêng cho nhiều họ model. Ngoài ra có chế độ "đếm dư", không bao giờ đếm thiếu.
- Kiểm tra cả giữa chừng, tức là trước mỗi lần gọi model trong lúc agent đang dùng tool, chứ không chỉ sau mỗi lượt.
- Khi đọc lại cùng một file, bản đọc cũ được thay bằng dòng "đã có bản mới hơn". Kết quả tìm kiếm rỗng cũng bị bỏ đi.
- Có nhiều cách nén, thử lần lượt từ rẻ đến đắt; cách đầu thất bại thì chuyển sang cách sau.
- Sau khi nén phải kiểm tra xem context đã thật sự nhỏ đi chưa, để không bị nén mãi trong vòng lặp.
- Có "sổ ghi chú" để agent tự ghi lại trạng thái làm việc.
- Có bộ nhớ dài hạn (mặc định tắt): rút bài học từ các phiên cũ. Bộ nhớ này chỉ được coi là gợi ý tham khảo, không phải chỉ thị.

**pi-mono**: bản đơn giản.
- Ước lượng 4 ký tự = 1 token. Lấy số token model báo ở lượt trước, cộng thêm phần mới phát sinh.
- Gần đầy thì tóm tắt, giữ lại khoảng 20 nghìn token gần nhất.

**Codex CLI**
- Cũng ước lượng thô.
- Chỉ dùng khoảng 90–95% cửa sổ context, chừa phần còn lại cho an toàn.
- Kết quả tool dài thì giữ đoạn đầu và đoạn cuối, cắt bỏ phần giữa.
- Gần đầy thì tóm tắt.

**Điểm chung của cả bốn:**
1. Đếm token gần đúng để quyết định, rồi lấy số thật do model báo để ghi sổ.
2. Giảm context theo thứ tự rẻ trước, đắt sau: cắt bớt kết quả tool → ẩn kết quả cũ → tóm tắt bằng model.
3. Luôn giữ nguyên văn phần hội thoại gần nhất.

### 2.2 Bằng chứng từ nghiên cứu

Bài báo **"The Complexity Trap"** (JetBrains Research và TU Munich, NeurIPS 2025) so sánh hai cách:
- **Ẩn bớt các kết quả tool cũ**: chỉ giữ vài kết quả gần nhất, phần cũ thay bằng một dòng ghi chú.
- **Nhờ model tóm tắt.**

Kết quả: cách ẩn đơn giản **giảm chi phí khoảng một nửa** mà chất lượng **ngang** cách tóm tắt. Kết hợp cả hai thì tiết kiệm thêm được một ít.

### 2.3 Rút ra cho đồ án

**Nên học:**
1. Đếm gần đúng để quyết định, ghi số thật để báo cáo. Ghi cả độ lệch giữa hai số.
2. Làm cách rẻ trước, chỉ nhờ model tóm tắt khi thật cần.
3. Giữ nguyên phần gần nhất. Không tách rời một lần gọi tool với kết quả của nó.
4. Phần bị ẩn phải lấy lại được khi cần.
5. Sau khi nén phải kiểm tra đã giảm thật chưa, tránh vòng lặp.
6. Hạn chế sửa phần đầu của context, để tận dụng cơ chế cache của provider và giảm chi phí.
7. Bộ nhớ chỉ là tham khảo, có giới hạn dung lượng.

**Không nên mang sang:**

| Cách làm | Lý do không dùng |
|---|---|
| Đợi model báo lỗi "quá dài" rồi mới nén | Tốn một lần gọi mất tiền; mỗi hãng báo lỗi một kiểu nên không công bằng |
| Tràn thì chuyển sang model có cửa sổ lớn hơn | Đồ án phải giữ nguyên một model |
| Dùng tính năng nén riêng của từng hãng | Mỗi hãng một kiểu, kết quả không đọc được, khó tái lập |
| Đổi lịch sử thành hình ảnh (omp) | Chỉ dùng được với model đọc được ảnh |
| Lưu kết quả bị cắt ra file | Judge không có quyền ghi file |

**Khác biệt có lợi cho nhóm:** các harness kia làm việc trên thư mục code *thay đổi liên tục*. Harness của nhóm chỉ đọc một **bản chụp mã nguồn không đổi**, nên phần nào bị ẩn thì agent đều đọc lại được y nguyên. Vì vậy ẩn kết quả cũ gần như không làm mất thông tin.

---

## 3. Thiết kế riêng: Context Engine 6 lớp

```
L0 Đo → L1 Ngân sách → L2 Định hình output tool → L3 Giảm tải tất định → L4 Nén LLM → L5 Ghi nhớ
                          (mọi lớp đều ghi vào L6 Telemetry)
```

| Lớp | Làm gì | Quyết định thiết kế (kèm lý do) | Flag |
|---|---|---|---|
| **L0 Đo** | Ước lượng token trước khi gọi; ghi usage thật sau khi gọi | Interface `TokenEstimator` theo họ model, có chế độ `exact` và `upperbound`. Ghi sai số ước lượng theo từng lượt để hiệu chỉnh biên an toàn. **Token logic** = tổng input + output của mọi lần gọi, kể cả lần gọi để nén | Không tắt (đây là đo lường) |
| **L1 Ngân sách** | Kiểm tra *trước mỗi lần gọi*: `input_est × margin ≤ W_exp − reserve` | **Kiểm tra chủ động, không chờ lỗi**, để không trả tiền cho một lần gọi chắc chắn hỏng. **`W_exp` là một cửa sổ chung cho mọi provider**: nếu model 1M token không bao giờ phải nén còn model 128k thì có, RQ3 thực chất đang so hai harness khác nhau. Vẫn cứu không được thì dừng `context_budget` | Không tắt (an toàn) |
| **L2 Định hình output tool** (cùng TV3) | Kết quả tool có số dòng, giới hạn N dòng / K token, marker kèm gợi ý đọc tiếp | Với code nên cắt **phần đầu và gợi ý `offset`**, vì dòng giữ liên tục, khớp với cách dẫn chứng `file:line`. Cắt giữa như Codex hợp với log hơn | `tool_output_shaping` |
| **L3 Giảm tải tất định** ⭐ | (a) read cũ bị thay bởi read mới hơn (superseded); (b) kết quả rỗng; (c) **ẩn kết quả tool cũ** ngoài cửa sổ P token gần nhất. Placeholder ghi rõ cách lấy lại, ví dụ `[ẩn: read_file Vault.sol:1–400 sha256:… — đọc lại nếu cần]` | **Cơ chế chính**: rẻ, tất định, tái lập được, có bằng chứng nghiên cứu, và không mất thông tin nhờ snapshot bất biến. Chạy theo lô khi giải phóng ≥ X token, để giữ cache | `obs_masking`, `supersede_reads`, `drop_empty` |
| **L4 Nén LLM** | Chỉ chạy khi L3 không đủ, chủ yếu cho Audit | Template riêng cho audit: *Mục tiêu / Đã xét (file:dòng) / Nghi vấn đang mở / Đã loại trừ và lý do / Bằng chứng / Bước tiếp*. **Dùng cùng model của run**, tính vào ngân sách, ghi là một provider attempt. Có kiểm tra tiến triển (≤ 80% ngưỡng) và tối đa N lần | `llm_compaction` |
| **L5 Ghi nhớ** | Session note: sổ có cấu trúc (danh sách nghi vấn, file đã xem), giới hạn 2–4k token, luôn được giữ lại dù có ẩn hay nén. Long-term memory: **phân vùng theo split**. Chỉ run train được ghi; run val/test chỉ đọc một snapshot memory đã khoá (ghi digest vào run). Nội dung là *bài học quy trình*, không phải dữ kiện của contest cụ thể | Session note phục vụ độ phủ khi Audit. Memory học từ *nhãn* train là chuyện lớn: cả nhóm phải quyết trước khi làm | `session_note`, `long_term_memory` |
| **L6 Telemetry** | Mỗi lượt ghi: ước lượng theo bucket, usage thật, sai số, các phép giảm đã áp dụng (loại, số mục, token tiết kiệm), trạng thái ngưỡng, quyết định | Đây là nguyên liệu cho bảng ablation và cho Trace View | — |

### 3.1 Thứ tự sắp xếp trong context

Tối ưu cho prompt cache và hạn chế hiện tượng *lost-in-the-middle*:

1. System prompt, tool definitions, verdict schema (cố định)
2. CandidateFinding
3. Memory snapshot
4. Bản tóm tắt (nếu đã nén)
5. Lịch sử chỉ nối thêm (phần bị ẩn giữ nguyên vị trí)
6. Session note bản mới nhất
7. Kết quả tool mới

### 3.2 Đơn vị của ngân sách (cần chốt cùng TV5)

Cùng một đoạn văn bản nhưng mỗi tokenizer đếm ra một số khác nhau. Đề xuất:

- **Ngưỡng chính sách** (khi nào ẩn, khi nào nén) tính bằng một đơn vị trung lập, ví dụ `o200k` hoặc bytes/4. Như vậy harness hành xử giống nhau trên mọi provider.
- **Kiểm tra giới hạn cứng** dùng `upperbound` theo đúng tokenizer của từng provider.
- **Báo cáo** cả hai con số.

### 3.3 Câu hỏi nghiên cứu con của TV2

Chạy năm chiến lược:

| Mã | Chiến lược |
|---|---|
| S0 | Không quản lý (đầy thì dừng) |
| S1 | Chỉ L2 |
| S2 | L2 + L3 |
| S3 | L2 + L4 |
| S4 | L2 + L3 + L4 |

Đo cho từng chiến lược: precision, recall, token, chi phí. Ba giả thuyết:

- **H1:** cách ẩn kết quả cũ cho kết quả ngang tóm tắt LLM với chi phí thấp hơn, tức lặp lại kết quả của *The Complexity Trap* trong miền smart contract.
- **H2:** session note giúp tăng recall khi Audit.
- **H3:** context nhiễu làm giảm precision.

Bảng này đủ làm một chương riêng trong báo cáo và là bằng chứng rõ ràng cho đóng góp của TV2.

---

## 4. Kế hoạch cho hai người

**Phân vai:**

- **Người A — Đo, Ngân sách, Nén:** L0, L1, L4, L6.
- **Người B — Giảm tải, Ghi nhớ, Thí nghiệm:** L2, L3, L5, cùng các script đo lường.

| Giai đoạn | Người A | Người B | Đầu ra kiểm chứng được |
|---|---|---|---|
| **0. Đo nền** (2 tuần, làm được ngay, không phụ thuộc track khác) | **Benchmark estimator trên Solidity**: so `chars/4`, `o200k` và API đếm token của 2–3 provider (chỉ chạy offline một lần) trên khoảng 50 file `.sol`, ra phân phối sai số và chọn biên an toàn | **Đo áp lực context**: số token của từng file và từng repo trên 10–20 repo contest, so với cửa sổ 128k. Từ đó biết Judge có thật sự cần L3/L4 hay không | Hai bảng số liệu và một bản thiết kế 2–3 trang mang tới buổi chốt Sprint 1 |
| **1. Lõi** (≈4 tuần) | `TokenEstimator`, preflight L1, ghi token logic (cùng TV1), telemetry (cùng TV6) | L2 cùng TV3; bộ fixture file lớn | Run giả lập có telemetry; ca tràn dừng `context_budget` mà không gọi model |
| **2. Giảm tải tất định** (≈4 tuần) | Hỗ trợ tích hợp; test bật/tắt | L3: supersede, kết quả rỗng, ẩn kết quả cũ; giữ cache | Ablation S0, S1, S2 trên Judge |
| **3. Ghi chú và nén** (≈6 tuần, gắn với Audit) | L4 với template audit, kiểm tra tiến triển | Session note có cấu trúc | S3, S4 và H2 trên Audit |
| **4. Memory và đa provider** (≈6 tuần) | Áp `W_exp` chung, chi phí context theo từng model | Long-term memory phân vùng theo split, kèm test chứng minh không rò rỉ | Bảng đa provider; test chống rò rỉ memory |
| **5. Chốt** | Thí nghiệm chính thức, freeze, viết chương | Như A | Chương "Quản lý ngữ cảnh" trong báo cáo |

### 4.1 Ranh giới với các track khác

| Track | TV2 cung cấp | TV2 cần nhận |
|---|---|---|
| TV1 | Hàm preflight trước mỗi lần gọi model; số token logic | Thời điểm gọi preflight trong agent loop; thứ tự ưu tiên các điều kiện dừng |
| TV3 | Format marker khi cắt output | Giới hạn cứng của tool; `read_file` hỗ trợ offset; token của tool description |
| TV4 | Bước cắt chạy sau bước redact | Rule redaction có version |
| TV5 | Estimator có version; flag và telemetry; số token tiết kiệm | Manifest split (cho memory); thống nhất đơn vị ngân sách |
| TV6 | Field telemetry về context và các phép giảm tải | Hiển thị phân bổ context trong Trace View |

### 4.2 Rủi ro lớn nhất

Judge run ngắn, có thể không bao giờ chạm ngưỡng, khi đó ablation ra ≈ 0. Giai đoạn 0 tồn tại chính là để biết điều này **ngay từ tuần 2**, không phải đợi tới tháng 3. Nếu áp lực thấp, chuyển trọng tâm thí nghiệm của TV2 sang Audit và sang chỉ số *chi phí*.

---

## 5. Câu hỏi cần chốt với nhóm

1. Cửa sổ thí nghiệm chung `W_exp` là bao nhiêu (ví dụ 128k)? Áp cho mọi provider kể cả model có cửa sổ lớn hơn?
2. Ngưỡng chính sách tính theo đơn vị trung lập (`o200k` / bytes/4) hay theo tokenizer riêng của từng provider?
3. Phần dự trữ cho output của verdict là bao nhiêu token?
4. Khi đã giảm tải hết mà vẫn tràn: dừng `context_budget` (đề xuất) hay cho phép bỏ bớt lịch sử?
5. Cắt output tool thuộc tool (TV3) hay thuộc Context Engine (TV2)? Đề xuất: tool có giới hạn cứng, Context Engine áp chính sách có flag.
6. Long-term memory có được học từ nhãn của tập train không? Nếu có thì cần quyết định riêng về ranh giới với scorer.
7. Session note có nằm trong bản Judge đầu tiên không? Đề xuất để sau, khi đã có số liệu áp lực context ở giai đoạn 0.

---

## Tài liệu tham khảo

**Mã nguồn**

- [sst/opencode](https://github.com/sst/opencode) — commit `907b3bc`
- [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) — commit `2c78d7b` ([README](https://cdn.jsdelivr.net/gh/can1357/oh-my-pi@main/README.md), [Better Stack guide](https://betterstack.com/community/guides/ai/oh-my-pi-ai-coding-agent/))
- [badlogic/pi-mono](https://github.com/badlogic/pi-mono) — commit `2003871`
- [openai/codex](https://github.com/openai/codex) — commit `afb436d`

**Nghiên cứu và tài liệu**

- Lindenbauer et al., *The Complexity Trap: Simple Observation Masking Is as Efficient as LLM Summarization for Agent Context Management*, NeurIPS 2025 — [arXiv 2508.21433](https://arxiv.org/abs/2508.21433), [NeurIPS](https://neurips.cc/virtual/2025/131688)
- OpenHands — [Context condenser guide](https://docs.openhands.dev/sdk/guides/context-condenser), [Condenser architecture](https://docs.openhands.dev/sdk/arch/condenser)
