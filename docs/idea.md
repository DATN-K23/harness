# Đồ án này là gì

*Đọc 10 phút. Đọc xong là hiểu cả năm nhóm sẽ làm gì.*

---

> ## Hình dung thế này

Tưởng tượng một chuyên gia kiểm định smart contract rất giỏi, nhưng bị nhốt trong một căn phòng kín. Anh ta chỉ được nhìn **đúng một tờ giấy** ai đó luồn vào. Không được mở máy tính xem các file khác. Không được ghi chú. Không được chạy thử code để kiểm tra xem linh cảm của mình đúng hay sai.

Anh ta vẫn có thể nói vài điều thông minh. Nhưng phần lớn là **đoán**.

Đó chính xác là tình trạng của một AI khi bạn dán đoạn code vào ChatGPT rồi hỏi "có lỗi gì không".

**Việc của nhóm là mở cửa căn phòng đó.**

Nhóm đưa cho nó:

- **Chìa khoá kho code** — nó tự mở file, tự tìm hàm, tự đi theo dấu vết trong cả dự án
- **Một cuốn sổ** — nó ghi lại đã xem gì, đang nghi ngờ gì, còn gì chưa xét
- **Một quy trình làm việc** — cách kiểm tra từng loại lỗi, thay vì mỗi lần làm một kiểu
- **Một phòng thí nghiệm** — nó **tự viết bài test để chứng minh** lỗ hổng có thật, trước khi dám báo cáo

Bộ khung đó là sản phẩm của nhóm.

---

## Câu chốt

> **Vẫn là AI đó. Không thay đổi gì bên trong nó.**
> Dùng trần thì đúng được X%. Qua bộ khung của nhóm thì đúng được Y%.
> **Phần chênh lệch Y − X chính là đồ án.**

---

## Vậy nhóm không làm gì?

Hỏi để tránh hiểu lầm ngay từ đầu:

| Không làm                               | Vì sao                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| Huấn luyện AI riêng                    | Không có tiền, không có máy, và 6 tháng sau là lỗi thời      |
| Làm "ChatGPT cho blockchain"             | Đó là một cái app, không phải một nghiên cứu                  |
| Chỉ dùng được với một hãng AI     | Sẽ không chứng minh được luận điểm chính (đọc phần dưới) |
| Copy một dự án mã nguồn mở về sửa | Thì phần lớn công trình không còn là của nhóm                 |

---

## Ba câu hỏi cả năm phải trả lời

Đây là xương sống. Mọi việc trong năm đều phục vụ một trong ba câu này.

### Câu 1 — Bộ khung có làm AI mạnh lên thật không?

So sánh: cùng một AI, một bên dùng trần, một bên qua bộ khung của nhóm.

Nếu không chênh nhau thì bộ khung vô nghĩa. Nếu chênh nhiều thì phần chênh đó là công của nhóm.

### Câu 2 — Có hơn công cụ đã có sẵn không?

Trên thị trường đã có công cụ dò lỗi smart contract tự động. Nếu bộ khung của nhóm không hơn được chúng thì không ai cần nó.

### Câu 3 — Giá trị đó có phụ thuộc vào hãng AI nào không?

Đây là câu **quan trọng nhất**, và cũng khó hiểu nhất.

Giả sử bộ khung làm AI của hãng A mạnh lên 20%. Tốt. Nhưng nếu thử với hãng B, hãng C mà **không** mạnh lên, thì có nghĩa nhóm chỉ đang ăn may vào một đặc tính riêng của hãng A — đóng góp rất mỏng.

Còn nếu **cả bốn hãng đều mạnh lên**, kết luận trở nên rất chắc: *giá trị nằm ở bộ khung, không nằm ở AI*.

> Đó là lý do "chạy được với nhiều AI" không phải một tính năng cho oai. Nó là **điều kiện bắt buộc** để chứng minh công trình này là của nhóm.

---

## Đo bằng gì

Không được nói "AI của em kiểm định tốt hơn". Phải nói bằng bốn con số:

| Con số                    | Nghĩa là gì                                          | Vì sao cần                                                   |
| -------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| **Độ phủ**        | Trong tất cả lỗi thật, tìm ra được bao nhiêu % | Sót lỗi thì vô dụng                                       |
| **Độ chính xác** | Trong những gì báo ra, bao nhiêu % là đúng       | ⭐ Chỗ nhóm thắng — đọc bên dưới                      |
| **Chi phí**         | Một lần kiểm định tốn bao nhiêu tiền            | Đắt hơn thuê người thì không ai dùng                  |
| **Tính lặp lại**  | Chạy lại có ra cùng kết quả không                | Không lặp lại được thì không phải kết quả khoa học |

### Vì sao độ chính xác là chỗ thắng

Đây là điểm chết của **mọi** công cụ AI kiểm định hiện nay:

Nó báo 100 lỗi. Trong đó khoảng 85 cái là **lỗi ma** — không có thật. Người kiểm định thật phải đọc hết 100 cái để lọc ra 15 cái đúng. **Mất thời gian hơn là tự làm.**

Đó là lý do ngành này chưa dùng AI thật, dù ai cũng biết AI đọc code giỏi.

Nhóm đánh thẳng vào đó: **bắt AI tự chứng minh.** Nghi có lỗ hổng? Viết một bài test khai thác nó. Test chạy thành công thì mới được báo. Không chạy được thì loại.

Và điểm mấu chốt: **AI dùng trần không làm được việc này** — nó không chạy được code. Chỉ có bộ khung mới cho nó phòng thí nghiệm.

> Nếu cả năm chỉ làm tốt được một thứ, chọn thứ này.

---

## Dữ liệu lấy ở đâu

Có những cuộc thi kiểm định smart contract công khai (Code4rena, Sherlock, CodeHawks). Cách chúng hoạt động:

1. Một dự án đưa code lên, treo thưởng
2. Hàng trăm người tìm lỗi, nộp báo cáo
3. Ban giám khảo chấm: lỗi nào thật, lỗi nào không, mức độ nghiêm trọng ra sao
4. **Kết quả chấm được công bố công khai**

Bước 4 là thứ nhóm cần. Đó là **đề có sẵn đáp án** — dùng để chấm điểm bộ khung của nhóm.

Nhóm sẽ làm việc theo hai chế độ:

- **Chấm** — đưa vào một báo cáo lỗi, hệ thống nói đúng hay sai. *(Làm trước, dễ hơn)*
- **Tự kiểm định** — đưa vào cả kho code, hệ thống tự tìm lỗi. *(Làm sau, khó hơn)*

---

## Bốn cái bẫy phải biết từ hôm nay

Bốn thứ này nguy hiểm vì khi dính, **không có dấu hiệu gì cả**. Không báo lỗi, không cảnh báo. Mọi thứ trông hoàn hảo cho tới lúc bảo vệ.

### Bẫy 1 — AI đọc trúng đáp án

Dữ liệu tải về của mỗi cuộc thi có cả code lẫn file đáp án. Nếu để AI nhìn thấy cả thư mục, nó sẽ làm đúng cái mọi AI thông minh đều làm: mở file đáp án ra đọc, rồi chép lại.

Kết quả: đúng gần 100%. Đẹp rực rỡ. Và **hoàn toàn vô giá trị**.

→ *AI chỉ được thấy thư mục code. Đáp án cất chỗ khác.*

### Bẫy 2 — Chia dữ liệu sai cách

Nhóm phải chia dữ liệu thành phần để làm và phần để chấm. Nếu chia lẫn lộn — lỗi của cùng một cuộc thi nằm cả hai bên — thì AI đã thấy đáp án của bài gần giống rồi, đoán đúng mà chẳng hiểu gì.

Đây là lỗi kinh điển, và **hội đồng chấm biết rõ lỗi này**.

→ *Chia theo từng cuộc thi, trọn gói. Chia xong thì không đổi nữa.*

### Bẫy 3 — Không tắt được từng phần

Câu hội đồng chắc chắn hỏi: *"Em không huấn luyện AI thì đóng góp của em là gì?"*

Câu trả lời tốt nhất là một bảng: tắt phần ghi nhớ đi thì kết quả tụt 8%, tắt phần tự kiểm chứng thì tụt 15%... Bảng đó nói rõ **từng phần nhóm làm ra đáng giá bao nhiêu**.

Nhưng muốn có bảng đó thì **mọi phần phải tắt được bằng một công tắc**. Nếu code viết dính chặt vào nhau thì đến lúc cần không tắt nổi.

→ *Cứ làm gì ảnh hưởng kết quả thì cho nó một công tắc bật/tắt ngay từ lúc viết.*

### Bẫy 4 — AI có thể đã học thuộc đề

Các cuộc thi cũ công khai trên mạng từ lâu. Rất có thể AI đã đọc chúng trong lúc được huấn luyện. Nếu vậy nó trả lời đúng nhờ **trí nhớ**, không phải nhờ bộ khung của nhóm.

→ *Ưu tiên dùng cuộc thi mới để chấm điểm, và nói thẳng chuyện này trong báo cáo thay vì giấu.*

---

## Điều đáng mừng

Ba trong bốn cái bẫy trên, phần lớn đồ án sinh viên **không hề biết tới**. Nhóm biết từ tuần đầu.

Xử lý được chúng một cách minh bạch — kể cả khi số liệu không đẹp — sẽ làm phần đánh giá của nhóm trông chững chạc hơn hẳn.

---

**Tiếp theo:** [Start Here](00-START-HERE.md) — thứ tự đọc tài liệu và phạm vi làm việc của nhóm.
