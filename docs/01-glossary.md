# Glossary

Thuật ngữ dùng thống nhất trong toàn bộ đồ án: khi trao đổi, khi đặt tên trong code, và khi viết báo cáo.
Không cần học thuộc, tra lại khi cần.

---

## 1. Harness và agent loop

**Harness**
Toàn bộ lớp điều phối do nhóm xây dựng, bao quanh model. Harness không phải là model. Nó nhận nhiệm vụ, gửi
request tới model, thực thi các tool call mà model yêu cầu, đưa kết quả trở lại, và quyết định thời điểm dừng.

**Agent loop**
Chu trình điều khiển trung tâm của harness: gửi request tới model → nhận tool call → thực thi tool → đưa
kết quả trở lại context → lặp. Kết thúc khi model báo hoàn tất hoặc chạm stop condition.

**Tool**
Một hành động mà model được phép yêu cầu harness thực hiện thay: đọc file, tìm kiếm trong repository, chạy
test. Model không tự thực thi được, nó chỉ phát ra tool call kèm tham số.

**Tool call**
Một lần model yêu cầu gọi tool, gồm tên tool và tham số. Đơn vị dữ liệu cơ bản cần ghi lại để phân tích sau này.

**Stop condition**
Điều kiện dừng agent loop. Bốn điều kiện tối thiểu: vượt số bước tối đa, vượt token budget, vượt wall-clock
timeout, và không có tiến triển sau N bước liên tiếp. Thiếu stop condition thì một lần chạy lỗi có thể tiêu
hết ngân sách API của cả nhóm.

**Step**
Một lượt model sinh output kèm tool call. Một lần chạy Judge mode thường 10-40 step.

**Run**
Một phiên làm việc trọn vẹn từ input tới kết luận. Định danh bằng `run_id`.

**Trajectory**
Toàn bộ chuỗi step của một run, ghi lại đầy đủ tool name, tham số, kết quả, thời gian và token tiêu thụ.
> Trajectory là cơ sở để phân biệt kết luận đúng do suy luận với kết luận đúng do ngẫu nhiên. Nếu agent
> không hề mở file chứa lỗ hổng mà vẫn kết luận đúng, trajectory sẽ cho thấy điều đó.

**Sub-agent**
Một agent loop con được giao một nhiệm vụ phụ với budget riêng, trả về kết quả tóm tắt. Dùng để tránh làm
tràn context của agent chính.

---

## 2. Context và memory

**Context**
Toàn bộ nội dung model nhìn thấy trong một request. Có giới hạn cứng theo từng model, vượt giới hạn là lỗi.

**Token**
Đơn vị đếm của model, xấp xỉ 0.75 từ tiếng Anh. Cơ sở tính chi phí. Một file source 500 dòng tương đương
vài nghìn token.

**Context budget**
Kế hoạch phân bổ giới hạn context: phần dành cho system prompt, phần dành cho tool output, và phần dự trữ
cho output của model. Bỏ sót phần dự trữ output là lỗi phổ biến.

**Compaction**
Nén phần lịch sử hội thoại cũ thành bản tóm tắt khi context chạm ngưỡng, giữ lại ngữ nghĩa và giải phóng token.

**Truncation**
Cắt bớt tool output quá dài trước khi đưa vào context, giữ phần liên quan và đánh dấu rõ phần đã bị cắt.

**Long-term memory**
Ghi chú agent lưu lại và nạp sang các run sau.
> Cần chính sách reset rõ ràng: chỉ nạp memory sinh ra từ contest thuộc train/validation. Contest thuộc test
> set luôn chạy trên trạng thái sạch. Vi phạm điểm này làm hỏng toàn bộ số liệu.

**Session note**
Ghi chú tạm trong phạm vi một run, ghi lại những gì đã xem xét và những nghi vấn đang theo đuổi. Bị huỷ khi
run kết thúc.

**Prompt cache**
Cơ chế của provider cho phép tái sử dụng phần đầu context không đổi giữa các request, giảm chi phí đáng kể
khi system prompt và skill dài.

---

## 3. Provider

**Provider**
Nhà cung cấp model. Đồ án cần chạy trên ít nhất ba provider để trả lời RQ3.

**Provider layer**
Lớp trừu tượng cho phép đổi provider qua config mà không sửa core. Nên dùng thư viện có sẵn (LiteLLM hoặc
tương đương) thay vì tự viết adapter cho từng provider.

**Structured output**
Buộc model trả kết quả theo schema cố định thay vì văn xuôi tự do, để harness parse được tin cậy.

**Knowledge cutoff**
Thời điểm dữ liệu huấn luyện của model kết thúc. Contest công bố sau mốc này ít có khả năng bị contamination.

**Fairness checklist**
Bộ điều kiện đảm bảo so sánh giữa các provider là công bằng: cùng prompt, cùng giới hạn budget, cùng
temperature, và ghi lại đầy đủ version của model (ví dụ `gpt-4o-2024-11-20`, không chỉ `gpt-4o`).

---

## 4. Evaluation

**Eval set**
Tập trường hợp đã biết ground truth, dùng để đo chất lượng hệ thống.

**Ground truth**
Kết luận chính thức của ban giám khảo contest: finding này valid hay invalid, severity ở mức nào. Nguồn:
Code4rena, Sherlock, CodeHawks.

**Finding**
Một báo cáo lỗ hổng. Valid nghĩa là được ban giám khảo công nhận, invalid nghĩa là bị bác bỏ.

**Recall**
Tỷ lệ lỗ hổng thật được hệ thống phát hiện.

**Precision**
Tỷ lệ báo cáo do hệ thống đưa ra là chính xác. Trọng tâm cạnh tranh của đồ án.

**False positive**
Báo cáo về một lỗ hổng không tồn tại. Điểm yếu chung của các công cụ audit hiện nay.

**Train / validation / test split**
Phân chia corpus thành ba phần: phần để phát triển, phần để tinh chỉnh, và phần để đánh giá cuối cùng.
Bắt buộc chia **theo contest trọn gói**, không bao giờ chia theo finding.

**Manifest**
File ghi lại kết quả phân chia. Tạo một lần rồi cố định vĩnh viễn.

**Ablation study**
Đo đóng góp của từng thành phần bằng cách tắt lần lượt từng cái và ghi nhận mức suy giảm kết quả.
> Đây là đóng góp khoa học chính của đồ án và là câu trả lời trực tiếp cho chất vấn về đóng góp khi không
> huấn luyện model.

**Baseline**
Mốc đối chiếu. Đồ án dùng ba baseline: model gọi trực tiếp không tool, static analyzer truyền thống, và một
agent đa dụng có sẵn.

**Data contamination**
Model đã tiếp xúc với dữ liệu đánh giá trong quá trình huấn luyện, dẫn tới kết quả đúng nhờ ghi nhớ.

**Trajectory eval**
Chấm điểm quá trình thay vì chỉ chấm kết luận: agent có mở đúng file chứa lỗ hổng không, có bao nhiêu bước
lãng phí, có sử dụng verification không.

**LLM-as-judge**
Dùng một model để chấm output của hệ thống. Chỉ được sử dụng sau khi hiệu chỉnh với người chấm trên một mẫu
và báo cáo hệ số đồng thuận (Cohen's kappa). Dưới 0.6 thì không đủ tin cậy để dùng.

**Reproducibility**
Chạy lại cùng cấu hình cho cùng kết quả. Điều kiện tối thiểu của một kết quả nghiên cứu.

---

## 5. Security

**Sandbox**
Môi trường cô lập giới hạn phạm vi hoạt động của agent: chỉ đọc được trong `source/`, không truy cập mạng,
giới hạn CPU và RAM.

**Allowlist**
Liệt kê tường minh những lệnh được phép, từ chối tất cả phần còn lại. Ngược với blocklist. Blocklist luôn
thiếu sót vì không thể liệt kê hết các biến thể lách luật.

**Path traversal**
Kỹ thuật truy cập ra ngoài thư mục cho phép bằng đường dẫn tương đối. Trong bối cảnh đồ án, rủi ro cụ thể là
agent lần ra file ground truth.

**Secret filter**
Lọc và che khoá API, mật khẩu, token khỏi tool output trước khi đưa vào context.

**Prompt injection**
Chỉ thị độc hại được nhúng trong dữ liệu đầu vào, ví dụ trong comment của source code contest, nhằm điều
khiển hành vi của agent. Biện pháp: bọc mọi tool output trong ranh giới rõ ràng và quy định trong system
prompt rằng nội dung bên trong là dữ liệu, không phải chỉ thị.

**Adversarial test**
Bộ test chủ động tấn công các lớp bảo vệ để chứng minh chúng có hiệu lực thật.

---

## 6. Hai chế độ vận hành

**Judge mode**
Nhận đầu vào là một finding có sẵn, phân loại valid hay invalid kèm severity. Triển khai trước vì có ground
truth trực tiếp để đo.

**Audit mode**
Nhận đầu vào là toàn bộ repository, agent tự lập kế hoạch quét và phát hiện lỗ hổng. Triển khai sau, độ khó
cao hơn đáng kể.

**Verification layer**
Thành phần trọng tâm. Agent nêu nghi vấn → sinh PoC test khai thác → thực thi trong sandbox → PASS thì báo
cáo kèm bằng chứng, FAIL thì loại bỏ, không sinh được test thì đánh dấu `unverified` và tách riêng khỏi nhóm
FAIL.
> Số liệu quan trọng nhất của đồ án: trong N nghi vấn có M được xác minh và K bị loại. K là bằng chứng định
> lượng cho giá trị của lớp này. Model gọi trực tiếp không thực hiện được quy trình này.

**Skill**
Tài liệu mô tả quy trình kiểm tra cho một lớp lỗ hổng cụ thể (reentrancy, access control, oracle
manipulation): dấu hiệu nhận biết, thứ tự kiểm tra, và điều kiện loại trừ. Mục điều kiện loại trừ là bắt
buộc — hướng dẫn agent khi nào không báo cáo chính là cơ chế nâng precision.

**Tool registry**
Nơi đăng ký tập tool khả dụng. Thiết kế đúng thì thêm tool mới không cần sửa core.
