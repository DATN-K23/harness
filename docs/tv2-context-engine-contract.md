# Context Engine — Engine nhận gì, trả gì, được gọi khi nào

> Track: **TV2 — Context & Memory** (phần Đo & Ngân sách)
> Trạng thái: **Bản nháp để bàn bạc** với bạn cùng track và TV1 (agent loop).
> Liên quan: `docs/tv2-context-research-and-plan.md` (thiết kế 6 lớp).

---

## 1. Engine là gì, nói ngắn gọn

Mỗi lần agent sắp gọi model, **Context Engine kiểm tra xem những gì sắp gửi có vừa không**. Nếu sắp đầy thì engine **dọn bớt**. Dọn hết cách mà vẫn không vừa thì engine **bảo dừng**.

Hình dung engine như **người kiểm tra hành lý trước khi lên máy bay**: xem trong vali có gì, nặng bao nhiêu, món nào bỏ bớt được, rồi quyết định "cho lên", "phải bỏ bớt", hay "không đi được".

---

## 2. Năm nguyên tắc

1. **Engine không tự gọi model.** Mọi lần gọi model đều do agent loop (TV1) làm, kể cả lần nhờ model tóm tắt. Như vậy chỉ có một nơi giữ việc gọi model và ghi lại chi phí.
2. **Engine không tự nhớ gì.** Mỗi lần được gọi, agent loop đưa đủ dữ liệu cho engine. Engine không giữ trạng thái giữa các lượt.
3. **Engine không sửa lịch sử gốc.** Lịch sử đầy đủ vẫn nằm nguyên trong database. Engine chỉ quyết định **bản gửi đi lần này** trông như thế nào (đã cắt, đã ẩn gì), kèm danh sách những gì đã dọn để ghi lại.
4. **Cùng dữ liệu vào thì luôn ra cùng kết quả.** Không ngẫu nhiên, không phụ thuộc giờ giấc, nên làm lại thí nghiệm sẽ ra đúng như cũ.
5. **Đếm token bằng o200k** (đã chốt). Mọi model dùng chung một thước đo.

---

## 3. Engine có ba việc

| Việc | Khi nào | Làm gì |
|---|---|---|
| **Chuẩn bị** (`prepare`) | Trước **mỗi** lần gọi model | Đo, dọn nếu cần, rồi trả lời: *gửi được*, *cần tóm tắt trước*, hay *dừng* |
| **Ghi sổ** (`record`) | Sau **mỗi** lần model trả lời | Nhận số token thật mà provider báo, cộng vào tổng đã dùng, ghi lại o200k lệch bao nhiêu so với số thật |
| **Cắt kết quả tool** (`shapeToolResult`) | Mỗi khi tool chạy xong, trước khi đưa kết quả vào lịch sử | Kết quả quá dài thì chỉ giữ một đoạn, kèm lời nhắc "muốn xem tiếp thì đọc từ dòng N" |

---

## 4. Được gọi khi nào trong một run

```
Bắt đầu run
   │
   ▼
① Agent loop gom các mục sẽ gửi cho model
   │
   ▼
② Engine "chuẩn bị"
   ├─ Gửi được       → ③
   ├─ Cần tóm tắt    → agent loop nhờ model tóm tắt phần cũ,
   │                   thay phần cũ bằng bản tóm tắt, quay lại ①
   └─ Dừng           → kết thúc run, ghi lý do
   │
   ▼
③ Agent loop gửi cho model đúng những gì engine trả về
   │
   ▼
④ Engine "ghi sổ" số token thật
   │
   ▼
⑤ Model muốn gọi tool?
   ├─ Có    → tool chạy → TV4 lọc thông tin nhạy cảm
   │          → engine "cắt kết quả tool" → thêm vào lịch sử → quay lại ①
   └─ Không → model đã đưa ra kết quả → kết thúc run
```

Ba điểm cần nhớ:

- Lần nhờ model **tóm tắt** cũng là một lần gọi model, nên cũng phải qua "chuẩn bị" và "ghi sổ". Lần đó cũng tốn token.
- Kết quả tool được **TV4 lọc trước, TV2 cắt sau**. Nếu cắt trước, có thể cắt mất đúng dòng chứa mật khẩu mà bộ lọc cần thấy.
- Agent loop gửi cho model **đúng bản engine trả về**, không tự sửa thêm.

---

## 5. Engine nhận gì

Mỗi lần "chuẩn bị", agent loop đưa cho engine **bốn thứ**. Theo hình ảnh kiểm tra hành lý:

| Thứ | Câu hỏi nó trả lời | Ví von |
|---|---|---|
| **Danh sách các mục** | Đang mang theo những gì? | Từng món đồ trong vali |
| **Chính sách** | Luật chung là gì? | Quy định hành lý |
| **Thông tin model** | Model này chứa được bao nhiêu? | Giới hạn của loại máy bay |
| **Ngân sách của run** | Đã tiêu bao nhiêu, còn bao nhiêu? | Tiền cước cả chuyến |

### 5.1 Danh sách các mục: agent loop gửi **theo từng mục**

Agent loop **không ghép mọi thứ thành một khối văn bản**, mà gửi **danh sách từng mảnh**. Lịch sử của agent vốn đã gồm từng mảnh riêng (mỗi câu trả lời của model là một mảnh, mỗi kết quả tool là một mảnh, mỗi mảnh đều được lưu thành event trong database), nên ranh giới giữa các mục có sẵn từ đầu. Nếu ghép thành một khối rồi bắt engine chia lại, engine sẽ phải đoán ranh giới, vừa khó vừa dễ sai.

Các loại mục:

| Loại | Ví dụ | Ai tạo |
|---|---|---|
| Hướng dẫn | System prompt | TV1 |
| Mô tả tool | Mô tả `read_file`, `grep`… | TV3 |
| **Mục được ghim** | Finding cần chấm (Judge), danh sách lỗi đã tìm (Audit) | Judge/Audit workflow |
| Câu trả lời của model | "Tôi sẽ đọc Vault.sol" | Model, agent loop lưu lại |
| Kết quả tool | Nội dung Vault.sol dòng 1–400 | Tool, agent loop lưu lại |
| Bản tóm tắt | Tóm tắt phần lịch sử cũ | Model, khi engine yêu cầu |
| Bộ nhớ, sổ ghi chú | (làm sau) | — |

Mỗi mục kèm vài thông tin để engine biết cách xử lý:

- **Thuộc lượt nào:** để biết mục nào cũ, mục nào mới. Mục cũ được ẩn trước.
- **Có ghim không:** mục ghim **không bao giờ** bị ẩn hay tóm tắt.
- **Đến từ tool nào, đọc file nào, dòng nào** (với kết quả tool): nhờ đó engine nhận ra hai lần đọc trùng nhau, và viết được ghi chú "đã ẩn Vault.sol dòng 1–400, đọc lại nếu cần".
- **Gắn với lời gọi tool nào:** để không bao giờ tách rời một lần gọi tool với kết quả của nó.
- **Có rỗng không:** ví dụ tìm kiếm không ra gì thì bỏ được ngay.

Lưu ý: agent loop **không soạn sẵn file cần đọc**. Model tự quyết đọc file nào bằng cách gọi tool. Mỗi lần tool trả kết quả thì danh sách có thêm một mục mới.

### 5.2 Chính sách: luật chung, giống nhau cho mọi model, cố định suốt run

- Cửa sổ chung bao nhiêu token.
- Chừa bao nhiêu chỗ cho câu trả lời của model.
- Đến mức nào thì bắt đầu dọn.
- Giữ nguyên bao nhiêu phần lịch sử gần nhất.
- Kết quả tool dài quá bao nhiêu thì cắt.
- Được tóm tắt tối đa mấy lần trong một run.
- **Công tắc bật/tắt từng cách dọn** (cắt, bỏ bản đọc trùng, bỏ kết quả rỗng, ẩn, tóm tắt). Đây là chỗ để làm ablation.
- **Số phiên bản** của chính sách, ghi vào run để tái lập.

Giá trị cụ thể sẽ chốt sau khi có đủ số liệu đo nền.

### 5.3 Thông tin model: khác nhau theo model, chỉ dùng để kiểm tra an toàn

- Giới hạn context thật của model.
- Giới hạn output thật của model.
- **Hệ số an toàn.** o200k đếm hơi khác tokenizer thật của Claude hay Gemini, nên engine nhân thêm hệ số này cho chắc. Hệ số được hiệu chỉnh dần từ số liệu "ghi sổ".

Phần này **không dùng để quyết định khi nào dọn**. Quyết định dọn luôn theo luật chung, nên mọi model được đối xử như nhau.

### 5.4 Ngân sách của run: sổ tiền của cả chuyến

- Đã dùng bao nhiêu token tính tới giờ (input + output của **mọi** lần gọi, kể cả lần tóm tắt).
- Tổng được phép bao nhiêu.
- Đã tóm tắt mấy lần.

---

## 6. Engine trả gì

### 6.1 "Chuẩn bị" trả về một trong ba câu trả lời

| Câu trả lời | Nghĩa là | Kèm theo |
|---|---|---|
| **Gửi được** | Context vừa, cứ gửi | Danh sách mục sẽ gửi (đã dọn nếu cần) và danh sách những gì đã dọn |
| **Cần tóm tắt trước** | Dọn kiểu rẻ chưa đủ, cần nhờ model tóm tắt phần cũ | Những mục nào cần tóm tắt, và yêu cầu tóm tắt đã soạn sẵn |
| **Dừng** | Không thể tiếp tục | Lý do: **hết chỗ trong cửa sổ** (`context_budget`) hoặc **hết tổng ngân sách của run** (`total_tokens`), kèm giải thích ngắn |

Khi nhận "cần tóm tắt", agent loop gọi model để tóm tắt, thay các mục cũ bằng bản tóm tắt, rồi hỏi engine lại từ đầu.

### 6.2 Mỗi lần dọn được ghi lại

Mỗi việc dọn đều ghi rõ: **làm gì** (cắt / bỏ bản đọc trùng / bỏ kết quả rỗng / ẩn / tóm tắt), **đụng tới mục nào**, **trước và sau bao nhiêu token**, và **dòng ghi chú thay thế**, ví dụ:

> `[đã ẩn: read_file Vault.sol dòng 1–400 — đọc lại nếu cần]`

Agent loop lưu các việc này thành event. Nhờ vậy, sau này luôn dựng lại được **chính xác model đã thấy gì** ở mỗi lượt.

### 6.3 Mỗi lần "chuẩn bị" đều kèm một báo cáo số liệu

Phục vụ **Trace View** (TV6) và **bảng ablation** (TV5):

- Đếm bằng gì (luôn là o200k), chính sách phiên bản nào.
- Mỗi loại mục chiếm bao nhiêu token, trước và sau khi dọn.
- Ngưỡng dọn, cửa sổ, phần chừa cho câu trả lời.
- Ước lượng theo model này (o200k × hệ số an toàn) so với giới hạn thật của model.
- Đã dọn những gì, tiết kiệm được bao nhiêu token.
- Ngân sách run còn lại.
- Mã băm của bản gửi đi, để kiểm tra tái lập.

### 6.4 "Ghi sổ" trả gì

Tổng ngân sách sau khi cộng, o200k lệch bao nhiêu so với số thật ở lần gọi này, và gợi ý hệ số an toàn mới cho model.

### 6.5 "Cắt kết quả tool" trả gì

Nội dung sau khi cắt, có bị cắt hay không, trước và sau bao nhiêu token, kèm lời nhắc "đọc tiếp".

Cắt **theo token, không chỉ theo số dòng**. Benchmark cho thấy có file chỉ 206 dòng nhưng nặng khoảng 74 nghìn token, vì chứa bytecode.

---

## 7. Bên trong "chuẩn bị", engine làm theo thứ tự nào

1. **Đếm** token từng mục bằng o200k. Mục nào không đổi thì dùng lại số đã đếm.
2. **Phần bắt buộc** (hướng dẫn, mô tả tool, mục ghim) đã quá lớn? → **Dừng** (hết chỗ).
3. **Gọi tiếp sẽ vượt tổng ngân sách run?** → **Dừng** (hết ngân sách).
4. **Còn dưới ngưỡng dọn?** → **Gửi được**, không dọn gì.
5. **Dọn kiểu rẻ**, theo thứ tự: bỏ bản đọc trùng → bỏ kết quả rỗng → ẩn kết quả cũ (giữ nguyên phần gần nhất). Rồi đếm lại.
6. **Đã xuống dưới ngưỡng?** → **Gửi được**, kèm danh sách đã dọn.
7. **Vẫn trên ngưỡng:**
   - Còn được tóm tắt → **Cần tóm tắt trước**.
   - Không tóm tắt được nhưng vẫn vừa cửa sổ → **Gửi được**.
   - Không tóm tắt được và không vừa cửa sổ → **Dừng** (hết chỗ).
8. **Kiểm tra an toàn cuối** theo model: ước lượng theo model cộng phần chừa cho câu trả lời có vượt giới hạn thật của model không? Vượt → **Dừng** (hết chỗ).

Phân công: bước 5 (dọn) do **người phụ trách phần dọn dẹp** làm; phần Đo & Ngân sách lo các bước còn lại và để sẵn chỗ cắm bước 5.

---

## 8. Ví dụ một Judge run

| Lượt | Chuyện gì xảy ra | Engine trả lời |
|---|---|---|
| 1 | Chỉ có hướng dẫn, mô tả tool, finding (ghim). Rất nhẹ | **Gửi được** |
| — | Model gọi `read_file` Vault.sol. File quá dài, engine cắt còn 400 dòng đầu kèm lời nhắc "đọc tiếp" | (cắt kết quả tool) |
| 2–7 | Model đọc thêm vài file, tìm vài hàm. Context lớn dần nhưng vẫn dưới ngưỡng | **Gửi được** |
| 8 | Vượt ngưỡng dọn. Engine bỏ một bản đọc trùng, ẩn các kết quả đọc cũ. Xuống dưới ngưỡng | **Gửi được**, kèm danh sách đã dọn |
| 9 | Model đưa ra verdict | — (kết thúc run) |

Với Audit chạy dài hơn nhiều, tới lúc ẩn rồi vẫn quá ngưỡng thì engine trả **Cần tóm tắt trước**. Mục ghim (danh sách lỗi đã tìm) không bị đụng tới.

---

## 9. Cần thống nhất

**Với bạn cùng track (phần dọn dẹp):**

1. Chỗ cắm bước 5: phần dọn nhận danh sách mục, chính sách và mức token cần đạt; trả về danh sách mục sau khi dọn cùng các việc đã làm. Có ổn không?
2. Dòng ghi chú thay thế khi ẩn và lời nhắc "đọc tiếp" viết thế nào cho model dễ hiểu.
3. "Cắt kết quả tool" nằm trong engine hay trong tool của TV3?

**Với TV1 (agent loop):**

4. Ai quyết định dừng khi hết **tổng ngân sách của run**: engine hay agent loop? Đề xuất: engine, vì engine là nơi đếm.
5. Agent loop lưu lịch sử **theo từng mục** và gửi danh sách mục cho engine. Các thông tin kèm mỗi mục (lượt, ghim, tool/file/dòng, gắn với lời gọi tool nào) có lấy được không?
6. Agent loop lưu các việc dọn thành event như thế nào, để dựng lại đúng những gì model đã thấy.

**Với TV3:** `read_file` có nhận tham số "đọc từ dòng N" không? Lời nhắc "đọc tiếp" phụ thuộc vào điều này.

**Với TV6:** báo cáo số liệu ở mục 6.3 có đủ để hiển thị trong Trace View không? Các trường TV6 đang lưu cho mỗi bước có khớp với các thông tin ở mục 5.1 không?
