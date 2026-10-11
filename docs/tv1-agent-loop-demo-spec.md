# Đặc tả Sản phẩm Đầu ra của Agent Loop (Agent Loop Output Specifications)

> Track: **TV1 — Agent Loop**  
> Tài liệu: **Đặc tả Sản phẩm Đầu ra của Chu trình Điều khiển**  
> Mục đích: Định nghĩa toàn diện các sản phẩm và dữ liệu mà Agent Loop sản sinh sau một phiên làm việc, chứng minh được kết quả tư duy, tính xác thực của phán quyết và độ ổn định của hệ thống.  
> Nguyên tắc: **Mô tả bản chất thông tin và giá trị của từng loại đầu ra bằng lời; không áp đặt tên tệp cụ thể; độc lập hoàn toàn với các thành phần bên ngoài.**

---

## 1. Bản chất Đầu ra của Agent Loop

Agent Loop không phải là một hộp đen chỉ trả về một câu trả lời ngắn gọn. Để chứng minh năng lực thẩm định và đảm bảo tính minh bạch, một lần thực thi hoàn chỉnh của chu trình phải sinh ra đầy đủ **7 trụ cột thông tin đầu ra**:

```
                               ┌────────────────────────────────────────┐
                               │        AGENT LOOP OUTPUT SYSTEM        │
                               └───────────────────┬────────────────────┘
                                                   │
        ┌──────────────┬──────────────┬────────────┴───┬──────────────┬──────────────┬──────────────┐
        ▼              ▼              ▼                ▼              ▼              ▼              ▼
   [TRỤ CỘT 1]    [TRỤ CỘT 2]    [TRỤ CỘT 3]      [TRỤ CỘT 4]    [TRỤ CỘT 5]    [TRỤ CỘT 6]    [TRỤ CỘT 7]
  Phán quyết có   Báo cáo Thẩm   Nhật ký Hành     Chứng cứ Khai  Phân bổ Ngữ    Luồng Sự kiện  Bằng chứng Độ
  Cấu trúc        định Chi tiết  trình Từng Bước  thác Thực thi  cảnh & Token   Thời gian thực Tin cậy & Bền bỉ
```

---

## 2. Chi tiết 7 Trụ cột Đầu ra của Sản phẩm

### Trụ cột 1: Phán quyết Thẩm định có Cấu trúc (Structured Adjudication Verdict)
Đây là kết luận chính thức của Agent Loop, được đóng gói có cấu trúc rõ ràng để hệ thống có thể phân loại và xử lý tự động:
* **Tính hợp lệ:** Xác định dứt khoát kết luận phân loại (báo cáo là đúng hay sai, lỗ hổng có thật hay là lỗi giả).
* **Trạng thái kiểm chứng thực thi:** Thể hiện rõ lỗ hổng đã được xác minh bằng mã khai thác chạy thành công, bị bác bỏ do khai thác thất bại, hay chưa qua kiểm chứng thực nghiệm.
* **Mã lý do phán quyết:** Nêu rõ nguyên nhân cốt lõi dẫn tới kết luận (khai thác thành công, thiếu mã kiểm thử, phát hiện gian lận mã nguồn, lỗi biên dịch, hay vi phạm ngoài phạm vi).
* **Phân loại chuyên môn:** Chỉ rõ dạng lỗ hổng theo chuẩn an ninh (tên phân loại lỗ hổng, mã định danh chuẩn ngành), mức độ nghiêm trọng và độ tin cậy của phán quyết.
* **Tóm tắt và suy luận:** Bản tóm tắt ngắn gọn và chuỗi lập luận logic giải thích tại sao đưa ra kết luận này.
* **Dẫn chứng mã nguồn chính xác:** Danh sách các đoạn mã trong kho mã nguồn mục tiêu được trích dẫn cụ thể (tên tệp, khoảng dòng bắt đầu và kết thúc, nội dung dòng lệnh liên quan và giải thích vai trò của dòng mã đó đối với lỗ hổng).

---

### Trụ cột 2: Báo cáo Thẩm định An ninh Chi tiết (Comprehensive Security Audit Dossier)
Đây là bản trình bày hoàn chỉnh dành cho người đọc chuyên môn, giải thích sâu sắc về bản chất của vấn đề bảo mật:
* **Tóm tắt điều hành:** Cái nhìn toàn cảnh về tình trạng an ninh của hợp đồng mục tiêu và kết luận kiểm định.
* **Phân tích nguyên nhân gốc rễ (Root Cause Analysis):** Phân tích chi tiết lỗi thiết kế hoặc lỗi lập trình trong mã nguồn, giải thích cơ chế dòng điều khiển và dòng dữ liệu đã tạo ra điểm yếu như thế nào.
* **Cơ chế khai thác và đường đi của cuộc tấn công:** Mô tả tuần tự từng bước mà kẻ tấn công có thể thực hiện để kích hoạt lỗ hổng, tương tác với các hàm nào và thao túng trạng thái hợp đồng ra sao.
* **Đánh giá mức độ tổn thất và ảnh hưởng tài sản:** Xác định loại tài sản gặp rủi ro, ước tính quy mô thất thoát, và chỉ rõ bất biến nghiệp vụ nào của hệ thống đã bị phá vỡ.
* **Khuyến nghị khắc phục và bản vá mẫu:** Đưa ra phương án sửa chữa tối ưu, bao gồm chiến lược khắc phục và đoạn mã sửa đổi trực quan (dưới dạng chênh lệch mã nguồn trước và sau khi vá) để lập trình viên áp dụng ngay.

---

### Trụ cột 3: Nhật ký Hành trình & Tiến trình Lặp Từng Bước (Inspectable Trajectory Ledger)
Đây là bản ghi lưu vết toàn diện toàn bộ chuỗi diễn biến của phiên làm việc từ lúc bắt đầu đến khi kết thúc, cho phép tái hiện lại 100% quá trình suy luận:
* **Thông tin định danh và môi trường:** Định danh duy nhất của lượt chạy, cấu hình áp dụng, mốc thời gian bắt đầu và kết thúc, cùng các mã băm toàn vẹn đảm bảo tính tái lập.
* **Tổng kết tài nguyên tiêu thụ:** Tổng số bước đã thực hiện, tổng số lần gọi mô hình, tổng số hành động dùng công cụ, tổng thời gian chạy thực tế, tổng lượng token và tổng chi phí tài chính tiêu tốn.
* **Dòng sự kiện tuần tự nối tiếp:** Chuỗi sự kiện có thứ tự tăng dần, ghi nhận:
  * Mọi chuyển dịch trạng thái của chu trình.
  * Từng bước suy luận: nội dung suy nghĩ của mô hình, thời gian phản hồi, lượng token đầu vào và đầu ra.
  * Từng hành động gọi công cụ: tên công cụ được dùng, tham số truyền vào, thời gian thực thi, kết quả nhận được và dấu hiệu thành công hay thất bại.
  * Các biến đổi điều chỉnh ngữ cảnh diễn ra giữa các bước.

---

### Trụ cột 4: Hồ sơ Chứng cứ Khai thác Thực thi (Executable Exploit & Verification Proof)
Đây là tập hợp các bằng chứng thực nghiệm chứng minh tính xác thực của lỗ hổng thông qua môi trường thực thi cô lập:
* **Mã kiểm thử khai thác tích hợp:** Toàn bộ mã nguồn bài kiểm thử khai thác đã được hoàn thiện, sẵn sàng biên dịch và chạy được trên khung kiểm thử tiêu chuẩn của dự án.
* **Nhật ký thực thi gốc từ môi trường cô lập:** Bản ghi đầy đủ chi tiết từng lời gọi hàm, call stack, mã phản hồi và dấu vết thực thi sinh ra từ môi trường kiểm thử.
* **Ma trận biến thiên trạng thái hợp đồng:** Bảng đối soát các biến trạng thái trọng yếu trước và sau khi thực hiện khai thác (ví dụ: số dư người dùng, tổng lượng cung, thanh khoản kho quỹ), chứng minh chênh lệch bất thường đại diện cho một vụ tấn công thực thụ.
* **Nhật ký kiểm tra an toàn và chống gian lận:** Báo cáo xác nhận mã kiểm thử không sử dụng các thủ thuật gian lận (không gọi lệnh hệ thống trái phép, không can thiệp giả lập biến nội bộ, không sửa đổi trái phép logic hợp đồng gốc).

---

### Trụ cột 5: Dữ liệu Phân bổ Ngữ cảnh & Kinh tế Token (Context Allocation & Token Economics)
Đây là số liệu minh chứng cho việc quản lý hiệu quả tài nguyên ngữ cảnh, giải thích cách hệ thống duy trì hoạt động trong giới hạn cho phép:
* **Thác nước phân bổ token qua từng bước:** Bảng chi tiết cấu trúc ngữ cảnh ở từng lượt suy luận, bóc tách dung lượng của từng khối:
  * Phần chỉ dẫn hệ thống cố định.
  * Phần mô tả công cụ.
  * Phần tài liệu đầu vào và các đoạn mã nguồn phụ trợ.
  * Phần kết quả thực thi và lịch sử hội thoại.
  * Phần dung lượng dự trữ bắt buộc cho câu trả lời của mô hình.
* **Tỷ lệ lấp đầy cửa sổ ngữ cảnh:** Mức độ sử dụng cửa sổ ngữ cảnh qua từng bước so với ngưỡng giới hạn an toàn.
* **Báo cáo định lượng về lượng token tiết kiệm được:** Số liệu đo lường cụ thể về lượng token và chi phí được cắt giảm nhờ các biện pháp định hình kết quả dài, loại bỏ kết quả trùng lặp và ẩn bớt các nội dung cũ.

---

### Trụ cột 6: Luồng Sự kiện Truyền phát Thời gian thực (Real-time Event Stream)
Đây là giao thức dữ liệu phát ra liên tục trong lúc Agent Loop đang chạy, cho phép theo dõi sát sao tiến độ mà không cần chờ tới khi kết thúc:
* **Sự kiện tiến độ giai đoạn:** Báo cáo thời điểm bắt đầu và kết thúc của từng giai đoạn thẩm tra (tiếp nhận ban đầu, kiểm tra an toàn mã kiểm thử, thực thi trong môi trường cô lập, chu trình suy luận).
* **Sự kiện từng bước làm việc:** Phát tín hiệu khi bắt đầu một bước mới, dung lượng ngân sách còn lại, và trạng thái sẵn sàng của ngữ cảnh.
* **Sự kiện thực thi hành động:** Thông báo thời điểm mô hình quyết định gọi công cụ tra cứu, tham số yêu cầu, và thời điểm công cụ hoàn thành việc trả kết quả.
* **Sự kiện hoàn tất phán quyết:** Phát ra thông điệp ngay khi phán quyết cuối cùng được hình thành và nghiệm thu.

---

### Trụ cột 7: Bằng chứng Độ Tin cậy & Kiểm chứng Bền bỉ (System Reliability & Stress-Test Evidence)
Đây là các bằng chứng định lượng chứng minh chu trình điều khiển vận hành ổn định, không bị đổ vỡ trước các tình huống bất thường:
* **Bằng chứng khả năng phục hồi trước sự cố:** Dữ liệu chứng minh tỷ lệ xử lý lỗi thành công khi gặp các tình huống công cụ trục trặc (tệp không tồn tại, tham số sai định dạng, dữ liệu bị từ chối truy cập); chứng minh chu trình không bao giờ bị dừng đột ngột mà luôn chuyển hóa lỗi thành dữ liệu phản hồi để tự sửa sai.
* **Bằng chứng tuân thủ thứ tự ưu tiên điều kiện dừng:** Kết quả kiểm chứng chứng minh hệ thống chọn đúng nguyên nhân dừng khi có nhiều giới hạn bị chạm cùng một lúc (hết thời gian thực, hết ngân sách tài chính, hết hạn mức token, vượt số bước tối đa, hoặc phát hiện vòng lặp không có tiến triển).
* **Báo cáo hiệu quả xử lý sớm:** Số liệu chứng minh khả năng phát hiện và loại bỏ tức thì các trường hợp không hợp lệ ngay từ cửa tiếp nhận, hoàn thành việc từ chối với chi phí và thời gian tối thiểu.

---

## 3. Khả năng Đáp ứng theo Từng Tình huống Thẩm định

Để chứng minh tính linh hoạt, hệ thống đầu ra tự động điều chỉnh nội dung tương ứng theo từng kịch bản nghiệp vụ:

| Tình huống thẩm định | Đặc điểm Phán quyết đầu ra (Trụ cột 1) | Báo cáo chi tiết (Trụ cột 2) | Hồ sơ thực nghiệm (Trụ cột 4) | Tiêu thụ tài nguyên (Trụ cột 5) |
|---|---|---|---|---|
| **Lỗ hổng xác thực có bằng chứng** | Xác nhận hợp lệ (`valid`), kiểm chứng thành công (`PASS`), đầy đủ trích dẫn dòng mã vi phạm. | Phân tích đầy đủ nguyên nhân, cơ chế tấn công, tổn thất tài sản và bản vá đề xuất. | Có đầy đủ mã kiểm thử, nhật ký thực thi và ma trận biến thiên trạng thái ($\Delta S$). | Tiêu thụ qua nhiều bước suy luận, có số liệu phân bổ ngữ cảnh từng bước. |
| **Báo cáo thiếu mã kiểm thử** | Kết luận không hợp lệ (`invalid`), kiểm chứng thất bại (`FAIL`), lý do thiếu mã kiểm thử khai thác. | Nêu rõ việc từ chối do không đáp ứng yêu cầu kiểm chứng thực nghiệm. | Không phát sinh hồ sơ thực thi. | Ngắt ngay từ giai đoạn đầu, tiêu thụ 0 token mô hình và thời gian xử lý tối thiểu. |
| **Mã kiểm thử có dấu hiệu gian lận** | Kết luận không hợp lệ (`invalid`), kiểm chứng thất bại (`FAIL`), lý do phát hiện can thiệp mã nguồn bất thường. | Chỉ rõ vị trí mã kiểm thử cố tình thay đổi logic hoặc gọi lệnh cấm thay vì khai thác thực tế. | Báo cáo kiểm tra an toàn ghi nhận vi phạm cụ thể. | Dừng ngay trước khi đưa vào môi trường kiểm thử, không tốn tài nguyên suy luận. |
| **Mã kiểm thử chạy thất bại hoặc lỗi** | Kết luận không hợp lệ (`invalid`), kiểm chứng thất bại (`FAIL`), lý do thực thi thất bại. | Giải thích nguyên nhân mã kiểm thử bị dừng hoặc báo lỗi trong quá trình chạy. | Lưu vết đầy đủ nhật ký lỗi và lý do hoàn tác giao dịch. | Dừng ngay sau bước thực nghiệm, không tốn tài nguyên cho chu trình suy luận chuyên sâu. |
