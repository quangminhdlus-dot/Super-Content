# Tìm video bằng mô tả nhu cầu — nâng cấp 004

Đây là phần mở rộng của job/checkpoint, YouTube Data API, Supabase, tiêu chuẩn và bộ nhớ đã có. Năm công đoạn sản xuất và kịch bản không đổi. Không chạy SQL, gọi API trả phí hoặc sửa dữ liệu sản xuất từ phiên phát triển này.

## Sử dụng

1. Mở **Nghiên cứu & Đề xuất**. Mặc định là **Theo mô tả nhu cầu**: mô tả nhiều đoạn về khán giả, vấn đề, kết quả và góc nhìn. Từ khóa bổ sung là tùy chọn.
2. Chọn nguồn độc lập: chỉ kênh đang theo dõi, toàn YouTube hoặc kết hợp. Không cần chuyển sang phương pháp từ khóa để tìm trên toàn YouTube.
3. **Quét ngay** tự lập kế hoạch và chạy. **Xem chiến lược tìm kiếm → Tạo chiến lược AI** cho phép xem trước ý định có cấu trúc, hướng trực tiếp/liên quan, truy vấn Việt/Anh, lý do và độ liên quan. Có thể sửa truy vấn, bỏ tích hướng không muốn, thêm hướng (tối đa 5). Nút xem trước tạo một job riêng, tính vào hạn mức lượt nghiên cứu; không bắt buộc xem trước.
4. Phương pháp **Theo video mẫu** nhận tối đa 3 URL HTTPS YouTube (watch/youtu.be/shorts/embed). Máy chủ trích ID, chỉ gọi endpoint YouTube cố định, lấy tiêu đề/mô tả thật. Không xem toàn bộ video. Video không đọc được gây lỗi rõ ràng thay vì suy diễn nội dung.
5. Phương pháp **Theo từ khóa** giữ tìm kiếm cụm từ cụ thể (tối đa 5). Nếu chưa có AI, kết quả phương pháp này được ghi là quy tắc. Với mô tả/video mẫu, AI thiếu khóa, lỗi, timeout hoặc sai cấu trúc sẽ dừng job, giữ checkpoint; không chuyển âm thầm sang tìm từ khóa.
6. **Nhiệm vụ đã lưu & tiêu chí bổ sung** cho phép đặt tên, lưu, mở lại và xem lịch sử kết quả theo run. Mỗi tài khoản tối đa 100 nhiệm vụ, có revision chống ghi đè giữa thiết bị và thời điểm chạy gần nhất. Dữ liệu trải nghiệm lưu bằng IndexedDB; chạy nghiên cứu thật cần đăng nhập và backend. Khung lịch ngày/tuần có trong schema, luôn `enabled=false`; chưa có scheduler.

Nhu cầu nhiệm vụ và tiêu chuẩn lâu dài là hai đầu vào riêng. Sửa mô tả không gọi RPC lưu tiêu chuẩn. Job giữ bản tiêu chuẩn khi bắt đầu; nếu còn job khác phải tiếp tục/hủy nó trước khi đổi nhiệm vụ.

## Kiến trúc và giới hạn

- `shared/search.js`: hợp đồng nhiệm vụ, kiểm tra video URL/chiến lược và các cách sắp xếp.
- `server/search-ai.js`: planner có structured output, sơ tuyển hữu hạn và đánh giá AI theo nhu cầu/tiêu chuẩn. AI không có công cụ, không được sửa tiêu chuẩn. Metadata/ghi nhớ là dữ liệu, không là chỉ dẫn hệ thống.
- `server/search-jobs.js`: lắp nhiệm vụ vào job cũ. Bước plan được lưu cùng danh sách công việc trong một transaction; restart có thể tiếp tục. Chỉ đọc lại kênh chưa kiểm tra trong 24 giờ. Kênh mới/cũ vẫn đi qua worker thu thập từng trang hiện có.
- Collector hiện có lấy tối đa 50 kết quả/truy vấn, chống trùng theo YouTube ID/tài khoản, giữ nguồn, snapshot và thời điểm thu thập thật. Tìm theo kho không tạo snapshot mới.
- Đánh giá ba lớp: A — nhu cầu hiện tại; B — tiêu chuẩn và tối đa 6 ghi nhớ đã xác nhận tương tự; C — tín hiệu số liệu thực tế. C không chứa điểm khớp từ khóa. Mẫu quá 24 giờ không chứng minh tăng trưởng hiện tại. Không suy ra thảo luận/tranh luận từ số bình luận.
- Đọc tối đa 2.000 hồ sơ gần nhất, sơ tuyển tối đa 20 video để AI đánh giá trong một request. Đây là phạm vi hữu hạn; không tìm hết toàn bộ lịch sử của 500 kênh hay toàn YouTube. Kết quả tối đa 20 video AI/lượt kể cả khi số đề xuất yêu cầu lớn hơn. Không dùng embedding hay vector index trong phiên bản này.
- Mặc định sắp theo tổng 60% nhu cầu, 25% cá nhân, 15% thị trường; luôn hiển thị từng thành phần. Có thể sắp theo tăng trưởng có bằng chứng, giá trị chiến lược hoặc mới nhất. Đánh giá dựa metadata có độ tin cậy tối đa “hạn chế”, kèm dữ liệu còn thiếu; chưa đọc transcript/video/bình luận.
- Giới hạn chi phí: 5 truy vấn, 2.500 đơn vị YouTube/job, 10 job mới/24 giờ và cách nhau 60 giây (kế thừa). Planner tối đa 2.400 output tokens; evaluator tối đa 6.000, mỗi request timeout 45 giây, ngữ cảnh tối đa 128.000 ký tự. Trích ghi nhớ tối đa 500 ký tự/mẫu trong request mới. Mỗi phase/job tối đa 3 lần thử AI; tài khoản tối đa 30 lần gọi AI/24 giờ, đặt chỗ bằng RPC trước khi gọi, kể cả lần thất bại. Không có gọi nền định kỳ.

Kết quả của nhiệm vụ hoàn tất mới được phân biệt với đề xuất cũ; lượt không có kết quả không hiển thị video của lượt trước như kết quả mới. Lịch sử vẫn được giữ. Thao tác duyệt/chọn/bỏ qua/lưu trữ và chuyển Kho ý tưởng giữ cơ chế chống trùng và không ghi đè kịch bản.

Phản hồi lưu snapshot nhu cầu, chiến lược, phiên bản tiêu chuẩn hiện tại và phiên bản đã đánh giá. Có thể sửa/xóa tại Bộ nhớ học hỏi. Sửa phản hồi cập nhật xu hướng và bỏ xác nhận ghi nhớ liên quan; cần xác nhận lại trước khi dùng. Xóa phản hồi xóa ghi nhớ gắn với nó, không xóa video/kịch bản/lịch sử đánh giá. Đây là truy xuất ví dụ đã xác nhận, không huấn luyện lại mô hình và không tuyên bố đã học đủ sở thích.

## Migration cần phê duyệt

Đọc và phê duyệt [`supabase/004_search_missions.sql`](../supabase/004_search_missions.sql) trước khi chạy một lần sau 001–003. Không sửa hoặc chạy lại 001–003, không tự áp dụng SQL lên production.

004 tạo bảng nhiệm vụ và ledger hạn mức AI, thêm snapshot nhu cầu vào phản hồi, thêm RPC lưu nhiệm vụ/sửa phản hồi/kiểm tra phiên bản/đặt chỗ AI, bọc RPC commit cũ để ghi kế hoạch cùng checkpoint. RLS nhiệm vụ theo `auth.uid()`, ledger/worker chỉ service-role; mọi update/delete phản hồi kiểm tra chủ sở hữu. Không thay bảng hoặc RPC lưu kịch bản và không đụng Super Day. Cần sao lưu và review migration vì đây là thay đổi cơ sở dữ liệu thật.

Backend mới kiểm tra schema 004 trước khi tạo job có nhiệm vụ. Frontend từ chối chạy thông minh nếu backend cũ không trả lại nhiệm vụ, tránh việc mô tả bị bỏ qua. Các API job cũ không truyền mission và job 003 đang chạy vẫn dùng được; không ép chuyển dữ liệu cũ.

## Cấu hình và đưa vào sử dụng thật

Không có khóa mới. Trên Render cần `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_API_KEY`, `OPENAI_API_KEY`; `OPENAI_MODEL` tùy chọn (mặc định `gpt-4.1-mini`). `RESEARCH_ALLOWED_ORIGINS` phải có `https://quangminhdlus-dot.github.io` (không có path). Secrets chỉ trong cài đặt máy chủ. Model nhận mô tả, tiêu chuẩn và ví dụ đã xác nhận; thông báo này có trong giao diện.

Sau khi phê duyệt/áp dụng 004, deploy backend cùng commit của bản nâng cấp bằng `npm run research:server`. Kiểm tra `/health.version` so với Render commit. Pages cần ba biến công khai hiện có `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_RESEARCH_API_URL=https://super-content-ap86.onrender.com`. Tuyệt đối không đặt service-role/YouTube/OpenAI key trong `VITE_*`.

Phần người dùng cần thao tác khi chưa có quyền kết nối: review/chạy migration 004; cấu hình khóa trên Render; deploy backend; cấp tài khoản thử và mở mạng tới các dịch vụ để kiểm tra thật. Không gửi secret trong chat. Chỉ sau đó chạy một nhiệm vụ nhỏ, đối chiếu ID/số liệu thật và log chi phí rồi mới mở rộng nguồn. Chưa kích hoạt lịch hoặc dịch vụ mới có phí trong phiên phát triển.

## Kiểm thử và trạng thái thực tế

`npm test`: nghiệp vụ cũ, hợp đồng tìm kiếm mới, planner Việt/Anh giả lập, mô tả không từ khóa/có từ khóa, 100 kênh, nguồn độc lập, video mẫu, xếp hạng đổi theo tiêu chuẩn, lỗi AI/ID tự bịa, kiểm tra sẵn sàng schema. Integration PGlite chạy SQL 001–004 và các hàm start/claim/commit thật qua cả nguồn YouTube, kho kênh và kết hợp; kiểm tra chống trùng, snapshot, task history, RLS hai tài khoản, revision, quota AI, phản hồi sửa/xóa và giữ nguyên kịch bản.

`npm run test:e2e`: luồng sản xuất cũ, lưu/mở nhiệm vụ và giữ tiêu chuẩn trên desktop/iPhone viewport; kiểm tra cuộn 30–100 đề xuất ở nhiều độ phân giải. `npm run test:sync`: auth/API giả lập, xem/sửa kế hoạch, lưu/chạy lại nhiệm vụ, A/B/C, history, lượt rỗng không lấy nhầm video cũ và lỗi AI rõ ràng.

Các kiểm thử có API nhà cung cấp đều dùng fixture, không chứng minh YouTube/OpenAI/Supabase thật hoạt động. Chưa chạy 004 trên production, chưa gọi AI/YouTube trả phí, chưa xác minh Render hoặc Safari/iPhone thật. Môi trường Cloud chưa có secret và đang chặn miền Pages/Render. Có thể xác nhận xuất bản frontend qua GitHub Actions; tính năng nghiên cứu AI production còn phụ thuộc các bước cấu hình trên.
