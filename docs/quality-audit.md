# Kiểm tra chất lượng Super Content — 08/11/2026

Phạm vi: 14 nhóm chức năng trong yêu cầu. Bản nền được kiểm tra là `f18380b`. Không thao tác dữ liệu Super Day, không chạy SQL trên Supabase thật, không thay khóa hay cơ chế đăng nhập sản xuất.

## Kiểm thử và bằng chứng

| Nhóm chức năng | Phạm vi đã chạy |
| --- | --- |
| Kho ý tưởng: thêm đơn/hàng loạt, sửa, xóa, lưu trữ, khôi phục | Chromium và IndexedDB cục bộ |
| Năm công đoạn, giữ nguyên ID và dữ liệu | Node + trình duyệt, luồng 20 ý tưởng/7 video |
| Lưu kịch bản, mất mạng, xung đột, đồng bộ hai thiết bị | Trình duyệt + Supabase API giả lập; SQL PGlite |
| Đăng nhập và tách tài khoản | Auth giả lập + RLS PostgreSQL cục bộ với hai danh tính |
| Giao diện máy tính/điện thoại | Chromium 1440×1000 và 390×844; chưa phải Safari thật |
| Quản lý 100–500 kênh | Nhập, lọc, lưu và khôi phục sau reload; SQL chặn kênh 501 |
| Nhập hàng loạt, phát hiện trùng | URL/handle/ID đã phân giải; YouTube giả lập cho alias khác nhau |
| Tiêu chuẩn cá nhân | Phiên bản, xung đột, khôi phục nội dung; SQL + UI |
| Phản hồi chọn video | UI + RPC cục bộ, giữ snapshot/phiên bản tiêu chuẩn |
| Ghi nhớ và đổi thứ tự xếp hạng | Quy tắc thật, dữ liệu kiểm thử; phản hồi OpenAI giả lập |
| Tìm trong kho | Bộ lọc tiêu đề/mô tả tiếng Việt; giới hạn 2.000 hồ sơ gần nhất |
| Tìm YouTube theo từ khóa | HTTP request/response YouTube giả lập, kiểm tra gộp và lọc nguồn |
| Quét, số liệu, đề xuất, tiếp tục job | HTTP server thật trên loopback; repository/provider giả lập; SQL checkpoint/lease/snapshot cục bộ |
| Duyệt đề xuất vào Kho ý tưởng | UI + SQL chống trùng; không tự đưa vào trước khi duyệt |

Các lệnh xác minh: `npm ci`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run test:sync`. Thêm 11 bài Node kiểm tra hồi quy/biên/API và một kịch bản 500 kênh chạy ở hai viewport. Các bài cũ được giữ nguyên yêu cầu; không nới điều kiện để che lỗi.

Kết quả cục bộ sau sửa: 28 bài Node/SQL, 12 lượt E2E và 2 bài đồng bộ đều đạt (42 lượt); build thành công. `npm audit` báo 0 lỗ hổng theo cơ sở dữ liệu advisory tại thời điểm chạy. Kiểm tra định dạng và `git diff --check` đạt.

## Chín nhóm lỗi đã sửa

1. Kênh có handle đã phân giải thành ID không còn được nhận ra khi nhập lại handle. Giữ cả định danh URL và ID để chống trùng.
2. Nghiên cứu từ khóa/kết hợp lấy cả video cache thuộc nguồn khác. Lọc theo kênh đang theo dõi và nguồn từ khóa cấu hình.
3. Video mới có thể bị kết luận vượt trội khi so với thống kê cũ. Loại mẫu so sánh quá 24 giờ.
4. Watermark làm video ngoài trang playlist đầu không được cập nhật số liệu ở lượt sau. Cập nhật lại mẫu đã lưu, tối đa 150 ID ở bước đầu của kênh.
5. Ngân sách YouTube bị vượt trong một bước, hoặc hết ngân sách làm chặn luôn đánh giá cache. Kiểm tra chi phí trước từng request và cho phép bước đánh giá hoàn tất mà không gọi YouTube.
6. RPC từ chối vì cooldown/hạn mức lại báo lỗi migration 003. Chuyển đúng thành `SCAN_LIMIT`/HTTP 429.
7. Body JSON sai kiểu và phản hồi job không đủ trường không được chặn đúng; có thể tạo lỗi 503 hoặc gọi lặp job không hợp lệ. Xác thực hai phía, giới hạn theo byte UTF-8, trả 400/413 và dừng vòng lặp khi sai phản hồi.
8. Tìm tiếng Việt dùng bộ token xếp hạng, bỏ mất từ ngắn như “ăn”, xử lý sai chữ Đ viết hoa. Tách chuẩn hóa tìm kiếm khỏi từ khóa đánh giá.
9. Pull request chưa được kiểm thử trước khi cập nhật `main`. Bổ sung CI cho PR, chỉ deploy từ `main`, giữ artifact khi kiểm thử trình duyệt lỗi.

Bảy lỗi đầu có bài hồi quy chạy thất bại trước khi sửa, sau đó chạy đạt. Tăng trưởng dùng đúng thời điểm thu thập; việc nhóm lịch sử theo ID giảm số lần quét lại snapshot. Không sửa migration đã phát hành, không thêm migration mới.

## Dịch vụ thật và phiên bản

GitHub connector xác nhận quyền push và workflow Pages nền `42483618398` đã thành công ở commit `f18380b`. Phiên bản bản sửa phải đối chiếu với SHA của lần chạy Actions sau khi push. CI thành công không thay thế phép thử HTTP trên website đang chạy.

Proxy Cloud từ chối kết nối Render với HTTP 403 ngay tại CONNECT. GitHub Pages cũng bị từ chối qua curl; Chrome hiển thị `DNS_PROBE_FINISHED_NO_INTERNET`. Đây là giới hạn đường truy cập của môi trường kiểm tra, chưa chứng minh hai dịch vụ hỏng. Không thể xác nhận Render đang chạy commit nào, biến môi trường nào đã được đặt, hoặc trạng thái dịch vụ bên ngoài.

Không có secret/runtime binding Supabase, YouTube, OpenAI hay quyền triển khai Render được cấu hình trong môi trường này. Chưa xác minh chuỗi thật **Pages → Render → Supabase → YouTube → AI**, chưa quét 500 kênh thật, chưa đo độ trễ/hạn mức trên nhà cung cấp. Không dùng dữ liệu giả làm bằng chứng dịch vụ thật hoạt động.

## Bước vận hành còn cần quyền truy cập

1. Cho phép miền Pages/Render trong cài đặt môi trường Cloud. Khi kiểm tra Supabase thật, cho phép đúng hostname project được cấu hình và dùng tài khoản thử riêng.
2. Trên Pages, đối chiếu ba Actions Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public), `VITE_RESEARCH_API_URL=https://super-content-ap86.onrender.com`. Đổi biến frontend cần build lại.
3. Trên Render, đối chiếu commit triển khai, lệnh `npm run research:server`, các biến `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_API_KEY`, `RESEARCH_ALLOWED_ORIGINS`. Origin Pages phải là `https://quangminhdlus-dot.github.io`, không có `/Super-Content/`. OpenAI là tùy chọn, qua `OPENAI_API_KEY`/`OPENAI_MODEL`. Chỉ nhập secret trong cài đặt máy chủ.
4. Kiểm tra chỉ đọc xem các bảng/RPC 001–003 đã tồn tại. Nếu thiếu, cần đọc/phê duyệt migration trước khi áp dụng; không chạy lại SQL đã phát hành trên dữ liệu thật.
5. Sau deploy backend, `GET /health` có `version` từ `RENDER_GIT_COMMIT` khi Render cung cấp. Trả `ok` chỉ là tiến trình sống; tiếp tục đăng nhập tài khoản thử, cập nhật nhóm kênh nhỏ, chờ ít nhất một giờ và quét lại để kiểm tra snapshot/tăng trưởng thật, rồi mới thử 100–500 kênh theo ngân sách.
6. Kiểm tra Safari/iPhone thật và chế độ thêm vào Màn hình chính.

Giới hạn còn giữ: đánh giá tối đa 2.000 video thu thập gần nhất, đọc tối đa 10.000 snapshot/30 ngày, ngân sách 2.500 đơn vị YouTube/job. Quản lý được 500 kênh không có nghĩa một job bao phủ toàn bộ lịch sử 500 kênh. Các giới hạn mẫu hiện có được hiển thị/tài liệu hóa; chưa có tìm kiếm toàn bộ lịch sử không giới hạn.

## Đề xuất giám sát định kỳ

Sau khi kiểm tra thật, có thể thêm workflow mỗi 30 phút kiểm tra trang Pages và Render `/health`, retry 3 lần trước khi kết luận lỗi; giữ mã HTTP, thời gian và SHA không chứa secret. Dùng thông báo thất bại sẵn có của GitHub Actions hoặc kênh cảnh báo do chủ dự án chọn. Theo dõi `/health` riêng với bài smoke test có xác thực trong môi trường thử. Không tự gọi YouTube/OpenAI định kỳ và không tự sửa/deploy từ một cảnh báo. Chưa bật lịch hoặc gửi cảnh báo bên ngoài trong đợt sửa này.
