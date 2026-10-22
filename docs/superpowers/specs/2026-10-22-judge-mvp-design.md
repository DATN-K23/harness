# Judge MVP — Thiết kế triển khai

## Ý định

Đưa Judge API hiện có tới một Judge MVP dùng được cho submission Solidity/Foundry, gồm cả báo cáo có PoC và narrative-only, theo pipeline trong `docs/tv4-judge-pipeline-proposal.md`. MVP phải trả kết luận có căn cứ từ snapshot bất biến, phân biệt rõ phân tích tĩnh với kết quả thực thi, và giữ inconclusive/unverified khi bằng chứng không đủ.

## Tiêu chí thành công

- Một submission narrative được phân rã thành claim có cấu trúc; một submission có PoC được gắn PoC với claim cụ thể. Claim, target, actor/điều kiện, impact/state và citation được xác thực trước khi dùng.
- BCE thu thập source liên quan trên snapshot đã khóa; đường dẫn/citation được kiểm tra bằng `SourceSnapshotPort`. MVP được phép dùng BCE giới hạn, xác định được và khai báo rõ phạm vi Solidity/Foundry; thiếu cạnh/không hỗ trợ phải là incomplete, không phải bằng chứng phủ định.
- Hai hướng phân tích độc lập (entry point → path và impact/state → điều kiện/guard) chạy qua `JudgeRunner`; consensus chỉ cho verdict tĩnh khi evidence/citations tương ứng được kiểm chứng từ snapshot. Mọi bất đồng, thiếu evidence hoặc phụ thuộc runtime chỉ đi qua sandbox nếu có PoC submitter an toàn; nếu không thì inconclusive.
- PoC không tin cậy được kiểm tra trước khi chạy. Sanitizer là lớp kiểm tra/giảm rủi ro bổ sung, không được xem là security boundary thay cho sandbox. PoC không an toàn hoặc không ánh xạ được tới assertion/claim không được chạy/không được tính là evidence.
- Sandbox Foundry production là ephemeral, network `none`, giới hạn thời gian/CPU/RAM, không có host secrets, chỉ đọc source snapshot được phép và chỉ ghi vào vùng tạm. Phân loại được test/harness failure riêng với exploit assertion và không biến exit status đơn lẻ thành verdict.
- Verdict dùng `JudgeVerdict` hiện hành; không thêm severity hoặc trạng thái wire mới nếu chưa được duyệt. Theo quyết định đã duyệt, `PASS` nghĩa là claim được xác minh bằng evidence hợp lệ đã kiểm tra, có thể tĩnh hoặc runtime; không hàm ý PoC nhất thiết đã chạy. Evidence chứa citation chính xác; static reasoning, PoC/test output, trace và state delta được phân biệt. Không đủ căn cứ luôn giữ inconclusive/unverified.
- Có composition có thể khởi chạy local trên macOS với Keychain credential, PostgreSQL, snapshot store, provider cấu hình tường minh, worker polling có lifecycle dừng được và health/version handshake. Không có `.env`/plaintext/anonymous credential fallback.
- Có kiểm thử deterministic cho stage contracts và end-to-end, cùng integration test có điều kiện cho Docker/Foundry và PostgreSQL; có một bộ fixture Solidity không chứa ground truth trong đường agent.

## Phạm vi

**Trong phạm vi:** Solidity + Foundry là runtime đầu tiên; narrative và PoC; BCE/source mapping trong giới hạn hỗ trợ; forward/backward/arbiter; kiểm tra PoC submitter; sandbox Docker; local API production composition; telemetry/config, test, hướng dẫn vận hành và security boundaries.

**Ngoài phạm vi:** Audit Mode hoặc tự tìm finding toàn repo; ngôn ngữ ngoài Solidity/Foundry; khẳng định sound/complete cho call graph; thêm verdict fields chỉ có trong proposal nhưng chưa có trong contract; tạo witness bằng cách tự sinh test code nếu chưa có ràng buộc để chứng minh test kiểm đúng claim; triển khai UI/remote multi-tenant service.

## Hành vi pipeline

1. **Nhận và phân rã:** xác thực report/PoC và từ chối mọi ground-truth/adjudication/scoring metadata ở mọi độ sâu. Dùng model để trích claim có schema; kiểm tra claim hợp lệ và trích dẫn/target có trong snapshot. Report không parse được hoặc target không map được không được suy thành invalid.
2. **BCE:** dựng context giới hạn từ contract/function, callers/callees, modifiers/guards, state reads/writes và source lines theo snapshot. Mọi dữ liệu chỉ đọc từ `SourceSnapshotPort`; lỗi/không hỗ trợ/call graph thiếu cạnh được đánh dấu incomplete.
3. **Phân tích hai chiều:** chạy forward và backward thành các kết quả typed riêng. Validate mọi citation qua snapshot; kết quả model không được tự khẳng định một guard/call path là sự thật nếu citation không khớp. Arbiter hiện hành áp dụng; khi evidence không đủ, chuyển witness hoặc inconclusive.
4. **PoC/witness:** PoC của submitter được kiểm tra AST/compile-context và policy cấm trước khi sandbox; blacklist sanitizer không được coi là cách ly. MVP không tự sinh witness. Narrative-only nếu cần runtime evidence mà không có PoC submitter phù hợp thì trả inconclusive/unverified.
5. **Thực thi:** adapter Docker/Foundry chạy đúng snapshot + test đã được phép, không mạng, có resource/time bounds, không host credentials hoặc Docker socket trong container. Thu thập exit status, test/assertion report, trace và state delta có giới hạn kích thước; execution/setup failure là unverified, không phải refutation.
6. **Verdict:** dùng schema hiện có. Verdict static hoặc runtime phải ghi provenance/evidence đúng loại; mọi kết luận kiểm chứng được phải kèm citations; lỗi/mâu thuẫn/thiếu bằng chứng giữ `UNVERIFIED`/inconclusive theo contract.

## Kiến trúc và tái sử dụng

- Giữ orchestration và quyết định trong `@harness/core`, qua port của `@harness/protocol`; adapter Solidity/Foundry, container, provider và persistence đặt ngoài core.
- Tái sử dụng `JudgeRunner`, cancellation, append-only trajectory, snapshot/path guards, `JudgeVerdict`, cấu hình hiện có, forward/backward prompt & parser, terminal persistence và local server API. Không thay luồng an toàn/port để copy code.
- Kiểm tra `.opencode_reference` theo từng phần trước khi triển khai. Ưu tiên tương thích thực sự (prompt/context/LLM orchestration, process/sandbox lifecycle patterns); chỉ port thành phần cần thiết, ghi attribution và NOTICE. Không kéo Effect/Node-only/framework code hoặc logic không khớp Solidity/security chỉ để tăng tỷ lệ reuse.
- Các dependency thực tế (Docker daemon/image Foundry, model endpoint/keychain, PostgreSQL) được inject/configure và kiểm tra lúc startup; thiếu dependency cần dùng thì fail closed với thông báo cấu hình rõ.

## Research/security constraints

- Rule R2: ground truth, adjudication reports và scoring metadata không được đi vào runner/context/tools/provider/events/logs. API từ chối prohibited metadata keys đệ quy. Hệ thống không tự đọc corpus/scorer; corpus/scorer tách tiến trình và quyền truy cập; fixture cho agent chỉ chứa input/source/evidence cần thiết. Nội dung báo cáo tự do là untrusted user input, không phải nguồn ground truth do hệ thống cấp.
- Snapshot bất biến là nguồn sự thật; từ chối absolute path, traversal và symlink escape trước I/O.
- Sandbox không mạng, không host secrets, ephemeral và resource-bounded; không chạy PoC chỉ vì sanitizer cho qua.
- Hành vi tùy chọn làm thay đổi output là config rõ ràng, snapshot vào run config/telemetry (Rule R1).
- Giới hạn kích thước report, PoC, BCE, trace, model output, event payload, runtime và probe count; secrets được redact.

## Rủi ro và tiêu chí dừng

- Nếu Foundry/Docker isolation không thể chứng minh trên nền tảng mục tiêu, PoC execution không được bật; MVP chỉ trả kết quả static/inconclusive và không tuyên bố runtime verification.
- Nếu BCE không thể cung cấp call/data-flow đủ tin cậy cho Solidity, giữ nhãn incomplete và chỉ dùng nó làm context để tìm kiếm; không dùng “không thấy đường” để bác finding.
- Nếu witness synthesis không thể buộc vào claim, assertion và implementation thật, cắt synthesis khỏi MVP; narrative vẫn được phân tích hai chiều và có thể kết thúc inconclusive.
- Model consensus không bao giờ thay verification của citation hoặc thực thi.

## Các quyết định đã chốt

- Đầu vào bản đầu: cả narrative-only và report có PoC.
- Nền tảng hợp đồng bản đầu: Solidity + Foundry trong Docker, local-first trên macOS.
- Ưu tiên tái sử dụng OpenCode khi tương thích; giữ boundary Harness, không port framework/runtime không phù hợp.
- Kết quả không đủ evidence: inconclusive/unverified; không ép valid/invalid.
- `PASS` là kết luận được hỗ trợ bởi evidence đã kiểm tra, tĩnh hoặc runtime; không mặc định có nghĩa PoC đã chạy.
- Narrative-only không có submitter PoC phù hợp không được tự sinh witness; nếu thiếu bằng chứng cần thiết thì giữ unverified.
- Thực thi PoC: an toàn cô lập là điều kiện bắt buộc; không có sandbox thật thì không giả lập production.

## Phần còn để người thực thi quyết định

- Chọn/đánh giá BCE Solidity phù hợp (ví dụ Slither/solc AST/call graph hoặc phương án repo hiện có), kèm license, offline behavior và xác định rõ độ bao phủ.
- Chốt Docker image Foundry có version/digest cố định và policy mount/UID/capabilities sau kiểm tra compatibility.
- Chọn cách parse/extract claim (LLM có schema với bounded repair hoặc parser kết hợp) dựa vào contract và fixture.
- Đặt giới hạn vận hành mặc định từ `JudgeRunConfig` và kiểm tra budget hiện hữu; mọi thay đổi mặc định phải được snapshot và đánh giá.
