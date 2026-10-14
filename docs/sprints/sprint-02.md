# Sprint 2 — Dựng nền core và gọi model thật

[Lộ trình core](../core-team-timeline.md)

**Mục tiêu chung:** chạy được luồng nhập prompt → gọi API model thật → lưu kết quả hoặc lỗi vào PostgreSQL → xem lại theo mã lượt chạy, kể cả sau khi khởi động lại chương trình.

**Phạm vi:** runner một lượt gọi model, dùng làm nền để bổ sung source, tools, context và agent loop ở các sprint sau. Kết quả ở sprint này là phản hồi model; verdict Judge có evidence sẽ được triển khai ở chặng Judge.

A–D là bốn người code, leader sẽ gán thành viên. Research nghiên cứu pipeline Judge và Audit từ sprint 2 đến chặng agent loop (sprint 7–8).

## A — Setup công nghệ và lệnh chạy

- [ ] Tìm hiểu và thiết lập Bun workspace, TypeScript/Turborepo: các package trong repo cài dependency và import nhau được qua các phần công khai.
- [ ] Thống nhất cách cấu hình DB, model và giới hạn lượt gọi; có cấu hình mẫu và thông báo khi thiếu cấu hình.
- [ ] Làm điểm khởi động để nối runner của B, lưu trữ của C và kết nối model của D. Có lệnh nhập prompt và lệnh xem lại theo mã lượt chạy.
- [ ] Viết hướng dẫn chuẩn bị môi trường, chạy migration và khởi động để cả nhóm dùng được.

**Đầu ra:** một cách khởi động thống nhất và các lệnh sử dụng luồng thật. Bun workspace ở đây là cách tổ chức các package code trong repo.

**Phối hợp:** B/C/D cung cấp cách khởi tạo phần của mình; A ghép tại điểm khởi động.

## B — Quản lý run và runner một lượt

- [ ] Chốt dữ liệu tạo/xem một lượt chạy: prompt, model/profile, giới hạn, mã lượt chạy, trạng thái, kết quả và lỗi. Phân biệt trạng thái thực thi với kết luận Judge.
- [ ] Viết runner — phần điều khiển thứ tự công việc: nhận yêu cầu → lưu thông tin ban đầu → gọi model qua D → ghi kết quả/lỗi qua C.
- [ ] Kiểm tra đầu vào và giới hạn trước khi gọi; ghi lại các sự kiện để biết lượt chạy đã đi tới đâu. Không tự gọi lại khi kết quả lần gọi trước chưa rõ.
- [ ] Cung cấp thao tác xem run và lịch sử đã lưu; cung cấp cấu trúc dữ liệu và ví dụ để Research đối chiếu với pipeline.

**Đầu ra:** một lượt chạy được điều phối xuyên suốt, có mã để tra cứu và kết quả/lỗi rõ ràng.

**Phối hợp:** B cùng C chốt thời điểm lưu dữ liệu; cùng D chốt request, response và lỗi khi gọi model. B phụ trách runner và quyết định trạng thái.

## C — PostgreSQL/Drizzle và lưu dữ liệu

- [ ] Tìm hiểu kết nối PostgreSQL, khai báo bảng bằng Drizzle và migration để các máy tạo cùng cấu trúc DB.
- [ ] Cùng B/D chọn dữ liệu cần lưu từ đầu: run, cấu hình, event, từng lần gọi model, request/response an toàn, usage, thời gian và chi phí.
- [ ] Viết phần lưu/đọc dữ liệu; bảo đảm trạng thái và event tương ứng được ghi nhất quán, lịch sử có thứ tự.
- [ ] Lưu dấu vết trước khi gọi API và kết quả sau khi gọi. Thể hiện được lần gọi chưa rõ kết quả nếu chương trình bị gián đoạn; không lưu API key.

**Đầu ra:** migration đầu tiên và phần lưu trữ dùng được trong luồng thật; khởi động lại vẫn xem được run cùng lịch sử.

**Phối hợp:** B dùng các thao tác lưu/đọc của C. D cung cấp ý nghĩa của các trường provider, usage và chi phí để lưu đúng.

## D — Tích hợp API model thật

- [ ] Tìm hiểu API/SDK của provider đầu tiên; đề xuất model/profile và cách cấu hình API key để nhóm chốt trước khi gọi.
- [ ] Viết adapter trong `llm`: nhận request của Harness, gọi API thật và trả response hoặc lỗi theo cấu trúc chung để B sử dụng.
- [ ] Thiết lập timeout và giới hạn output; mỗi lần gọi hàm tương ứng tối đa một lần gọi provider, tắt retry ngầm của SDK.
- [ ] Trả thông tin model, usage, thời gian và chi phí theo giá đã chọn. Nếu thiếu usage/chi phí thì ghi rõ chưa xác định; xử lý lỗi xác thực, rate limit, mạng và timeout mà không lộ secret.

**Đầu ra:** runner của B gọi được model thật và nhận dữ liệu đủ để C lưu lại. D tập trung vào kết nối provider; không viết thêm runner.

**Phối hợp:** cùng B chốt dữ liệu vào/ra và cách báo lỗi; cùng C chốt thông tin cần lưu cho mỗi lần gọi.

## Cả nhóm thống nhất trước khi code riêng

- [ ] Chọn provider/model, người quản lý API key, giới hạn output, timeout và ngân sách gọi API.
- [ ] Viết một ví dụ chung cho yêu cầu chạy, phản hồi model, lỗi và dữ liệu xem lại. Chốt tên hàm cùng dữ liệu vào/ra ở ba chỗ: lệnh của A → B, runner của B → D, operation của B → C.
- [ ] Chốt loại bản ghi và trạng thái cho lượt gọi model ban đầu; giữ rõ điều kiện snapshot/evidence khi bổ sung Judge sau này.
- [ ] Dùng lệnh phát triển để ghép luồng trong sprint này; Research dùng dữ liệu và trace thực tế để kiểm tra đề xuất pipeline. Chốt exports và người phụ trách các file cấu hình chung để tránh sửa chồng nhau.

**Cách làm song song:** A dựng khung repo sớm; B phác runner và dữ liệu run; C chuẩn bị DB; D tìm hiểu API. Sau khi chốt phần giao tiếp, mỗi người triển khai phần mình và ghép một lượt gọi thật ngay giữa sprint.

## Research

- [ ] Nghiên cứu source OpenCode và các phương pháp xây dựng pipeline Judge/Audit.
- [ ] Nghiên cứu pipeline Judge: kiểm tra finding, tìm bằng chứng, bác bỏ giả thuyết và xử lý trường hợp chưa đủ căn cứ.
- [ ] Nghiên cứu pipeline Audit: khảo sát repository, tạo giả thuyết, tìm bằng chứng, lọc/gom finding và lập báo cáo.
- [ ] Nghiên cứu tools, context, điều kiện dừng và xử lý lỗi; xác định phần dùng chung và phần riêng của hai mode.
